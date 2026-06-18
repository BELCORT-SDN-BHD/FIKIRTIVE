// Source-scan guard (no DB): every exported server action in a file-level
// "use server" lib file must call requireSession/requireRole/requireAdmin BEFORE
// its first sensitive op (prisma / storage / getBoss). Dynamically enumerates files
// so a NEW use-server file can't silently bypass the wall. Catches both
// `export async function` and `export const x = async` action shapes, and treats
// DB *and* storage *and* queue access as sensitive (not just prisma).
// Run: node scripts/verify-auth-guards.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LIB = "apps/web/lib";
const GUARDS = /\b(requireSession|requireRole|requireAdmin)\s*\(/;
const SENSITIVE = /\bprisma\.|\bstorage\.|\bgetBoss\s*\(/; // DB | object storage | job queue

const files = readdirSync(LIB).filter((f) => f.endsWith(".ts"))
  .filter((f) => readFileSync(join(LIB, f), "utf8").startsWith('"use server"'));

// Every exported action's name + the offset where its body starts. Both shapes:
// `export async function NAME(` and `export const NAME = async`.
function actionStarts(src) {
  const out = [];
  const re = /export\s+(?:async\s+function\s+([A-Za-z0-9_]+)|const\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*async\b)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ name: m[1] ?? m[2], at: m.index });
  return out.sort((a, b) => a.at - b.at);
}

let bad = [];
for (const f of files) {
  const src = readFileSync(join(LIB, f), "utf8");
  const starts = actionStarts(src);
  for (let i = 0; i < starts.length; i++) {
    const body = src.slice(starts[i].at, starts[i + 1]?.at ?? src.length);
    const sensitiveAt = body.search(SENSITIVE);
    if (sensitiveAt === -1) continue; // no DB/storage/queue access → nothing to gate
    const guardAt = body.search(GUARDS);
    if (guardAt === -1 || guardAt > sensitiveAt) bad.push(`${f}:${starts[i].name}`);
  }
}

if (bad.length) {
  console.error("✗ UNGUARDED actions (sensitive op before/without requireSession):\n  " + bad.join("\n  "));
  process.exit(1);
}
console.log(`✓ all exported actions in ${files.length} use-server files guard before any prisma/storage/getBoss`);
