/**
 * chat-thread-rename — the ONE place a ChatThread's title gets written.
 *
 * #952 item 13 — the human-facing rename action (apps/web's `coworkRenameThread`) and Otto's
 * own `setTitle` skill each hand-rolled the same `prisma.chatThread.updateMany({where:{id,
 * ownerId, deletedAt:null}, data:{title}})` — the one shared-action-layer gap the #952 audit
 * found (every other write path in the product already routes the human UI and Otto through the
 * same business action; see CLAUDE.md "Shared actions"). Both callers keep their OWN auth/
 * identity resolution, input validation (length caps, trimming), and post-write side effects
 * (e.g. `revalidatePath`) — only the write itself moves here.
 */
import { prisma } from "./client.js";

/**
 * Rename an owner's chat thread. `ownerId` must already be a trusted, server-resolved value —
 * this function does no auth of its own (the caller's gate/context already established it).
 * Returns the number of rows updated: 0 means the thread doesn't exist, isn't this owner's, or
 * is already soft-deleted — the caller decides how to report that (a "not found" error on the
 * human side; Otto's skill has never distinguished the case).
 */
export async function renameChatThread(args: {
  threadId: string;
  ownerId: string;
  title: string;
}): Promise<{ count: number }> {
  return prisma.chatThread.updateMany({
    where: { id: args.threadId, ownerId: args.ownerId, deletedAt: null },
    data: { title: args.title },
  });
}
