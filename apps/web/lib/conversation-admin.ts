import "server-only";
import { prisma } from "@fikirtive/db";
import { runAsSystem } from "@fikirtive/db/principal";
import { FOUNDER_OWNER_ID } from "@fikirtive/core";

/**
 * Admin "Otto conversations" list (founder ops tool — section: content).
 * READ-ONLY, platform-wide (cross-tenant by design, requireRole-gated at the page).
 * METADATA ONLY: thread title, owner, project, message count, last-active time.
 * No transcript reader lives here — the cross-tenant message-body reader
 * (`getConversation`) was removed in C2b as a zero-caller export, and the privacy page's
 * "founder cannot read your messages" claim rests on there being no such code path.
 *
 * HOW THE TENANT GUARD SEES THIS FILE (corrected 2026-08-08, #738):
 *   NOTHING IS EXEMPT ANY MORE. `6b6c537c` (#626) put findUnique / count / aggregate / groupBy
 *   into the guard's SCOPED_WHERE_OPS alongside findMany, and this comment — which said
 *   "findUnique / groupBy are EXEMPT" — outlived that change by four days while every read
 *   below threw. The export therefore declares what it actually is: a founder-only
 *   PLATFORM READ, run under `runAsSystem("admin:platform-read", …)`. That name is on the
 *   guard's READ_ONLY_SYSTEM_REASONS list, so the frame may scan across owners and is REFUSED
 *   every write — any model (tenant, exempt, or unguarded), nested relation writes, and raw SQL
 *   included. Not "we checked and it only reads": it cannot write. See
 *   `packages/db/src/__tests__/read-only-system-frame.test.ts`.
 *
 *   The explicit owner predicates below stay as they are: `ownerId: { in: orgIds }` keeps each
 *   query pinned to a known owner set rather than an unbounded scan. They are a bound on the
 *   read, not the thing that satisfies the guard.
 *
 * ChatThread has no Prisma relation to Project or ChatMessage (only a projectId scalar),
 * so project names + message counts are fetched separately.
 */

const LIST_LIMIT = 50;

export type ConversationRow = {
  threadId: string;
  projectId: string;
  projectName: string;
  ownerId: string;
  ownerEmail: string;
  title: string;
  messageCount: number;
  lastActiveAt: string; // ISO
};

/** owner org id → owner email (the org's `owner`-role member), best-effort. */
async function ownerEmailMap(orgIds: string[]): Promise<Map<string, string>> {
  if (orgIds.length === 0) return new Map();
  const members = await prisma.membership.findMany({
    where: { orgId: { in: orgIds }, role: "owner" },
    select: { orgId: true, user: { select: { email: true } } },
  });
  const m = new Map<string, string>();
  for (const r of members) if (r.user?.email) m.set(r.orgId, r.user.email);
  return m;
}

function ownerLabel(map: Map<string, string>, ownerId: string): string {
  if (ownerId === FOUNDER_OWNER_ID) return map.get(ownerId) ?? "founder";
  return map.get(ownerId) ?? ownerId;
}

export async function listConversations(): Promise<ConversationRow[]> {
  return runAsSystem("admin:platform-read", async (): Promise<ConversationRow[]> => {
    // The most recent threads across ALL tenants, bounded by take. `ownerId: { not: "" }`
    // matches every row (ownerId is always a non-empty org id) AND satisfies the tenant-guard
    // (the where carries an ownerId predicate) — so we get a cross-tenant read with NO org scan
    // and no unbounded IN list as tenants grow.
    const threads = await prisma.chatThread.findMany({
      where: { ownerId: { not: "" }, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: LIST_LIMIT,
      select: { id: true, ownerId: true, projectId: true, title: true, updatedAt: true },
    });
    if (threads.length === 0) return [];

    const threadIds = threads.map((t) => t.id);
    const ownerIds = [...new Set(threads.map((t) => t.ownerId))];
    const projectIds = [...new Set(threads.map((t) => t.projectId))];
    const [projects, counts, emails] = await Promise.all([
      // project names — ownerId present → guard-safe
      prisma.project.findMany({ where: { id: { in: projectIds }, ownerId: { in: ownerIds } }, select: { id: true, name: true } }),
      // message counts — a platform-wide groupBy, legal under this file's system frame
      prisma.chatMessage.groupBy({ by: ["threadId"], where: { threadId: { in: threadIds }, deletedAt: null }, _count: { _all: true } }),
      ownerEmailMap(ownerIds),
    ]);
    const nameByProject = new Map(projects.map((p) => [p.id, p.name]));
    const countByThread = new Map(counts.map((c) => [c.threadId, c._count._all]));

    return threads.map((t) => ({
      threadId: t.id,
      projectId: t.projectId,
      projectName: nameByProject.get(t.projectId) ?? "(deleted project)",
      ownerId: t.ownerId,
      ownerEmail: ownerLabel(emails, t.ownerId),
      title: t.title,
      messageCount: countByThread.get(t.id) ?? 0,
      lastActiveAt: t.updatedAt.toISOString(),
    }));
  });
}

