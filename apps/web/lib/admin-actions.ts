"use server";
/**
 * Admin actions for the cowork knowledge base (Phase 0B). R7: every handler
 * re-asserts auth() + the email allowlist INSIDE the handler, independent of the
 * opt-in middleware wall (proxy.ts / AUTH_ENABLED). Single-tenant: any
 * allowlisted session is the founder, so all writes use FOUNDER_OWNER_ID.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@artlio/db";
import { newId, FOUNDER_OWNER_ID, modelDirectiveInput, DIRECTIVE_SEED } from "@artlio/core";
import { auth, allowed } from "@/auth";

/** auth() + allowlist, inside the handler (R7). Returns the admin's email (for
 *  the revision's editedBy) or an {error} the caller returns verbatim. */
async function requireAdmin(): Promise<{ email: string } | { error: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !allowed(email)) return { error: "Not authorized." };
  return { email };
}

/** Upsert one (family, mode) directive cell + append a revision snapshot (R6) +
 *  audit, atomically. A founder edit takes effect on the next Enhance (the read
 *  is uncached, R6). Omitting `rules` preserves the stored rules (Prisma treats
 *  undefined as "leave unchanged" on update). */
export async function saveModelDirective(
  raw: unknown,
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const parsed = modelDirectiveInput.safeParse(raw);
  if (!parsed.success) return { error: "That directive is out of bounds." };
  const { family, mode, directive, rules, notes, confidence, enabled, source } = parsed.data;
  const rulesJson = rules ?? undefined; // undefined → unchanged on update / null on create

  try {
    await prisma.$transaction(async (tx) => {
      // upsert returns the real row id (race-safe vs computing an id up front)
      const row = await tx.modelDirective.upsert({
        where: { ownerId_family_mode: { ownerId: FOUNDER_OWNER_ID, family, mode } },
        create: { id: newId(), ownerId: FOUNDER_OWNER_ID, family, mode, directive, rules: rulesJson, notes, confidence, enabled, source },
        update: { directive, rules: rulesJson, notes, confidence, enabled, source },
        select: { id: true, directive: true, rules: true, confidence: true, enabled: true, source: true },
      });
      await tx.modelDirectiveRevision.create({
        data: { id: newId(), directiveId: row.id, ownerId: FOUNDER_OWNER_ID, directive: row.directive, rules: row.rules ?? undefined, confidence: row.confidence, enabled: row.enabled, source: row.source, editedBy: gate.email },
      });
      await tx.actionEvent.create({
        data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "directive.edit", payload: { family, mode, confidence, enabled, via: gate.email } },
      });
    });
  } catch {
    return { error: "Couldn't save the directive — please try again." };
  }
  revalidatePath("/admin/directives");
  return { ok: true };
}

/** Sync the research seed: INSERT cells that are still absent, and REFRESH cells
 *  that are still pristine seed (source "research" AND no founder revision) to the
 *  current DIRECTIVE_SEED text. Never clobbers a founder edit — a founder save sets
 *  source!="research" and always writes a revision, so edited cells are skipped.
 *  This is what lets improved research directives reach prod without a migration. */
export async function seedResearchDirectives(): Promise<{ ok: true; inserted: number; refreshed: number } | { error: string }> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  try {
    const res = await prisma.modelDirective.createMany({
      data: DIRECTIVE_SEED.map((c) => ({
        id: newId(), ownerId: FOUNDER_OWNER_ID, family: c.family, mode: c.mode,
        directive: c.directive, rules: c.rules ?? undefined, notes: c.notes,
        confidence: c.confidence, enabled: true, source: "research",
      })),
      skipDuplicates: true,
    });
    // refresh pristine cells (never founder-touched) to the latest seed. The pristine
    // guard is INSIDE the updateMany WHERE, so it re-checks atomically — a founder save
    // landing mid-refresh writes a revision, the WHERE stops matching, count is 0, no
    // clobber. A founder save can keep source="research" (admin UI), so the revision
    // check (not source) is the load-bearing guard. Updates all seeded fields, not just text.
    let refreshed = 0;
    for (const c of DIRECTIVE_SEED) {
      const upd = await prisma.modelDirective.updateMany({
        where: { ownerId: FOUNDER_OWNER_ID, family: c.family, mode: c.mode, source: "research", revisions: { none: {} } },
        data: { directive: c.directive, rules: c.rules ?? undefined, notes: c.notes, confidence: c.confidence },
      });
      refreshed += upd.count;
    }
    await prisma.actionEvent.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "directive.seed", payload: { inserted: res.count, refreshed, via: gate.email } },
    });
    revalidatePath("/admin/directives");
    return { ok: true, inserted: res.count, refreshed };
  } catch {
    return { error: "Couldn't seed defaults — please try again." };
  }
}
