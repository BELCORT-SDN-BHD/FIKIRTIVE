// Permanent red-case tests for scripts/verify-auth-guards.mjs (SOL 复审 D-018⑤).
// Feeds fixture STRINGS (and a throwaway temp dir) to the exported matching
// functions and asserts the scanner still turns red — no real violating files
// ever land in the repo. Run: node scripts/__tests__/verify-auth-guards.test.mjs
//
// Also covers the second fence added for issue #389 / ledger #359 item 23: the
// server-only `*-gateway.ts` scan (findUnwrapped/scanGateways). Same rule as
// above — fixture strings and a throwaway temp dir only; the real gateway
// files under apps/web/lib are read (never written) to prove the live repo is
// green and that a copy with one injected unwrapped export would be red.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findUnguarded,
  findUnwrapped,
  isServerOnlySource,
  isUseServerSource,
  scan,
  scanGateways,
} from "../verify-auth-guards.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL_LIB = join(REPO_ROOT, "apps", "web", "lib");

// ── isUseServerSource: directive detection tolerance ──
assert.equal(isUseServerSource('"use server";\nexport {};'), true, "double-quote directive");
assert.equal(isUseServerSource("'use server';\nexport {};"), true, "single-quote directive");
assert.equal(isUseServerSource('// leading line comment\n"use server";'), true, "line comment before directive");
assert.equal(isUseServerSource('/**\n * leading block comment\n */\n"use server";'), true, "block comment before directive");
assert.equal(isUseServerSource('﻿"use server";'), true, "BOM before directive");
assert.equal(isUseServerSource('﻿\n// both\n\'use server\';'), true, "BOM + comment + single quote");
assert.equal(isUseServerSource('"use client";\nexport {};'), false, "use client is not use server");
assert.equal(isUseServerSource('import x from "y";\n"use server";'), false, "directive after code is not a prologue");
assert.equal(isUseServerSource("export {};"), false, "no directive");

// ── findUnguarded: red cases (each MUST be caught) ──
const redFunctionShape = `
export async function leak() {
  return prisma.user.findMany();
}`;
assert.deepEqual(findUnguarded(redFunctionShape), ["leak"], "unguarded export async function must be red");

const redConstShape = `
export const leak = async () => {
  return prisma.user.findMany();
};`;
assert.deepEqual(findUnguarded(redConstShape), ["leak"], "unguarded export const = async must be red");

const redGuardAfterSensitive = `
export async function leak() {
  const rows = await prisma.user.findMany();
  const s = await requireOwner();
  return rows;
}`;
assert.deepEqual(findUnguarded(redGuardAfterSensitive), ["leak"], "guard AFTER sensitive op must be red");

const redStorage = `
export async function leak() {
  return storage.presignedGet("k");
}`;
assert.deepEqual(findUnguarded(redStorage), ["leak"], "unguarded storage access must be red");

const redQueue = `
export async function leak() {
  return getBoss().send("job", {});
}`;
assert.deepEqual(findUnguarded(redQueue), ["leak"], "unguarded queue access must be red");

// ── findUnguarded: green cases (guards recognized, incl. requireOwner) ──
for (const guard of ["requireSession", "requireRole", "requireAdmin", "requireOwner"]) {
  const green = `
export async function ok() {
  const s = await ${guard}();
  if ("error" in s) return s;
  return prisma.user.findMany();
}`;
  assert.deepEqual(findUnguarded(green), [], `${guard} before sensitive op must be green`);
}
assert.deepEqual(findUnguarded("export async function pure() { return 1; }"), [], "no sensitive op → green");

// ── scan: recursion + .tsx + tolerant directive, end-to-end on a temp dir ──
const dir = mkdtempSync(join(tmpdir(), "vag-test-"));
try {
  mkdirSync(join(dir, "sub"));
  mkdirSync(join(dir, "__tests__"));
  // red: nested subdirectory + .tsx + single-quote directive + leading comment
  writeFileSync(join(dir, "sub", "leak-actions.tsx"), "// header\n'use server';\nexport async function nestedLeak() { return prisma.user.findMany(); }\n");
  // green: guarded top-level .ts
  writeFileSync(join(dir, "ok-actions.ts"), '"use server";\nexport async function ok() { const s = await requireOwner(); return prisma.user.findMany(); }\n');
  // out of scope: not a use-server file
  writeFileSync(join(dir, "helper.ts"), "export const x = 1;\n");
  // out of scope: __tests__ are excluded even with a directive
  writeFileSync(join(dir, "__tests__", "fixture-actions.ts"), '"use server";\nexport async function testLeak() { return prisma.user.findMany(); }\n');

  const { files, bad } = scan(dir);
  assert.equal(files.length, 2, "scan finds exactly the two use-server files (nested .tsx + top-level .ts)");
  assert.deepEqual(bad, ["sub/leak-actions.tsx:nestedLeak"], "nested single-quote .tsx leak must be the one red");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ── isServerOnlySource: import detection (not a directive, so no prologue rule) ──
assert.equal(isServerOnlySource('import "server-only";\nexport {};'), true, "double-quote import");
assert.equal(isServerOnlySource("import 'server-only';\nexport {};"), true, "single-quote import");
assert.equal(
  isServerOnlySource('import { prisma } from "@fikirtive/db";\nimport "server-only";\n'),
  true,
  "server-only import need not be first (not a directive)",
);
assert.equal(isServerOnlySource('import "server-only-ish";\nexport {};'), false, "lookalike package name is not a match");
assert.equal(isServerOnlySource("export const x = 1;\n"), false, "no server-only import");

// ── findUnwrapped: red cases (unwrapped gateway export MUST be caught) ──
const redUnwrappedFunction = `
export async function leak(input) {
  return customerInboxService.listConversations(input);
}`;
assert.deepEqual(findUnwrapped(redUnwrappedFunction), ["leak"], "export async function with no wrapper call must be red");

const redUnwrappedConst = `
export const leak = async (input) => {
  return customerInboxService.listConversations(input);
};`;
assert.deepEqual(findUnwrapped(redUnwrappedConst), ["leak"], "export const = async with no wrapper call must be red");

// ── findUnwrapped: green cases (each of the three accepted wrapper calls) ──
assert.deepEqual(
  findUnwrapped(`
export async function ok(input) {
  return runRead((principal) => service.list(principal, input));
}`),
  [],
  "runRead call must be green",
);
assert.deepEqual(
  findUnwrapped(`
export async function ok(input) {
  return runMutation((principal) => service.save(principal, input));
}`),
  [],
  "runMutation call must be green",
);
assert.deepEqual(
  findUnwrapped(`
export async function ok() {
  const principal = await resolvePrincipal();
  return service.list(principal);
}`),
  [],
  "resolvePrincipal call direct must be green",
);
assert.deepEqual(
  findUnwrapped(`
export async function a() { return runRead((p) => service.a(p)); }
export async function b() { return runMutation((p) => service.b(p)); }
export async function leak() { return service.c(); }
`),
  ["leak"],
  "only the unwrapped export among several must be flagged",
);

// ── scanGateways: recursion + scope filters, end-to-end on a temp dir ──
const gwDir = mkdtempSync(join(tmpdir(), "vag-gw-test-"));
try {
  mkdirSync(join(gwDir, "sub"));
  mkdirSync(join(gwDir, "__tests__"));
  // red: nested subdirectory + server-only + one wrapped, one unwrapped export
  writeFileSync(
    join(gwDir, "sub", "widget-gateway.ts"),
    'import "server-only";\n' +
      "async function resolvePrincipal() { return {}; }\n" +
      "async function runRead(op) { return op(await resolvePrincipal()); }\n" +
      "export async function ok(input) { return runRead((p) => service.list(p, input)); }\n" +
      "export async function leak(input) { return service.list(input); }\n",
  );
  // out of scope: gateway filename but no server-only import
  writeFileSync(
    join(gwDir, "no-server-only-gateway.ts"),
    "export async function leak() { return service.list(); }\n",
  );
  // out of scope: server-only import but not a *-gateway file
  writeFileSync(
    join(gwDir, "helper.ts"),
    'import "server-only";\nexport async function leak() { return service.list(); }\n',
  );
  // out of scope: __tests__ excluded even with server-only + gateway naming
  writeFileSync(
    join(gwDir, "__tests__", "fixture-gateway.ts"),
    'import "server-only";\nexport async function leak() { return service.list(); }\n',
  );

  const { files, bad } = scanGateways(gwDir);
  assert.equal(files.length, 1, "scanGateways finds exactly the one in-scope server-only *-gateway.ts file");
  assert.deepEqual(bad, ["sub/widget-gateway.ts:leak"], "unwrapped export in the nested gateway file must be the one red");
} finally {
  rmSync(gwDir, { recursive: true, force: true });
}

// ── Acceptance: the live repo's gateways are all green ──
{
  const { files, bad } = scanGateways(REAL_LIB);
  assert.deepEqual(bad, [], "apps/web/lib gateways must currently be all green");
  const relFiles = files.map((f) => f.slice(REAL_LIB.length + 1));
  assert.ok(relFiles.includes("customer-inbox-gateway.ts"), "customer-inbox-gateway.ts must be discovered");
  assert.ok(relFiles.includes("customer-broadcast-gateway.ts"), "customer-broadcast-gateway.ts must be discovered");
}

// ── Acceptance: injecting one unwrapped export into a COPY of the real gateway
// turns the fence red, without ever touching the real business file. ──
{
  const realSrc = readFileSync(join(REAL_LIB, "customer-inbox-gateway.ts"), "utf8");
  assert.ok(!realSrc.includes("injectedLeak"), "sanity: real file has no injectedLeak export to begin with");
  const mutated = realSrc + "\nexport async function injectedLeak(input) {\n  return prisma.user.findMany();\n}\n";

  const fixtureDir = mkdtempSync(join(tmpdir(), "vag-gw-injected-"));
  try {
    writeFileSync(join(fixtureDir, "customer-inbox-gateway.ts"), mutated);
    const { bad } = scanGateways(fixtureDir);
    assert.deepEqual(
      bad,
      ["customer-inbox-gateway.ts:injectedLeak"],
      "deliberately unwrapped export added to a copy of the real gateway must be the only red entry",
    );
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

console.log("✓ verify-auth-guards red-case tests passed");
