import "server-only";
import { prisma } from "@fikirtive/db";
import { newId, storageKey, storageKeyToSrc } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { tallyEntityUsage } from "./entity-usage";
import { threadBadgeFromJobStatus } from "./thread-status";
import { storage } from "./storage";

const THUMB_VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
export type GenerationThumb = {
  src: string;
  kind: "image" | "video";
  width: number | null;
  height: number | null;
};
/** Resolve generation ids → { src, kind } thumbnails (segment frame slots). */
export async function getGenerationThumbs(ownerId: string, ids: string[]): Promise<Record<string, GenerationThumb>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return {};
  const gens = await prisma.generation.findMany({ where: { id: { in: clean }, ownerId, deletedAt: null }, include: { asset: true } });
  const out: Record<string, GenerationThumb> = {};
  for (const g of gens) {
    const ext = g.asset.ext.toLowerCase();
    const key = storageKey(g.asset.ownerId, g.asset.contentHash, ext);
    if (!(await storage.exists(key))) continue;
    out[g.id] = {
      src: storageKeyToSrc(key),
      kind: THUMB_VIDEO_EXTS.has(ext) ? "video" : "image",
      width: g.asset.width,
      height: g.asset.height,
    };
  }
  return out;
}

/** All M0 queries are owner-scoped and exclude soft-deleted rows (D21). */
const notDeleted = { deletedAt: null } as const;

export async function ensureDefaultProject(ownerId: string) {
  const existing = await prisma.project.findFirst({
    where: { ownerId, ...notDeleted },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.project.create({
    data: { id: newId(), ownerId, name: "My First Project" },
  });
}

export async function getProjects(ownerId: string) {
  return prisma.project.findMany({
    where: { ownerId, ...notDeleted },
    orderBy: { createdAt: "asc" },
  });
}

export async function getEntities(ownerId: string) {
  const entities = await prisma.entity.findMany({
    where: { ownerId, ...notDeleted },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: {
      // base-level refs only (variantId null) — variant refs live under `variants`
      referenceImages: {
        where: { ...notDeleted, variantId: null },
        orderBy: { position: "asc" },
        include: { asset: true },
      },
      variants: {
        where: notDeleted,
        orderBy: { createdAt: "asc" },
        include: {
          referenceImages: { where: notDeleted, orderBy: { position: "asc" }, include: { asset: true } },
        },
      },
      _count: { select: { shotRefs: true } },
    },
  });

  // Count DONE Otto gen jobs that referenced each entity (non-legacy usage).
  let ottoUsage: Record<string, number> = {};
  try {
    const ottoJobs = await prisma.genJob.findMany({
      where: { ownerId, status: "DONE", entityIds: { isEmpty: false } },
      select: { entityIds: true },
    });
    ottoUsage = tallyEntityUsage(ottoJobs);
  } catch {
    // Non-critical: fall back to 0 Otto usage rather than throwing.
  }

  return entities.map((e) => ({ ...e, _ottoUsageCount: ottoUsage[e.id] ?? 0 }));
}

export async function getShots(ownerId: string, projectId: string) {
  return prisma.shot.findMany({
    where: { ownerId, projectId, ...notDeleted },
    orderBy: [{ scene: "asc" }, { number: "asc" }],
    include: {
      entityRefs: { include: { entity: true } },
      // NOT capped: studio/page.tsx reads generations[0] (latest preview) AND scans
      // ALL versions for an animatable still (hasStill → Animate gate). A `take` cap
      // would wrongly disable Animate when a still is buried under newer videos, so the
      // per-shot version list stays unbounded (bounded in practice by regeneration count;
      // the worker's still lookup is also uncapped). Project-wide hot paths are capped via
      // getProjectMedia/getCandidates instead. (scale audit 2026-06-20)
      generations: {
        where: notDeleted,
        orderBy: { version: "desc" },
        include: { asset: true },
      },
    },
  });
}

const LOOSE_VIDEO_EXTS = ["mp4", "mov", "webm", "mkv"];
const FRAME_IMG_EXTS = ["png", "jpg", "jpeg", "webp"];

/** Loose VIDEO candidates (unattached, not cowork-produced) for the editor's initial cut,
 *  newest first. Type-filtered in the DB so the editor gets ALL its loose videos up to a
 *  sane ceiling — not "videos that happen to fall in the recent N mixed candidates". An
 *  auto-built timeline tops out at a usable length; the complete library is the paginated
 *  Assets surface. ext is stored lowercase (extFromFilename + the worker's own
 *  `ext: { in: [...] }` filter), so the in-list is safe. (scale audit 2026-06-20) */
export async function getLooseVideoClips(ownerId: string, projectId: string, take = 120) {
  return prisma.generation.findMany({
    where: { ownerId, projectId, shotId: null, threadId: null, ...notDeleted, asset: { ext: { in: LOOSE_VIDEO_EXTS } } },
    orderBy: { createdAt: "desc" },
    take,
    include: { asset: true },
  });
}

/** Loose IMAGE candidates for the Storyboard drag-to-attach strip, newest first. Bounded
 *  recent window — a horizontal drag strip isn't a library; the complete set is the
 *  paginated Assets surface. (scale audit 2026-06-20) */
export async function getFrameCandidates(ownerId: string, projectId: string, take = 120) {
  return prisma.generation.findMany({
    where: { ownerId, projectId, shotId: null, threadId: null, ...notDeleted, asset: { ext: { in: FRAME_IMG_EXTS } } },
    orderBy: { createdAt: "desc" },
    take,
    include: { asset: true },
  });
}

const MEDIA_VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
const MEDIA_SCAN_BUFFER = 20;

/** One Assets-library row (client-safe — no BigInt). Shape matches Assets.MediaItem. */
export type MediaPageItem = { id: string; src: string; kind: "image" | "video"; prompt: string; attached: boolean; shotLabel: string | null };
/** A keyset page of media. `nextCursor` ("<iso>|<id>") feeds the next call; null = end. */
export type MediaPage = { items: MediaPageItem[]; nextCursor: string | null; hasMore: boolean };

/** "Scene N · Shot M" label per shot id (lightweight: no generations include). Mirrors
 *  the badge/picker labels the board uses. Shared by the initial load + load-more. */
async function shotLabelMap(ownerId: string, projectId: string): Promise<Map<string, string>> {
  const shots = await prisma.shot.findMany({
    where: { ownerId, projectId, ...notDeleted },
    orderBy: [{ scene: "asc" }, { number: "asc" }],
    select: { id: true, scene: true },
  });
  const sceneDisplay: Record<number, number> = {};
  [...new Set(shots.map((s) => s.scene))].sort((a, b) => a - b).forEach((sc, i) => { sceneDisplay[sc] = i + 1; });
  const withinScene: Record<number, number> = {};
  const m = new Map<string, string>();
  for (const s of shots) {
    withinScene[s.scene] = (withinScene[s.scene] ?? 0) + 1;
    m.set(s.id, `Scene ${sceneDisplay[s.scene]} · Shot ${withinScene[s.scene]}`);
  }
  return m;
}

export type HistoryThumb = {
  id: string;
  projectId: string;
  assetId: string;
  src: string;
  kind: "image" | "video";
  prompt: string;
};
/** The owner's most recent generations across every project (OTTO + studio),
 *  newest first, for the global Library surface. Display-only: resolves
 *  each generation's asset to a media URL (same resolver as the library/thumbnails).
 *  Owner-scoped, soft-deletes excluded. */
export async function getRecentGenerationThumbs(
  ownerId: string,
  take = 80,
): Promise<HistoryThumb[]> {
  const queryTake = Math.min(Math.max(take * 2, take), 160);
  const rows = await prisma.generation.findMany({
    where: { ownerId, ...notDeleted },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: queryTake,
    include: { asset: true },
  });
  const thumbs = await Promise.all(rows.map(async (g) => {
    const ext = g.asset.ext.toLowerCase();
    const key = storageKey(g.asset.ownerId, g.asset.contentHash, ext);
    if (!(await storage.exists(key))) return null;
    return {
      id: g.id,
      projectId: g.projectId,
      assetId: g.assetId,
      src: storageKeyToSrc(key),
      kind: MEDIA_VIDEO_EXTS.has(ext) ? "video" : "image",
      prompt: g.promptText ?? "",
    };
  }));
  return thumbs.filter((thumb): thumb is HistoryThumb => thumb != null).slice(0, take);
}

/** One keyset page of a project's media (attached + candidates) for the Assets library,
 *  newest first. Cursor = "<createdAt-iso>|<id>" (id breaks createdAt ties so no row is
 *  skipped or repeated across pages). Bounded by `take` → scales to any library size; the
 *  Assets surface appends pages via the loadMoreMedia action. (scale audit 2026-06-20) */
export async function getMediaPage(
  ownerId: string,
  projectId: string,
  cursor?: string | null,
  take = 60,
): Promise<MediaPage> {
  const scanTake = Math.min(Math.max(take + MEDIA_SCAN_BUFFER, take + 1), 100);
  let cursorWhere = {};
  if (cursor) {
    const sep = cursor.lastIndexOf("|");
    const at = new Date(cursor.slice(0, sep));
    const id = cursor.slice(sep + 1);
    if (!Number.isNaN(at.getTime()) && id) {
      cursorWhere = { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] };
    }
  }
  const rows = await prisma.generation.findMany({
    where: { ownerId, projectId, threadId: null, ...notDeleted, ...cursorWhere },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: scanTake + 1,
    include: { asset: true },
  });
  const scanned = rows.slice(0, scanTake);
  const labels = await shotLabelMap(ownerId, projectId);
  const resolved = await Promise.all(scanned.map(async (g) => {
    const ext = g.asset.ext.toLowerCase();
    const key = storageKey(g.asset.ownerId, g.asset.contentHash, ext);
    if (!(await storage.exists(key))) return null;
    return {
      row: g,
      item: {
        id: g.id,
        src: storageKeyToSrc(key),
        kind: MEDIA_VIDEO_EXTS.has(ext) ? "video" : "image",
        prompt: g.promptText ?? "",
        attached: g.shotId != null,
        shotLabel: g.shotId ? (labels.get(g.shotId) ?? null) : null,
      } satisfies MediaPageItem,
    };
  }));
  const existing = resolved.filter((entry): entry is NonNullable<typeof entry> => entry != null);
  const items = existing.slice(0, take).map((entry) => entry.item);
  const cursorRow = existing.length > take
    ? existing[take - 1].row
    : rows.length > scanTake
      ? scanned[scanned.length - 1]
      : null;
  const nextCursor = cursorRow ? `${cursorRow.createdAt.toISOString()}|${cursorRow.id}` : null;
  return { items, nextCursor, hasMore: nextCursor != null };
}

/** Otto's finished ads: cowork-tagged generations (threadId set), newest first.
 *  The mirror of getMediaPage for the Otto surface (which excludes threadId-null
 *  manual-studio gens). Used by Library → Ads. */
export type AdItem = { id: string; projectId: string; assetId: string; src: string; kind: "image" | "video"; prompt: string; createdAt: string };
export async function getMyAds(ownerId: string, take = 60): Promise<AdItem[]> {
  const scanTake = Math.min(Math.max(take + MEDIA_SCAN_BUFFER, take + 1), 100);
  const rows = await prisma.generation.findMany({
    where: { ownerId, threadId: { not: null }, ...notDeleted },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: scanTake,
    include: { asset: true },
  });
  const resolved = await Promise.all(rows.map(async (g) => {
    const ext = g.asset.ext.toLowerCase();
    const key = storageKey(g.asset.ownerId, g.asset.contentHash, ext);
    if (!(await storage.exists(key))) return null;
    return {
      id: g.id,
      projectId: g.projectId,
      assetId: g.assetId,
      src: storageKeyToSrc(key),
      kind: MEDIA_VIDEO_EXTS.has(ext) ? ("video" as const) : ("image" as const),
      prompt: g.promptText ?? "",
      createdAt: g.createdAt.toISOString(),
    };
  }));
  return resolved.filter((item): item is AdItem => item != null).slice(0, take);
}

/** Otto ad jobs that are still running or failed — shown as status cards in Library → Ads.
 *  DONE jobs are excluded (they show as finished media via getMyAds). */
export type AdJobItem = { id: string; projectId: string; threadId: string; kind: "image" | "video"; status: "processing" | "failed"; prompt: string; createdAt: string; error: string };
export async function getMyAdJobs(ownerId: string, take = 30): Promise<AdJobItem[]> {
  const { adJobStatusFromGenStatus } = await import("./ad-job-status");
  const rows = await prisma.genJob.findMany({
    where: { ownerId, threadId: { not: null }, status: { in: ["QUEUED", "GENERATING", "FAILED"] } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, projectId: true, threadId: true, kind: true, status: true, prompt: true, error: true, createdAt: true },
  });
  return rows.flatMap((r) => {
    const status = adJobStatusFromGenStatus(r.status);
    if (!status) return [];
    return [{
      id: r.id,
      projectId: r.projectId,
      threadId: r.threadId ?? "",
      kind: r.kind === "VIDEO" ? ("video" as const) : ("image" as const),
      status,
      prompt: r.prompt ?? "",
      error: r.error ?? "",
      createdAt: r.createdAt.toISOString(),
    }];
  });
}

export type EntityWithRefs = Awaited<ReturnType<typeof getEntities>>[number];
export type ShotWithDetail = Awaited<ReturnType<typeof getShots>>[number];
export type CandidateGen = Awaited<ReturnType<typeof getLooseVideoClips>>[number];

/** Cowork thread LIST (metadata only), newest activity first. No eager messages —
 *  the rail shows title + time, and each thread's messages lazy-load on select via
 *  getCoworkThreadClient. This keeps the studio page load O(threads) instead of
 *  O(threads × all messages), so a chatty project never blows up the render. All
 *  threads are returned (metadata is light + the partial updatedAt index serves it),
 *  so none become unreachable. (scale audit 2026-06-20) */
export async function getCoworkThreads(ownerId: string, projectId: string) {
  const threads = await prisma.chatThread.findMany({
    where: { projectId, ownerId, ...notDeleted },
    orderBy: { updatedAt: "desc" },
    select: { id: true, projectId: true, title: true, updatedAt: true },
  });

  // Attach latest GenJob status per thread for nav status badges (best-effort: never throws).
  try {
    const threadIds = threads.map((t) => t.id);
    const jobs = threadIds.length
      ? await prisma.genJob.findMany({
          where: { ownerId, threadId: { in: threadIds } },
          select: { threadId: true, status: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
        })
      : [];
    const latestByThread = new Map<string, string>();
    for (const j of jobs) {
      if (j.threadId && !latestByThread.has(j.threadId)) latestByThread.set(j.threadId, j.status);
    }
    return threads.map((t) => ({ ...t, _badge: threadBadgeFromJobStatus(latestByThread.get(t.id) ?? null) }));
  } catch {
    return threads.map((t) => ({ ...t, _badge: null as null }));
  }
}

/** All of the owner's cowork threads across EVERY project (metas only), newest
 *  first, with status badges — for the Grok-style sidebar that nests conversations
 *  under their project. Mirrors getCoworkThreads but without the projectId filter. */
export async function getAllCoworkThreadMetas(ownerId: string) {
  const threads = await prisma.chatThread.findMany({
    where: { ownerId, ...notDeleted },
    orderBy: { updatedAt: "desc" },
    select: { id: true, projectId: true, title: true, updatedAt: true },
  });
  try {
    const threadIds = threads.map((t) => t.id);
    const jobs = threadIds.length
      ? await prisma.genJob.findMany({
          where: { ownerId, threadId: { in: threadIds } },
          select: { threadId: true, status: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
        })
      : [];
    const latestByThread = new Map<string, string>();
    for (const j of jobs) {
      if (j.threadId && !latestByThread.has(j.threadId)) latestByThread.set(j.threadId, j.status);
    }
    return threads.map((t) => ({ ...t, _badge: threadBadgeFromJobStatus(latestByThread.get(t.id) ?? null) }));
  } catch {
    return threads.map((t) => ({ ...t, _badge: null as null }));
  }
}

/** One owned, live thread with its messages in seq order (deep-link / refetch). */
export async function getCoworkThread(ownerId: string, threadId: string) {
  return prisma.chatThread.findFirst({
    where: { id: threadId, ownerId, ...notDeleted },
    include: { messages: { where: notDeleted, orderBy: { seq: "asc" } } },
  });
}

export type ChatThreadWithMessages = NonNullable<Awaited<ReturnType<typeof getCoworkThread>>>;

/** Map of genJobId → { ordered image urls, generationIds } for the GEN_RESULT messages
 *  in these threads. urls render the result; generationIds let the UI pass one as the
 *  i2v source-frame ("Animate this result"). Source of truth = the GenJob's
 *  generationIds (the message payload copy is advisory). */
export async function resolveCoworkResultUrls(
  ownerId: string,
  threads: { messages: { genJobId: string | null; kind: string }[] }[],
) {
  const jobIds = threads.flatMap((t) =>
    t.messages.filter((m) => m.kind === "GEN_RESULT" && m.genJobId).map((m) => m.genJobId as string),
  );
  // spentUsd = the ACTUAL metered charge frozen at spend (same oracle as the cost ledger),
  // surfaced so the result card shows what was really billed — not a default-config estimate.
  const map = new Map<string, { urls: string[]; generationIds: string[]; spentUsd: number | null }>();
  if (!jobIds.length) return map;
  const jobs = await prisma.genJob.findMany({ where: { id: { in: jobIds }, ownerId }, select: { id: true, generationIds: true, spentUsd: true } });
  const allGenIds = jobs.flatMap((j) => j.generationIds);
  const gens = allGenIds.length
    ? await prisma.generation.findMany({ where: { id: { in: allGenIds }, ownerId }, include: { asset: true } })
    : [];
  const genById = new Map(gens.map((g) => [g.id, g]));
  for (const j of jobs) {
    // keep urls + generationIds in the same surviving order (a generation whose row
    // was deleted drops from BOTH so url[i] ↔ generationIds[i] stays aligned)
    const live = j.generationIds.map((gid) => genById.get(gid)).filter((g) => !!g);
    map.set(j.id, {
      urls: live.map((g) => storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, g.asset.ext))),
      generationIds: live.map((g) => g.id),
      spentUsd: j.spentUsd ?? null,
    });
  }
  return map;
}

export async function getRecentOutcomes() {
  const gate = await requireOwner(); if ("error" in gate) return [];
  const { ownerId } = gate;
  const rows = await prisma.actionEvent.findMany({
    where: { ownerId, type: "generation.outcome" }, orderBy: { createdAt: "desc" }, take: 50,
  });
  return rows.map((r) => {
    const p = (r.payload ?? {}) as { generationId?: string; posted?: boolean; result?: string };
    return { generationId: p.generationId ?? "", posted: !!p.posted, result: p.result ?? "", at: r.createdAt.toISOString() };
  });
}

/** generationIds this owner has already recorded an outcome for — so Simple Mode shows
 *  "logged" instead of re-prompting (and re-appending a conflicting outcome) on results
 *  that were already answered in a past session. */
export async function getRecordedOutcomeGenerationIds(ownerId: string): Promise<string[]> {
  const rows = await prisma.actionEvent.findMany({
    where: { ownerId, type: "generation.outcome" }, select: { payload: true },
  });
  const ids = new Set<string>();
  for (const r of rows) {
    const gid = (r.payload as { generationId?: string } | null)?.generationId;
    if (gid) ids.add(gid);
  }
  return [...ids];
}
