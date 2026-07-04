import "server-only";
import { prisma } from "@fikirtive/db";
import { newId, validateScheduleDraft, type ScheduleDraftInput } from "@fikirtive/core";

/**
 * schedule-service — THE single schedule-draft write authority (#123).
 *
 * Both write paths call `draftScheduledPost`:
 *   • the human server action  apps/web/lib/schedule-actions.ts:createScheduledPost
 *   • the Otto skill           packages/otto/src/skills/schedule-posts.ts (via the ctx.schedule port,
 *                              injected in apps/web/lib/otto-actions.ts:buildOttoContext)
 * so validation (shared core `validateScheduleDraft`: channel caps / caption / datetime / tz),
 * owner-scoped media ownership, and the DB shape are defined ONCE — no divergence.
 *
 * $0. Always DRAFT, source-tagged, approvedAt NULL — it never approves, never publishes, never spends.
 * It is NOT a `"use server"` module (that would expose it as a bare POSTable Server Action with a
 * trusted ownerId param); it is an internal helper the gated action / ctx port call.
 */
export type DraftScheduledPostArgs = {
  ownerId: string;
  projectId: string;
  source: "owner" | "otto";
  input: ScheduleDraftInput;
};

export async function draftScheduledPost(
  args: DraftScheduledPostArgs,
): Promise<{ ok: true; id: string } | { error: string }> {
  const v = validateScheduleDraft(args.input);
  if ("error" in v) return v;
  const d = v.value;

  // Cross-tenant media guard: every media id must be a Generation the owner owns. A foreign/unknown
  // id is REJECTED (never silently dropped) so a post is never created missing its intended media.
  if (d.media.length) {
    const owned = await prisma.generation.findMany({
      where: { id: { in: d.media }, ownerId: args.ownerId, deletedAt: null },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((g) => g.id));
    if (d.media.some((id) => !ownedIds.has(id))) return { error: "Some selected media isn't yours." };
  }

  try {
    const id = newId();
    await prisma.scheduledPost.create({
      data: {
        id,
        ownerId: args.ownerId, // from the caller's gate/ctx — never a client-supplied owner
        projectId: args.projectId,
        channel: d.channel,
        metaTargetId: d.metaTargetId,
        caption: d.caption,
        firstComment: d.firstComment,
        scheduledAt: d.scheduledAt,
        scheduledTz: d.scheduledTz,
        status: "DRAFT",
        publishMode: "AUTO",
        source: args.source,
        approvedAt: null,
        media: d.media.length
          ? { create: d.media.map((generationId, position) => ({ id: newId(), generationId, position })) }
          : undefined,
      },
    });
    return { ok: true, id };
  } catch {
    return { error: "Couldn't save that — please try again." };
  }
}
