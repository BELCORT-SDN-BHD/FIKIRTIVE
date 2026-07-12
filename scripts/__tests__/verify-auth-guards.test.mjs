// Permanent red-case tests for scripts/verify-auth-guards.mjs (SOL 复审 D-018⑤).
// Feeds fixture STRINGS (and a throwaway temp dir) to the exported matching
// functions and asserts the scanner still turns red — no real violating files
// ever land in the repo. Run: node scripts/__tests__/verify-auth-guards.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findUnguarded, isUseServerSource, scan } from "../verify-auth-guards.mjs";

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

console.log("✓ verify-auth-guards red-case tests passed");
