import "server-only";
import { prisma } from "@fikirtive/db";
import { FOUNDER_OWNER_ID } from "@fikirtive/core";

/**
 * Admin "Otto conversations" viewer (founder ops tool — section: content).
 * READ-ONLY, platform-wide (cross-tenant by design, requireRole-gated at the page).
 *
 * Two tenant-guard rules shape every query here:
 *   - findUnique / groupBy are EXEMPT → single-thread lookups use findUnique, message
 *     counts use groupBy.
 *   - findMany is CHECKED → every list query carries an explicit ownerId predicate
 *     (`ownerId: { in: orgIds }`, or `ownerId: thread.ownerId`). So the reads are
 *     cross-tenant yet each query is pinned to a known owner set — never an unscoped scan.
 *
 * ChatThread has no Prisma relation to Project or ChatMessage (only a projectId scalar),
 * so project names + message counts are fetched separately.
 *
 * NEVER emits a storage URL. GEN_RESULT/GEN_CARD payloads can hold `/files/<key>` paths
 * whose key embeds the owning tenant; cross-tenant they 403 at /files anyway, so only safe
 * metadata (capability / prompt / cost) is shaped out.
 */

const LIST_LIMIT = 50;
const MESSAGE_LIMIT = 500; // cap a single transcript read (a normal Otto thread is tens of messages)

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

/** A single transcript message, shaped to SAFE fields only (no storage URLs). */
export type ConversationMessage = {
  id: string;
  role: "USER" | "AGENT";
  kind: "TEXT" | "PLAN" | "GEN_CARD" | "GEN_RESULT" | "DENIAL" | "TURN_ERROR";
  seq: number;
  text: string;
  createdAt: string; // ISO
  // kind-specific safe extras (all optional)
  planSteps?: string[];
  card?: { capability: string; prompt: string; estimatedPriceUsd: number | null };
  result?: { capability: string; genJobId: string | null; status: string | null; spentUsd: number | null };
};

export type ConversationDetail = {
  threadId: string;
  title: string;
  projectId: string;
  projectName: string;
  ownerId: string;
  ownerEmail: string;
  createdAt: string;
  messages: ConversationMessage[];
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
    // message counts — groupBy is guard-exempt
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
}

export async function getConversation(threadId: string): Promise<ConversationDetail | null> {
  // findUnique is guard-exempt (unique-key access) — the cross-tenant single read.
  const thread = await prisma.chatThread.findUnique({
    where: { id: threadId },
    select: { id: true, ownerId: true, projectId: true, title: true, createdAt: true, deletedAt: true },
  });
  if (!thread || thread.deletedAt) return null; // deleted threads are not surfaced (matches app behavior)

  const [project, rows, emails] = await Promise.all([
    prisma.project.findUnique({ where: { id: thread.projectId }, select: { name: true } }), // exempt
    // Messages pinned to THIS thread's owner (ownerId present → guard-safe), live only, bounded.
    prisma.chatMessage.findMany({
      where: { threadId, ownerId: thread.ownerId, deletedAt: null },
      orderBy: { seq: "asc" },
      take: MESSAGE_LIMIT,
      select: { id: true, role: true, kind: true, seq: true, text: true, payload: true, genJobId: true, createdAt: true },
    }),
    ownerEmailMap([thread.ownerId]),
  ]);

  // Batch-resolve GenJob status + cost for GEN_RESULT rows (pinned to the owner → guard-safe).
  const jobIds = rows.map((r) => r.genJobId).filter((x): x is string => !!x);
  const jobs = jobIds.length
    ? await prisma.genJob.findMany({
        where: { id: { in: jobIds }, ownerId: thread.ownerId },
        select: { id: true, status: true, spentUsd: true },
      })
    : [];
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  const messages: ConversationMessage[] = rows.map((m) => {
    const base: ConversationMessage = {
      id: m.id,
      role: m.role as ConversationMessage["role"],
      kind: m.kind as ConversationMessage["kind"],
      seq: m.seq,
      text: m.text,
      createdAt: m.createdAt.toISOString(),
    };
    if (m.kind === "PLAN" && m.payload && typeof m.payload === "object") {
      const steps = (m.payload as { planSteps?: unknown }).planSteps;
      if (Array.isArray(steps)) base.planSteps = steps.filter((s): s is string => typeof s === "string");
    } else if (m.kind === "GEN_CARD" && m.payload && typeof m.payload === "object") {
      const p = m.payload as Record<string, unknown>;
      const capability = p.kind === "video" ? "Video" : "Image";
      base.card = {
        capability,
        prompt: typeof p.structuredPrompt === "string" ? p.structuredPrompt : "",
        estimatedPriceUsd: typeof p.estimatedPriceUsd === "number" ? p.estimatedPriceUsd : null,
      };
    } else if (m.kind === "GEN_RESULT") {
      const p = (m.payload ?? {}) as Record<string, unknown>;
      const job = m.genJobId ? jobById.get(m.genJobId) : undefined;
      base.result = {
        capability: p.kind === "video" ? "Video" : "Image",
        genJobId: m.genJobId,
        status: job?.status ?? null,
        spentUsd: typeof job?.spentUsd === "number" ? job.spentUsd : null,
      };
    }
    return base;
  });

  return {
    threadId: thread.id,
    title: thread.title,
    projectId: thread.projectId,
    projectName: project?.name ?? "(deleted project)",
    ownerId: thread.ownerId,
    ownerEmail: ownerLabel(emails, thread.ownerId),
    createdAt: thread.createdAt.toISOString(),
    messages,
  };
}
