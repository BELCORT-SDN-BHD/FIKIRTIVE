// Source-scan guard (no DB): every exported server action in a file-level
// "use server" lib file must call requireSession/requireRole/requireAdmin/requireOwner BEFORE
// its first sensitive op (prisma / storage / getBoss). Dynamically enumerates files
// (recursively, .ts AND .tsx, tolerant "use server" prologue detection) so a NEW
// use-server file can't silently bypass the wall. Catches both
// `export async function` and `export const x = async` action shapes, and treats
// DB *and* storage *and* queue access as sensitive (not just prisma).
//
// Second fence (issue #389 / ledger #359 item 23): the "use server" scan above
// is blind to the server-only gateway pattern used by customer-inbox-gateway.ts
// and customer-broadcast-gateway.ts — `import "server-only"` modules whose every
// exported function is meant to be a thin wrapper that resolves a principal via
// runRead/runMutation (or resolvePrincipal directly) before calling the service
// layer. That pattern has no `requireSession`-style call directly in the export
// body, so the first fence can't see it; only a runtime enumeration test (added
// in PR #377) caught a hypothetically-unwrapped export. This scan dynamically
// enumerates every `apps/web/lib/**/*-gateway.ts(x)` file that imports
// "server-only" and asserts each exported function routes through one of those
// three names, so a new unwrapped gateway export is red at the static-scan stage
// too, not just at test time.
//
// Matching functions are exported for the red-case tests in
// scripts/__tests__/verify-auth-guards.test.mjs (fixture strings, no real violations).
// Run: node scripts/verify-auth-guards.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const LIB = "apps/web/lib";
export const GUARDS = /\b(requireSession|requireRole|requireAdmin|requireOwner)\s*\(/;
export const SENSITIVE = /\bprisma\.|\bstorage\.|\bgetBoss\s*\(/; // DB | object storage | job queue

export function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

// A file-level "use server" directive: at the top of the module, but a BOM,
// whitespace, and leading line/block comments may precede it, and either quote
// style is legal. Strict `startsWith('"use server"')` missed all of those.
export function isUseServerSource(src) {
  let s = src.replace(/^﻿/, "");
  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, "");
    if (s.startsWith("//")) {
      const nl = s.indexOf("\n");
      s = nl === -1 ? "" : s.slice(nl + 1);
    } else if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end === -1 ? "" : s.slice(end + 2);
    }
    if (s === before) break;
  }
  return /^(['"])use server\1/.test(s);
}

// Every exported action's name + the offset where its body starts. Both shapes:
// `export async function NAME(` and `export const NAME = async`.
export function actionStarts(src) {
  const out = [];
  const re = /export\s+(?:async\s+function\s+([A-Za-z0-9_]+)|const\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*async\b)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ name: m[1] ?? m[2], at: m.index });
  return out.sort((a, b) => a.at - b.at);
}

// Names of exported actions in `src` whose first sensitive op is not preceded by a guard.
export function findUnguarded(src) {
  const bad = [];
  const starts = actionStarts(src);
  for (let i = 0; i < starts.length; i++) {
    const body = src.slice(starts[i].at, starts[i + 1]?.at ?? src.length);
    const sensitiveAt = body.search(SENSITIVE);
    if (sensitiveAt === -1) continue; // no DB/storage/queue access → nothing to gate
    const guardAt = body.search(GUARDS);
    if (guardAt === -1 || guardAt > sensitiveAt) bad.push(starts[i].name);
  }
  return bad;
}

// Scan a lib directory tree. Returns { files, bad } where bad entries are "rel/path.ts:name".
export function scan(libDir) {
  const files = walk(libDir)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !f.split(sep).join("/").includes("/__tests__/"))
    .filter((f) => isUseServerSource(readFileSync(f, "utf8")));
  const bad = [];
  for (const f of files) {
    const rel = relative(libDir, f).split(sep).join("/");
    for (const name of findUnguarded(readFileSync(f, "utf8"))) bad.push(`${rel}:${name}`);
  }
  return { files, bad };
}

// A `-gateway.ts`/`.tsx` module. Naming, not directive-based (server-only has
// no special first-statement rule the way "use server"/"use client" do).
export const GATEWAY_FILENAME = /-gateway\.tsx?$/;
// `import "server-only"` (either quote style), anywhere in the module.
export const SERVER_ONLY_IMPORT = /import\s+(['"])server-only\1/;
export function isServerOnlySource(src) {
  return SERVER_ONLY_IMPORT.test(src);
}

// The three names the resolvePrincipal/runRead/runMutation gateway pattern uses
// to route a call through principal resolution (see customer-inbox-gateway.ts,
// customer-broadcast-gateway.ts). A gateway export's body must call one of these.
export const WRAPPER_CALL = /\b(?:runRead|runMutation|resolvePrincipal)\s*\(/;

// Names of exported functions in a server-only gateway `src` whose body never
// calls runRead/runMutation/resolvePrincipal — i.e. exports a function that
// wasn't proven to route through principal resolution.
export function findUnwrapped(src) {
  const bad = [];
  const starts = actionStarts(src);
  for (let i = 0; i < starts.length; i++) {
    const body = src.slice(starts[i].at, starts[i + 1]?.at ?? src.length);
    if (!WRAPPER_CALL.test(body)) bad.push(starts[i].name);
  }
  return bad;
}

// Scan a lib directory tree for server-only `*-gateway.ts(x)` files. Returns
// { files, bad } where bad entries are "rel/path.ts:name".
export function scanGateways(libDir) {
  const files = walk(libDir)
    .filter((f) => GATEWAY_FILENAME.test(f))
    .filter((f) => !f.split(sep).join("/").includes("/__tests__/"))
    .filter((f) => isServerOnlySource(readFileSync(f, "utf8")));
  const bad = [];
  for (const f of files) {
    const rel = relative(libDir, f).split(sep).join("/");
    for (const name of findUnwrapped(readFileSync(f, "utf8"))) bad.push(`${rel}:${name}`);
  }
  return { files, bad };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { files, bad } = scan(LIB);
  const gateways = scanGateways(LIB);
  let failed = false;
  if (bad.length) {
    failed = true;
    console.error("✗ UNGUARDED actions (sensitive op before/without requireSession):\n  " + bad.join("\n  "));
  }
  if (gateways.bad.length) {
    failed = true;
    console.error(
      "✗ UNWRAPPED gateway exports (missing runRead/runMutation/resolvePrincipal):\n  " +
        gateways.bad.join("\n  "),
    );
  }
  if (failed) process.exit(1);
  console.log(`✓ all exported actions in ${files.length} use-server files guard before any prisma/storage/getBoss`);
  console.log(
    `✓ all exported functions in ${gateways.files.length} server-only gateway files route through runRead/runMutation/resolvePrincipal`,
  );
}
