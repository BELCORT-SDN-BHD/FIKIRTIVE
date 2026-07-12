// Source-scan guard (no DB): every exported server action in a file-level
// "use server" lib file must call requireSession/requireRole/requireAdmin/requireOwner BEFORE
// its first sensitive op (prisma / storage / getBoss). Dynamically enumerates files
// (recursively, .ts AND .tsx, tolerant "use server" prologue detection) so a NEW
// use-server file can't silently bypass the wall. Catches both
// `export async function` and `export const x = async` action shapes, and treats
// DB *and* storage *and* queue access as sensitive (not just prisma).
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

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { files, bad } = scan(LIB);
  if (bad.length) {
    console.error("✗ UNGUARDED actions (sensitive op before/without requireSession):\n  " + bad.join("\n  "));
    process.exit(1);
  }
  console.log(`✓ all exported actions in ${files.length} use-server files guard before any prisma/storage/getBoss`);
}
