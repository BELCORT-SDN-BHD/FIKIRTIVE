#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeAuthGuards, REASON } from "../verify-auth-guards.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(TEST_DIR, "fixtures", "auth-guards");
const FIXTURE_AUTH_GUARDS = ["support/auth-guard.ts"];

const BYPASS_CASES = new Map([
  ["bypass/aliased-export.ts", REASON.MISSING],
  ["bypass/aliased-prisma-import.ts", REASON.MISSING],
  ["bypass/app/api/users/route.ts", REASON.MISSING],
  ["bypass/app/server-action.ts", REASON.MISSING],
  ["bypass/catch-chain.ts", REASON.DISCARDED],
  ["bypass/computed-prisma-call.ts", REASON.UNPROVABLE],
  ["bypass/default-export.ts", REASON.MISSING],
  ["bypass/default-param-initializer.ts", REASON.MISSING],
  ["bypass/depth-limit.ts", REASON.UNPROVABLE],
  ["bypass/derived-id-laundering.ts", REASON.UNUSED],
  ["bypass/discarded-principal.ts", REASON.DISCARDED],
  ["bypass/dynamic-import.ts", REASON.MISSING],
  ["bypass/imported-helper.ts", REASON.MISSING],
  ["bypass/imported-repository.ts", REASON.MISSING],
  ["bypass/imported-service.ts", REASON.MISSING],
  ["bypass/internal-entry-param.ts", REASON.MISSING],
  ["bypass/internal-param-optional.ts", REASON.PARAM_OPTIONAL],
  ["bypass/internal-param-unused.ts", REASON.PARAM_UNUSED],
  ["bypass/local-helper.ts", REASON.MISSING],
  ["bypass/non-async-export.ts", REASON.MISSING],
  ["bypass/queue-send.ts", REASON.MISSING],
  ["bypass/raw-sql.ts", REASON.MISSING],
  ["bypass/re-export.ts", REASON.MISSING],
  ["bypass/resolver-after-sensitive.ts", REASON.AFTER],
  ["bypass/resolver-in-comment.ts", REASON.MISSING],
  ["bypass/resolver-in-dead-code.ts", REASON.MISSING],
  ["bypass/resolver-in-string.ts", REASON.MISSING],
  ["bypass/server-only-not-gateway.ts", REASON.MISSING],
  ["bypass/shadowed-resolver.ts", REASON.SHADOWED],
  ["bypass/transitive-local-call.ts", REASON.MISSING],
  ["bypass/unused-principal.ts", REASON.UNUSED],
  ["bypass/void-reference.ts", REASON.UNUSED],
  ["bypass/admin-gate-not-consumed.ts", REASON.DISCARDED],
]);

const POSITIVE_CASES = [
  "positive/admin-global-op.ts",
  "positive/aliased-export.ts",
  "positive/const-arrow.ts",
  "positive/default-function.ts",
  "positive/default-identifier.ts",
  "positive/derived-id-update.ts",
  "positive/export-star.ts",
  "positive/gateway-wrapper.ts",
  "positive/internal-owner-id.ts",
  "positive/internal-principal-derived.ts",
  "positive/named-function.ts",
  "positive/non-async.ts",
  "positive/queue-send.ts",
  "positive/renamed-owner-destructure.ts",
  "positive/re-export.ts",
];

function fixtureFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...fixtureFiles(path));
    else if (entry.name.endsWith(".ts")) files.push(relative(FIXTURE_ROOT, path).replaceAll("\\", "/"));
  }
  return files.sort();
}

const discoveredCases = fixtureFiles(join(FIXTURE_ROOT, "bypass"))
  .concat(fixtureFiles(join(FIXTURE_ROOT, "positive")))
  .sort();
const declaredCases = [...BYPASS_CASES.keys(), ...POSITIVE_CASES].sort();
assert.deepEqual(
  discoveredCases,
  declaredCases,
  "every bypass/positive fixture must be declared in the semantic expectation table",
);

for (const [fixture, expectedReason] of BYPASS_CASES) {
  const source = readFileSync(join(FIXTURE_ROOT, fixture), "utf8");
  assert.match(source, /Bypass class:/u, `${fixture} must name its bypass class`);
  const result = await analyzeAuthGuards({
    repoRoot: FIXTURE_ROOT,
    entryFiles: [fixture],
    exemptionsPath: null,
    trustedAuthGuardPaths: FIXTURE_AUTH_GUARDS,
  });
  assert.equal(result.files.length, 1, `${fixture} must be content-covered`);
  assert.equal(result.ok, false, `${fixture} must fail`);
  assert.deepEqual(
    [...new Set(result.diagnostics.map((diagnostic) => diagnostic.reason))],
    [expectedReason],
    `${fixture} must fail for ${expectedReason}`,
  );
  if (fixture === "bypass/void-reference.ts") {
    assert.equal(result.diagnostics.length, 2, "same-reason sensitive sites must both be reported");
    assert.equal(
      new Set(result.diagnostics.map((diagnostic) => diagnostic.line)).size,
      2,
      "same-reason diagnostics must preserve both source lines",
    );
  }
  console.log(`EXPECTED FAIL ${fixture} — ${expectedReason}`);
}

for (const fixture of POSITIVE_CASES) {
  const source = readFileSync(join(FIXTURE_ROOT, fixture), "utf8");
  assert.match(source, /Positive class:/u, `${fixture} must name its positive class`);
  const result = await analyzeAuthGuards({
    repoRoot: FIXTURE_ROOT,
    entryFiles: [fixture],
    exemptionsPath: null,
    trustedAuthGuardPaths: FIXTURE_AUTH_GUARDS,
  });
  assert.equal(result.files.length, 1, `${fixture} must be content-covered`);
  assert.deepEqual(result.diagnostics, [], `${fixture} must prove resolver domination`);
  assert.equal(result.ok, true, `${fixture} must pass`);
  if (fixture.includes("/internal-")) {
    assert.ok(
      result.files[0].entries.some((entry) => entry.classification === "INTERNAL-PASS"),
      `${fixture} must be classified as INTERNAL-PASS`,
    );
  }
  if (fixture === "positive/admin-global-op.ts") {
    assert.ok(
      result.files[0].entries.some((entry) => entry.classification === "ADMIN-PASS"),
      `${fixture} must be classified as ADMIN-PASS`,
    );
  }
  console.log(`PASS ${fixture}`);
}

const dynamicDbTemp = mkdtempSync(join(tmpdir(), "auth-guard-dynamic-db-"));
try {
  writeFileSync(
    join(dynamicDbTemp, "require-bound.ts"),
    [
      '"use server";',
      'export function leak() {',
      '  const { prisma: db } = require("@fikirtive/db");',
      '  return db.user.findMany({ where: { ownerId: "attacker-controlled" } });',
      '}',
      '',
    ].join("\n"),
  );
  const requireBound = await analyzeAuthGuards({
    repoRoot: dynamicDbTemp,
    entryFiles: ["require-bound.ts"],
    exemptionsPath: null,
    trustedAuthGuardPaths: [],
  });
  assert.equal(requireBound.ok, false, "a bound require() DB alias must remain sensitive");
  assert.deepEqual(
    [...new Set(requireBound.diagnostics.map((diagnostic) => diagnostic.reason))],
    [REASON.MISSING],
    "a bound require() DB alias must feed normal principal tracking",
  );

  writeFileSync(
    join(dynamicDbTemp, "unbound.ts"),
    [
      '"use server";',
      'export function leak() {',
      '  return import("@fikirtive/db").then((db) => db.prisma.user.findMany());',
      '}',
      '',
    ].join("\n"),
  );
  const unbound = await analyzeAuthGuards({
    repoRoot: dynamicDbTemp,
    entryFiles: ["unbound.ts"],
    exemptionsPath: null,
    trustedAuthGuardPaths: [],
  });
  assert.equal(unbound.ok, false, "an unbound dynamic DB load must fail closed");
  assert.ok(
    unbound.diagnostics.some((diagnostic) => diagnostic.reason === REASON.UNPROVABLE),
    "an unbound dynamic DB load must include an unprovable diagnostic",
  );
  console.log("PASS bound require() tracking and unbound dynamic DB fail-closed checks");
} finally {
  rmSync(dynamicDbTemp, { recursive: true, force: true });
}

const exemptionTemp = mkdtempSync(join(tmpdir(), "auth-guard-exemptions-"));
try {
  const exemptionPath = join(exemptionTemp, "exemptions.txt");
  writeFileSync(
    exemptionPath,
    [
      "bypass/default-export.ts",
      "default",
      REASON.MISSING,
      "pre-existing, ticketed: fixture exemption",
    ].join("\t") + "\n",
  );
  const matched = await analyzeAuthGuards({
    repoRoot: FIXTURE_ROOT,
    entryFiles: ["bypass/default-export.ts"],
    exemptionsPath: exemptionPath,
    trustedAuthGuardPaths: FIXTURE_AUTH_GUARDS,
  });
  assert.equal(matched.ok, true, "an exact reviewed exemption may suppress its known finding");
  assert.equal(matched.exempted.length, 1, "the exact exemption must be consumed");
  assert.deepEqual(matched.staleExemptions, [], "the consumed exemption must not be stale");

  writeFileSync(
    exemptionPath,
    [
      "bypass/default-export.ts",
      "removedExport",
      REASON.MISSING,
      "pre-existing, ticketed: stale fixture exemption",
    ].join("\t") + "\n",
  );
  const stale = await analyzeAuthGuards({
    repoRoot: FIXTURE_ROOT,
    entryFiles: ["bypass/default-export.ts"],
    exemptionsPath: exemptionPath,
    trustedAuthGuardPaths: FIXTURE_AUTH_GUARDS,
  });
  assert.equal(stale.ok, false, "a stale exemption must fail closed");
  assert.equal(stale.staleExemptions.length, 1, "the stale entry must be reported");
  console.log("PASS exemption ledger exact-match and stale-entry checks");
} finally {
  rmSync(exemptionTemp, { recursive: true, force: true });
}

console.log(
  `verify-auth-guards fixtures: PASS (${BYPASS_CASES.size} bypasses rejected; ${POSITIVE_CASES.length} positive forms accepted)`,
);
