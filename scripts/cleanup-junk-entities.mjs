#!/usr/bin/env node
/**
 * cleanup-junk-entities — soft-delete test-script "junk" entities from ONE owner's account.
 *
 * WHY: the prod E2E persona scripts (prod-pass1-careful / prod-pass2-sloppy /
 * prod-pass3-brute / prod-quality-sampler) ran against the LIVE site under the founder's
 * session and created CHARACTER entities named Brute* / PassOne* / SloppyNoRef* /
 * SloppyRef* / Mira* / RefGen*, then never cleaned up (audit STUFF-1 / STUFF-14). This
 * removes them so My Stuff isn't a wall of garbage.
 *
 * SAFE BY DEFAULT:
 *   - DRY RUN unless you pass --apply (prints exactly what would be removed).
 *   - SOFT delete only (sets deletedAt) — fully reversible (set deletedAt back to null).
 *   - OWNER-SCOPED (default: the founder org "founder") — never touches another tenant.
 *   - Matches by known junk-name PREFIX only — review the printed list before --apply.
 *
 * USAGE:
 *   DATABASE_URL=<prod-url> node scripts/cleanup-junk-entities.mjs              # dry run (review)
 *   DATABASE_URL=<prod-url> node scripts/cleanup-junk-entities.mjs --apply      # soft-delete
 *   ... --owner <ownerId>            (default: "founder")
 *   ... --prefixes Brute,PassOne     (override the junk-name prefixes)
 *
 * Requires @fikirtive/db to be built (pnpm --filter @fikirtive/db build) and DATABASE_URL set.
 */
import { prisma } from "@fikirtive/db";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const owner = flag("--owner") || "founder"; // FOUNDER_OWNER_ID
const DEFAULT_PREFIXES = ["Brute", "PassOne", "SloppyNoRef", "SloppyRef", "Mira", "RefGen"];
const prefixes = (flag("--prefixes")?.split(",").map((s) => s.trim()).filter(Boolean)) || DEFAULT_PREFIXES;

// Pre-flight guards (this touches PROD data — fail loud, never silently).
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Aborting.");
  process.exit(1);
}
if (prefixes.length === 0) {
  console.error("--prefixes produced an empty list — refusing to match. Aborting.");
  process.exit(1);
}

async function main() {
  const matches = await prisma.entity.findMany({
    where: {
      ownerId: owner,
      deletedAt: null,
      OR: prefixes.map((p) => ({ name: { startsWith: p } })),
    },
    select: { id: true, name: true, type: true, _count: { select: { referenceImages: true } } },
    orderBy: { name: "asc" },
  });

  console.log(`Owner    : ${owner}`);
  console.log(`Prefixes : ${prefixes.join(", ")}`);
  console.log(`Matched  : ${matches.length} entit${matches.length === 1 ? "y" : "ies"}`);
  for (const e of matches) {
    console.log(`  - ${e.name}  [${e.type}, ${e._count.referenceImages} ref(s), id=${e.id}]`);
  }

  if (matches.length === 0) {
    console.log("Nothing to clean. ✅");
    return;
  }
  if (!apply) {
    console.log(`\nDRY RUN — nothing changed. Review the list above, then re-run with --apply`);
    console.log(`to SOFT-DELETE these ${matches.length} (reversible: sets deletedAt, restore by nulling it).`);
    return;
  }

  const ids = matches.map((e) => e.id);
  const { count } = await prisma.entity.updateMany({
    where: { id: { in: ids }, ownerId: owner, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  console.log(`\n✅ Soft-deleted ${count} junk entit${count === 1 ? "y" : "ies"} for owner "${owner}".`);
  console.log(`   Reversible: UPDATE "Entity" SET "deletedAt"=NULL WHERE id IN (...) to restore.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("cleanup failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
