#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeAuthGuards, REASON, REPO_ROOT } from "../verify-auth-guards.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(TEST_DIR, "fixtures", "auth-guards");
const FIXTURE_AUTH_GUARDS = ["support/auth-guard.ts"];
const FIXTURE_STORAGE_MODULES = ["support/storage.ts"];
const requireFromWeb = createRequire(join(REPO_ROOT, "apps/web/package.json"));
const ts = requireFromWeb("typescript");

const BYPASS_CASES = new Map([
  ["bypass/storage-only.ts", REASON.MISSING],
  ["bypass/aliased-export.ts", REASON.MISSING],
  ["bypass/aliased-prisma-import.ts", REASON.MISSING],
  ["bypass/app/api/users/route.ts", REASON.MISSING],
  ["bypass/app/server-action.ts", REASON.MISSING],
  ["bypass/catch-chain.ts", REASON.DISCARDED],
  ["bypass/callback-mutation-foreach.ts", REASON.UNUSED],
  ["bypass/callback-mutation-named.ts", REASON.UNUSED],
  ["bypass/callback-mutation-nested.ts", REASON.UNUSED],
  ["bypass/callback-mutation-then.ts", REASON.UNUSED],
  ["bypass/callback-factory-return.ts", REASON.UNUSED],
  ["bypass/callback-imported-wrapper.ts", REASON.UNUSED],
  ["bypass/callback-mutation-property-reference.ts", REASON.UNUSED],
  ["bypass/callback-mutation-element-reference.ts", REASON.UNUSED],
  ["bypass/callback-mutation-bound-reference.ts", REASON.UNUSED],
  ["bypass/callback-spread-argument.ts", REASON.UNUSED],
  ["bypass/call-argument-launder.ts", REASON.UNUSED],
  ["bypass/comma-launder.ts", REASON.UNUSED],
  ["bypass/computed-prisma-call.ts", REASON.UNPROVABLE],
  ["bypass/default-export.ts", REASON.MISSING],
  ["bypass/default-param-initializer.ts", REASON.MISSING],
  ["bypass/depth-limit.ts", REASON.UNPROVABLE],
  ["bypass/derived-id-laundering.ts", REASON.UNUSED],
  ["bypass/derived-incidental-property.ts", REASON.UNUSED],
  ["bypass/derived-negative-filter-operators.ts", REASON.UNUSED],
  ["bypass/destructuring-default-reassignment.ts", REASON.UNUSED],
  ["bypass/destructuring-reassignment.ts", REASON.UNUSED],
  ["bypass/discarded-principal.ts", REASON.DISCARDED],
  ["bypass/dynamic-import.ts", REASON.MISSING],
  ["bypass/imported-helper.ts", REASON.MISSING],
  ["bypass/imported-callback-factory.ts", REASON.UNUSED],
  ["bypass/imported-callback-alias-reassignment.ts", REASON.UNUSED],
  ["bypass/imported-callback-mutation.ts", REASON.UNUSED],
  ["bypass/imported-callback-reassignment.ts", REASON.UNUSED],
  ["bypass/imported-repository.ts", REASON.MISSING],
  ["bypass/frame-runner-unresolved.ts", REASON.MISSING],
  ["bypass/frame-runner-unused-principal.ts", REASON.MISSING],
  ["bypass/imported-service.ts", REASON.MISSING],
  ["bypass/internal-entry-param.ts", REASON.MISSING],
  ["bypass/internal-param-optional.ts", REASON.PARAM_OPTIONAL],
  ["bypass/internal-param-unused.ts", REASON.PARAM_UNUSED],
  ["bypass/local-helper.ts", REASON.MISSING],
  ["bypass/array-index-launder.ts", REASON.UNUSED],
  ["bypass/alias-mutation-launder.ts", REASON.UNUSED],
  ["bypass/mutation-launder.ts", REASON.UNUSED],
  ["bypass/mutating-member-call.ts", REASON.UNUSED],
  ["bypass/non-async-export.ts", REASON.MISSING],
  ["bypass/or-launder.ts", REASON.UNUSED],
  ["bypass/object-assign-launder.ts", REASON.UNUSED],
  ["bypass/prisma-nested-unscoped-or.ts", REASON.UNUSED],
  ["bypass/prisma-not-owned.ts", REASON.UNUSED],
  ["bypass/prisma-or-partially-owned.ts", REASON.UNUSED],
  ["bypass/queue-send.ts", REASON.MISSING],
  ["bypass/raw-sql.ts", REASON.MISSING],
  ["bypass/re-export.ts", REASON.MISSING],
  ["bypass/resolver-after-sensitive.ts", REASON.AFTER],
  ["bypass/resolver-in-comment.ts", REASON.MISSING],
  ["bypass/resolver-in-dead-code.ts", REASON.MISSING],
  ["bypass/resolver-in-string.ts", REASON.MISSING],
  ["bypass/server-only-not-gateway.ts", REASON.MISSING],
  ["bypass/shadowed-resolver.ts", REASON.SHADOWED],
  ["bypass/spread-rebuild-launder.ts", REASON.UNUSED],
  ["bypass/structured-callback-carrier.ts", REASON.UNUSED],
  ["bypass/structured-callback-recursive-carrier.ts", REASON.UNUSED],
  ["bypass/structured-callback-recursive-shorthand.ts", REASON.UNUSED],
  ["bypass/authority-trailing-spread.ts", REASON.UNUSED],
  ["bypass/trailing-spread-carrier.ts", REASON.MISSING],
  ["bypass/trailing-spread-known-carrier.ts", REASON.MISSING],
  ["bypass/ternary-launder.ts", REASON.UNUSED],
  ["bypass/transitive-local-call.ts", REASON.MISSING],
  ["bypass/unused-principal.ts", REASON.UNUSED],
  ["bypass/void-reference.ts", REASON.UNUSED],
  ["bypass/admin-gate-not-consumed.ts", REASON.DISCARDED],
  ["bypass/principal-name-reuse.ts", REASON.MISSING],
  ["bypass/nullable-name-reuse.ts", REASON.MISSING],
  ["bypass/collection-name-reuse.ts", REASON.MISSING],
  ["bypass/admin-consumed-condition.ts", REASON.DISCARDED],
  ["bypass/admin-multi-destructure.ts", REASON.DISCARDED],
  ["bypass/admin-deny-falls-through.ts", REASON.UNUSED],
  ["bypass/admin-single-destructure.ts", REASON.DISCARDED],
  ["bypass/three-module-db-client-depth.ts", REASON.UNPROVABLE],
  ["bypass/signed-media-opaque-mutation.ts", REASON.MISSING],
  ["bypass/signed-media-helper-mutation.ts", REASON.MISSING],
  ["bypass/derived-map-poisoning.ts", REASON.UNUSED],
  ["bypass/derived-collection-helper-mutation.ts", REASON.UNUSED],
  ["bypass/storage-wrong-module.ts", REASON.UNPROVABLE],
  ["bypass/storage-namespace-wrong-module.ts", REASON.UNPROVABLE],
  ["bypass/storage-unresolved-module.ts", REASON.UNPROVABLE],
  ["bypass/storage-url-client-key.ts", REASON.MISSING],
  ["bypass/storage-url-wrong-key-builder.ts", REASON.MISSING],
  ["bypass/signed-media-extra-match-argument.ts", REASON.MISSING],
  ["bypass/signed-media-extra-storage-argument.ts", REASON.MISSING],
  ["bypass/signed-media-indirect-domination.ts", REASON.MISSING],
  ["bypass/signed-media-wrong-claims-member.ts", REASON.MISSING],
  ["bypass/storage-key-incidental-owner.ts", REASON.UNUSED],
  ["bypass/storage-key-logical-owner.ts", REASON.UNUSED],
  ["bypass/three-module-nested-db-client-depth.ts", REASON.UNPROVABLE],
  ["bypass/for-of-principal-shadow.ts", REASON.UNUSED],
  ["bypass/for-of-principal-assignment.ts", REASON.UNUSED],
  ["bypass/for-in-principal-assignment.ts", REASON.UNUSED],
  ["bypass/for-of-principal-destructuring-assignment.ts", REASON.UNUSED],
  ["bypass/empty-derived-collection-helper-mutation.ts", REASON.UNUSED],
  ["bypass/nonempty-callback-flow-state.ts", REASON.UNUSED],
  ["bypass/workspace-storage-helper-capability.ts", REASON.UNPROVABLE],
  ["bypass/workspace-storage-surface-capability.ts", REASON.UNPROVABLE],
  ["bypass/from-prisma-outside-queue-send.ts", REASON.UNPROVABLE],
  ["bypass/nonempty-untrusted-collection.ts", REASON.UNUSED],
  ["bypass/nonempty-mixed-callback-branch.ts", REASON.UNUSED],
  ["bypass/nonempty-mixed-element-write.ts", REASON.UNUSED],
  ["bypass/nonempty-mixed-alias-push.ts", REASON.UNUSED],
  ["bypass/storage-key-deep-owner.ts", REASON.UNUSED],
  ["bypass/storage-key-scalar-relation.ts", REASON.UNUSED],
  ["bypass/key-owner-match-wrong-module.ts", REASON.UNUSED],
  ["bypass/key-owner-match-discarded.ts", REASON.UNUSED],
  ["bypass/catch-principal-shadow.ts", REASON.UNUSED],
  ["bypass/derived-scalar-slice.ts", REASON.UNUSED],
  ["bypass/captured-owner-reassignment-local.ts", REASON.UNUSED],
  ["bypass/captured-owner-reassignment-foreach.ts", REASON.UNUSED],
  ["bypass/captured-owner-reassignment-stale-boolean.ts", REASON.UNUSED],
  ["bypass/captured-owner-reassignment-imported.ts", REASON.UNUSED],
  ["bypass/captured-owner-member-reassignment-imported.ts", REASON.UNUSED],
  ["bypass/local-db-carrier.ts", REASON.MISSING],
  ["bypass/local-db-carrier-nested-alias.ts", REASON.MISSING],
  ["bypass/local-db-carrier-member-write.ts", REASON.MISSING],
  ["bypass/local-db-carrier-return.ts", REASON.MISSING],
  ["bypass/local-db-carrier-nullish-member-write.ts", REASON.MISSING],
  ["bypass/local-db-carrier-object-assign.ts", REASON.MISSING],
  ["bypass/local-db-carrier-array-push.ts", REASON.MISSING],
  ["bypass/local-db-carrier-opaque-mutator.ts", REASON.MISSING],
  ["bypass/captured-owner-reassignment-imported-raw-sql.ts", REASON.UNUSED],
  ["bypass/captured-owner-member-reassignment-imported-raw-sql.ts", REASON.UNUSED],
  ["bypass/derived-collection-sticky-poison.ts", REASON.UNUSED],
  ["bypass/derived-collection-unshift-poison.ts", REASON.UNUSED],
  ["bypass/derived-collection-splice-poison.ts", REASON.UNUSED],
  ["bypass/derived-collection-fill-poison.ts", REASON.UNUSED],
  ["bypass/derived-collection-object-assign-poison.ts", REASON.UNUSED],
  ["bypass/derived-collection-alias-unshift-poison.ts", REASON.UNUSED],
  ["bypass/derived-collection-imported-unshift-poison.ts", REASON.UNUSED],
  ["bypass/derived-collection-dynamic-member-poison.ts", REASON.UNUSED],
  ["bypass/local-object-surface-arrow.ts", REASON.MISSING],
  ["bypass/local-object-surface-method.ts", REASON.MISSING],
  ["bypass/local-object-surface-element.ts", REASON.MISSING],
  ["bypass/local-object-surface-nested.ts", REASON.MISSING],
  ["bypass/local-object-surface-module-scope.ts", REASON.MISSING],
  ["bypass/local-object-surface-guarded.ts", REASON.MISSING],
  ["bypass/local-object-surface-storage.ts", REASON.MISSING],
  ["bypass/local-class-surface-method.ts", REASON.MISSING],
  ["bypass/local-object-surface-assign-rewrite.ts", REASON.UNPROVABLE],
  ["bypass/local-object-surface-member-write.ts", REASON.UNPROVABLE],
  ["bypass/local-object-surface-spread.ts", REASON.UNPROVABLE],
  ["bypass/local-object-surface-dynamic-member.ts", REASON.UNPROVABLE],
  ["bypass/local-object-surface-reassigned.ts", REASON.UNPROVABLE],
  ["bypass/local-class-surface-inherited.ts", REASON.UNPROVABLE],
  ["bypass/for-of-member-principal-alias.ts", REASON.UNUSED],
  ["bypass/nested-derived-collection-carrier.ts", REASON.UNUSED],
  ["bypass/nested-principal-object-carrier.ts", REASON.UNUSED],
  ["bypass/cross-boundary-same-name-collection.ts", REASON.UNUSED],
  ["bypass/computed-import-capability-call.ts", REASON.UNPROVABLE],
  ["bypass/conditional-import-capability-call.ts", REASON.UNPROVABLE],
  ["bypass/mixed-principal-carrier.ts", REASON.MISSING],
  ["bypass/mixed-principal-carrier-imported.ts", REASON.MISSING],
  ["bypass/mixed-principal-carrier-write.ts", REASON.MISSING],
  ["bypass/mixed-principal-carrier-element-access.ts", REASON.MISSING],
  ["bypass/mixed-principal-carrier-nested.ts", REASON.MISSING],
]);

const MULTI_EXPORT_BYPASSES = new Map([
  [
    "bypass/nonempty-mixed-callback-branch.ts",
    ["leak", "leakThroughTracedCallee"],
  ],
  [
    "bypass/callback-mutation-foreach.ts",
    ["leakForEachCallback", "leakTracedLocalCallback"],
  ],
  [
    "bypass/callback-mutation-named.ts",
    ["leakBlockScopedNamedCallback", "leakNamedCallback", "leakReassignedCallback"],
  ],
  [
    "bypass/derived-incidental-property.ts",
    ["leakDerivedIdInValueField", "leakIncidentalProperty"],
  ],
  [
    "bypass/destructuring-reassignment.ts",
    ["leakArrayReassignment", "leakObjectReassignment"],
  ],
  ["bypass/derived-id-laundering.ts", ["leak", "leakUncheckedClientId"]],
  ["bypass/mutation-launder.ts", ["leakMutatedGate", "leakMutatedResult"]],
  [
    "bypass/structured-callback-carrier.ts",
    [
      "leakFunctionExpression",
      "leakMethodShorthand",
      "leakShorthandProperty",
      "leakUnresolvedProperty",
    ],
  ],
  ["bypass/ternary-launder.ts", ["leakAssignedTernary", "leakInlineTernary"]],
  [
    "bypass/trailing-spread-known-carrier.ts",
    ["leakTrailingKnownSpreadCarrier", "leakTrailingLocalSpreadCarrier"],
  ],
  [
    "bypass/imported-callback-alias-reassignment.ts",
    ["leakAfterExportListAliasReassignment", "leakAfterIdentifierInitializerReassignment"],
  ],
]);

const POSITIVE_CASES = [
  "positive/admin-global-op.ts",
  "positive/aliased-export.ts",
  "positive/authority-spread-ordering.ts",
  "positive/callback-data-argument.ts",
  "positive/const-arrow.ts",
  "positive/default-function.ts",
  "positive/default-identifier.ts",
  "positive/default-deny-allowlist.ts",
  "positive/derived-id-update.ts",
  "positive/export-star.ts",
  "positive/frame-runner-gateway.ts",
  "positive/gateway-wrapper.ts",
  "positive/leading-spread-carrier.ts",
  "positive/internal-owner-id.ts",
  "positive/internal-principal-derived.ts",
  "positive/imported-anonymous-callback.ts",
  "positive/imported-pure-callback.ts",
  "positive/immutable-const-owned-spread.ts",
  "positive/modeled-owner-objects.ts",
  "positive/named-function.ts",
  "positive/non-async.ts",
  "positive/nullish-principal-branches.ts",
  "positive/owner-derived-storage-map.ts",
  "positive/owner-derived-storage-key.ts",
  "positive/dominating-key-owner-match.ts",
  "positive/signed-media-authority.ts",
  "positive/prisma-all-or-branches-owned.ts",
  "positive/prisma-and-owned.ts",
  "positive/prisma-positive-identity-operators.ts",
  "positive/prisma-outer-owner-or.ts",
  "positive/queue-send.ts",
  "positive/queue-send-transaction.ts",
  "positive/nonempty-derived-collection.ts",
  "positive/read-only-property-method.ts",
  "positive/renamed-owner-destructure.ts",
  "positive/re-export.ts",
  "positive/structured-callback-carrier.ts",
  "positive/storage-namespace-import.ts",
  "positive/storage-url-owned.ts",
  "positive/callee-local-name-reassignment.ts",
  "positive/principal-session-carrier.ts",
  "positive/principal-owner-id-carrier.ts",
  "positive/derived-collection-derived-splice.ts",
  "positive/derived-collection-derived-unshift.ts",
  "positive/derived-collection-pure-read.ts",
  "positive/local-object-helper-pure.ts",
  "positive/local-object-repository-owned.ts",
  "positive/local-class-repository-owned.ts",
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

function productionAppFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") {
        files.push(...productionAppFiles(path));
      }
    } else if (
      /\.(?:[cm]?ts|tsx)$/u.test(entry.name) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(path);
    }
  }
  return files.sort();
}

function hasTopLevelUseServerDirective(path) {
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false);
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

const defaultDiscovery = await analyzeAuthGuards();
const defaultSourceFiles = new Set(defaultDiscovery.sourceFiles);
const expectedAppServerActions = productionAppFiles(join(REPO_ROOT, "apps/web/app")).filter(
  hasTopLevelUseServerDirective,
);
assert.ok(
  expectedAppServerActions.length > 0,
  "the production app tree must contain a top-level use-server discovery sentinel",
);
assert.deepEqual(
  expectedAppServerActions.filter((path) => !defaultSourceFiles.has(path)),
  [],
  "default discovery must enumerate every production apps/web/app/** top-level use-server file",
);
console.log(
  `PASS default discovery covers ${expectedAppServerActions.length} production app use-server file(s)`,
);

// A bypass that hides a sensitive call behind an unanalyzed boundary does not merely
// mis-classify an entry — it removes the entry, and with it the whole file, from the
// report. The scan then reads as a green FINDING=0 with no diagnostic anywhere. These
// floors turn that silent drop into a hard failure. Raise them when real coverage
// grows; never lower one to make a run pass, because a fall is the symptom this guard
// exists to catch.
const PRODUCTION_COVERED_FILE_FLOOR = 120;
const PRODUCTION_COVERED_ENTRY_FLOOR = 465;
const coveredEntryCount = defaultDiscovery.files.reduce(
  (total, file) => total + file.entries.length,
  0,
);
assert.ok(
  defaultDiscovery.files.length >= PRODUCTION_COVERED_FILE_FLOOR,
  `production coverage fell to ${defaultDiscovery.files.length} file(s), below the ${PRODUCTION_COVERED_FILE_FLOOR} floor — a file stopped being analyzed`,
);
assert.ok(
  coveredEntryCount >= PRODUCTION_COVERED_ENTRY_FLOOR,
  `production coverage fell to ${coveredEntryCount} entr(ies), below the ${PRODUCTION_COVERED_ENTRY_FLOOR} floor — an export stopped being analyzed`,
);
assert.deepEqual(
  defaultDiscovery.files.filter((file) => file.entries.length === 0),
  [],
  "a covered production file must never report zero analyzed entries",
);
console.log(
  `PASS production coverage holds at ${defaultDiscovery.files.length} file(s) / ${coveredEntryCount} entr(ies)`,
);

const requiredStorageCoverage = [
  {
    path: "apps/web/lib/upload-actions.ts",
    exports: [
      "abortDirectUpload",
      "authorizeUpload",
      "finalizeCandidateUploads",
      "signUploadPart",
      "uploadFileFallback",
    ],
  },
  { path: "apps/web/app/files/[...key]/route.ts", exports: ["GET"] },
  { path: "apps/web/app/api/media/pub/[token]/route.ts", exports: ["GET"] },
];
for (const { path, exports } of requiredStorageCoverage) {
  const file = defaultDiscovery.files.find((candidate) => candidate.path === path);
  assert.ok(file, `${path} must receive explicit semantic storage coverage`);
  assert.deepEqual(
    file.entries.map((entry) => entry.exportName).sort(),
    exports,
    `${path} must cover every live storage export`,
  );
}
console.log(
  `PASS default discovery semantically covers ${requiredStorageCoverage.length} live storage file(s)`,
);

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
    trustedStoragePaths: FIXTURE_STORAGE_MODULES,
  });
  assert.equal(result.files.length, 1, `${fixture} must be content-covered`);
  assert.equal(result.ok, false, `${fixture} must fail`);
  assert.deepEqual(
    [...new Set(result.diagnostics.map((diagnostic) => diagnostic.reason))],
    [expectedReason],
    `${fixture} must fail for ${expectedReason}`,
  );
  const expectedFailingExports = MULTI_EXPORT_BYPASSES.get(fixture);
  if (expectedFailingExports) {
    assert.deepEqual(
      [...new Set(result.diagnostics.map((diagnostic) => diagnostic.exportName))].sort(),
      expectedFailingExports,
      `${fixture} must reject every laundering form`,
    );
  }
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
    trustedStoragePaths: FIXTURE_STORAGE_MODULES,
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

const productionFixtureTemp = mkdtempSync(join(tmpdir(), "auth-guard-production-fixture-"));
try {
  const fixturePath = join(
    productionFixtureTemp,
    "apps",
    "web",
    "lib",
    "fixtures",
    "production-leak.ts",
  );
  const fixtureDir = dirname(fixturePath);
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    fixturePath,
    [
      '"use server";',
      'import { prisma } from "@fikirtive/db";',
      "export function leak(ownerId: string) {",
      "  return prisma.user.findMany({ where: { ownerId } });",
      "}",
      "",
    ].join("\n"),
  );
  const discoveredProductionFixture = await analyzeAuthGuards({
    repoRoot: productionFixtureTemp,
    exemptionsPath: null,
    trustedAuthGuardPaths: [],
  });
  assert.ok(
    discoveredProductionFixture.sourceFiles.includes(fixturePath),
    "a production apps/web/lib/fixtures file must be enumerated",
  );
  assert.equal(
    discoveredProductionFixture.ok,
    false,
    "an unguarded production apps/web/lib/fixtures file must turn the fence red",
  );
  assert.deepEqual(
    [...new Set(discoveredProductionFixture.diagnostics.map((diagnostic) => diagnostic.reason))],
    [REASON.MISSING],
    "the discovered production fixture must fail for missing principal resolution",
  );
  console.log("EXPECTED FAIL isolated production fixtures directory is enumerated");
} finally {
  rmSync(productionFixtureTemp, { recursive: true, force: true });
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

const workspacePackageTemp = mkdtempSync(
  join(tmpdir(), "auth-guard-workspace-package-"),
);
try {
  const packageRoot = join(workspacePackageTemp, "packages", "db");
  const packageSource = join(packageRoot, "src");
  const actionRoot = join(workspacePackageTemp, "apps", "web", "lib");
  mkdirSync(packageSource, { recursive: true });
  mkdirSync(actionRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@fikirtive/db",
      private: true,
      type: "module",
      exports: {
        ".": {
          types: "./dist/src/index.d.ts",
          default: "./dist/src/index.js",
        },
      },
    }),
  );
  writeFileSync(
    join(packageSource, "index.ts"),
    [
      'export { scopedHelper, shapedHelper, unscopedHelper } from "./helpers.js";',
      "export const prisma = {};",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(packageSource, "helpers.ts"),
    [
      "export function scopedHelper(db, ownerId) {",
      "  return db.contact.findMany({ where: { ownerId } });",
      "}",
      "export function unscopedHelper(db) {",
      "  return db.contact.findMany();",
      "}",
      "export function shapedHelper(db, input: { ownerId: string }) {",
      "  return db.contact.findMany({ where: { ownerId: input.ownerId } });",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(actionRoot, "auth-guard.ts"),
    [
      "export async function requireOwner() {",
      '  return { ownerId: "owner" };',
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(actionRoot, "shaped.ts"),
    [
      'import { prisma, shapedHelper } from "@fikirtive/db";',
      "export default async function Page({ searchParams }) {",
      "  return shapedHelper(prisma, { ownerId: searchParams.owner });",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(actionRoot, "shaped-mixed.ts"),
    [
      '"use server";',
      'import { prisma, shapedHelper } from "@fikirtive/db";',
      'import { requireOwner } from "./auth-guard";',
      "export async function leakMixed(input: { owner: string }) {",
      "  const gate = await requireOwner();",
      "  return shapedHelper(prisma, { session: gate, ownerId: input.owner });",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(actionRoot, "shaped-carrier.ts"),
    [
      '"use server";',
      'import { prisma, shapedHelper } from "@fikirtive/db";',
      'import { requireOwner } from "./auth-guard";',
      "export async function ok() {",
      "  const gate = await requireOwner();",
      "  return shapedHelper(prisma, { ownerId: gate.ownerId });",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(actionRoot, "scoped.ts"),
    [
      '"use server";',
      'import { prisma, scopedHelper } from "@fikirtive/db";',
      'import { requireOwner } from "./auth-guard";',
      "export async function ok() {",
      "  const gate = await requireOwner();",
      '  if ("error" in gate) return gate;',
      "  return scopedHelper(prisma, gate.ownerId);",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(actionRoot, "unscoped.ts"),
    [
      '"use server";',
      'import { prisma, unscopedHelper } from "@fikirtive/db";',
      'import { requireOwner } from "./auth-guard";',
      "export async function leak() {",
      "  const gate = await requireOwner();",
      '  if ("error" in gate) return gate;',
      "  return unscopedHelper(prisma);",
      "}",
      "",
    ].join("\n"),
  );
  const workspaceScoped = await analyzeAuthGuards({
    repoRoot: workspacePackageTemp,
    entryFiles: ["apps/web/lib/scoped.ts"],
    exemptionsPath: null,
    trustedAuthGuardPaths: ["apps/web/lib/auth-guard.ts"],
  });
  assert.equal(
    workspaceScoped.ok,
    true,
    "an exact workspace export must resolve through dist/src and a .js-to-.ts re-export",
  );
  assert.deepEqual(
    workspaceScoped.diagnostics,
    [],
    "an owner-scoped workspace helper body must be proven rather than allowlisted",
  );
  assert.ok(
    workspaceScoped.files[0]?.entries.some((entry) => entry.covered),
    "the owner-scoped workspace helper must receive semantic coverage",
  );
  const workspaceUnscoped = await analyzeAuthGuards({
    repoRoot: workspacePackageTemp,
    entryFiles: ["apps/web/lib/unscoped.ts"],
    exemptionsPath: null,
    trustedAuthGuardPaths: ["apps/web/lib/auth-guard.ts"],
  });
  assert.equal(
    workspaceUnscoped.ok,
    false,
    "workspace resolution must expose an unscoped helper body",
  );
  assert.ok(
    workspaceUnscoped.diagnostics.some(
      (diagnostic) =>
        diagnostic.reason === REASON.MISSING &&
        diagnostic.implementationPath === "packages/db/src/helpers.ts",
    ),
    `an unscoped workspace helper body must fail for missing principal authority: ${JSON.stringify(workspaceUnscoped.diagnostics)}`,
  );
  const workspaceShaped = await analyzeAuthGuards({
    repoRoot: workspacePackageTemp,
    entryFiles: ["apps/web/lib/shaped.ts"],
    exemptionsPath: null,
    trustedAuthGuardPaths: ["apps/web/lib/auth-guard.ts"],
  });
  assert.equal(
    workspaceShaped.ok,
    false,
    "a required owner-shaped package parameter must not fabricate caller authority",
  );
  assert.ok(
    workspaceShaped.diagnostics.some(
      (diagnostic) =>
        diagnostic.reason === REASON.MISSING &&
        diagnostic.implementationPath === "packages/db/src/helpers.ts",
    ),
    `a package helper must require caller-proven owner provenance: ${JSON.stringify(workspaceShaped.diagnostics)}`,
  );
  const workspaceShapedMixed = await analyzeAuthGuards({
    repoRoot: workspacePackageTemp,
    entryFiles: ["apps/web/lib/shaped-mixed.ts"],
    exemptionsPath: null,
    trustedAuthGuardPaths: ["apps/web/lib/auth-guard.ts"],
  });
  assert.equal(
    workspaceShapedMixed.ok,
    false,
    "an unrelated principal property in the same carrier must not authorize a sibling untrusted ownerId",
  );
  assert.ok(
    workspaceShapedMixed.diagnostics.some(
      (diagnostic) =>
        diagnostic.reason === REASON.MISSING &&
        diagnostic.implementationPath === "packages/db/src/helpers.ts",
    ),
    `a mixed carrier must keep the package helper unproven: ${JSON.stringify(workspaceShapedMixed.diagnostics)}`,
  );
  const workspaceShapedCarrier = await analyzeAuthGuards({
    repoRoot: workspacePackageTemp,
    entryFiles: ["apps/web/lib/shaped-carrier.ts"],
    exemptionsPath: null,
    trustedAuthGuardPaths: ["apps/web/lib/auth-guard.ts"],
  });
  assert.equal(
    workspaceShapedCarrier.ok,
    true,
    "a carrier ownerId property proven from the guard result must satisfy the package helper",
  );
  assert.deepEqual(
    workspaceShapedCarrier.diagnostics,
    [],
    "an owner-proven carrier property must not raise a diagnostic",
  );
  console.log(
    "PASS exact workspace exports require caller-proven owner provenance",
  );
} finally {
  rmSync(workspacePackageTemp, { recursive: true, force: true });
}

const opaqueCallbackLedgerTemp = mkdtempSync(
  join(tmpdir(), "auth-guard-opaque-callback-ledger-"),
);
try {
  const actionRoot = join(opaqueCallbackLedgerTemp, "apps", "web", "lib");
  mkdirSync(actionRoot, { recursive: true });
  const serviceSource = [
    'import "server-only";',
    'import { prisma } from "@fikirtive/db";',
    "type VerifiedWorkerContext = { ownerId: string; verified: true };",
    "export function createLifecycleService(",
    "  resolveContext: (context: unknown) => Promise<VerifiedWorkerContext>,",
    ") {",
    "  async function run(context: unknown) {",
    "    const resolved = await resolveContext(context);",
    '    if (!resolved || resolved.verified !== true) throw new Error("Not authorized");',
    "    return prisma.routineRun.findMany({ where: { ownerId: resolved.ownerId } });",
    "  }",
    "  return { run };",
    "}",
    "",
  ].join("\n");
  writeFileSync(join(actionRoot, "listed.ts"), serviceSource);
  writeFileSync(join(actionRoot, "unlisted.ts"), serviceSource);
  const exemptionPath = join(opaqueCallbackLedgerTemp, "exemptions.txt");
  writeFileSync(
    exemptionPath,
    [
      "apps/web/lib/listed.ts",
      "createLifecycleService.run",
      REASON.MISSING,
      "reviewed opaque callback authority",
    ].join("\t") + "\n",
  );
  const exactOpaqueCallbackLedger = await analyzeAuthGuards({
    repoRoot: opaqueCallbackLedgerTemp,
    entryFiles: [
      "apps/web/lib/listed.ts",
      "apps/web/lib/unlisted.ts",
    ],
    exemptionsPath: exemptionPath,
    trustedAuthGuardPaths: [],
  });
  assert.equal(
    exactOpaqueCallbackLedger.ok,
    false,
    "an exact opaque-callback exemption must not generalize to another file with the same export name",
  );
  assert.equal(
    exactOpaqueCallbackLedger.exempted.length,
    1,
    "only the listed file/export identity may consume the exemption",
  );
  assert.ok(
    exactOpaqueCallbackLedger.unexpected.some(
      (diagnostic) =>
        diagnostic.path === "apps/web/lib/unlisted.ts" &&
        diagnostic.exportName === "createLifecycleService.run" &&
        diagnostic.reason === REASON.MISSING,
    ),
    `the unlisted opaque callback authority must remain missing-principal-resolution: ${JSON.stringify(exactOpaqueCallbackLedger.unexpected)}`,
  );
  assert.deepEqual(
    exactOpaqueCallbackLedger.staleExemptions,
    [],
    "the listed identity must be consumed while the unlisted identity stays red",
  );
  console.log(
    "PASS opaque callback authority remains bound to an exact ledger identity",
  );
} finally {
  rmSync(opaqueCallbackLedgerTemp, { recursive: true, force: true });
}

const trustedStorageEscapeTemp = mkdtempSync(
  join(tmpdir(), "auth-guard-storage-registry-"),
);
try {
  symlinkSync(
    join(FIXTURE_ROOT, "support", "storage.ts"),
    join(trustedStorageEscapeTemp, "trusted-storage.ts"),
  );
  await assert.rejects(
    analyzeAuthGuards({
      repoRoot: trustedStorageEscapeTemp,
      entryFiles: [],
      exemptionsPath: null,
      trustedAuthGuardPaths: [],
      trustedStoragePaths: ["trusted-storage.ts"],
    }),
    /storage trusted module escapes the repository root/u,
    "trusted storage registry entries must remain inside the repository after realpath resolution",
  );
  console.log("EXPECTED FAIL realpath-escaping trusted storage registry entry");
} finally {
  rmSync(trustedStorageEscapeTemp, { recursive: true, force: true });
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
