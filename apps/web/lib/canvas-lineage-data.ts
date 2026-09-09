import "server-only";
/**
 * canvas-lineage-data — the owner-scoped read behind a canvas card's traceability record
 * (#547 B4). One place, used by BOTH canvas readers (`listCanvasNodes` and the Otto canvas
 * bridge), so the two can never tell a merchant different stories about the same card.
 *
 * MONEY SAFETY: read-only. It never reserves, settles, refunds, grants, or adjusts anything;
 * it reads what the ledger already recorded and converts it to displayed credits at the view
 * seam. Nothing here can create or charge a job.
 *
 * TENANCY: every query is filtered by the caller's authenticated ownerId (plus projectId);
 * a caller can only ever read the lineage of their own workspace's cards.
 *
 * ENGINE SECRECY: the returned record carries seconds / resolution / aspect / batch position
 * and the credits charged — never the model or provider that produced the asset.
 */

import { prisma } from "@fikirtive/db";
import { displayCredits } from "@fikirtive/core";
import { canvasImageSettings, canvasVideoSettings, type CanvasNodeLineage } from "./canvas-lineage";
import { mergeSettings } from "./owner-settings";
import { formatDayLabel, formatTime, partsInTz } from "./schedule-view";

/** Just enough of a canvas row to look its lineage up. */
export type LineageLookupNode = {
  id: string;
  generationId: string | null;
  genJobId: string | null;
  /** Batch identity as the server settled it. Never recomputed here (#603 T4). */
  batchIndex?: number | null;
  batchSize?: number | null;
};

const EMPTY_SETTINGS = { durationSeconds: null, resolution: null, aspectRatio: null } as const;

export const UNKNOWN_CANVAS_LINEAGE: CanvasNodeLineage = {
  madeAtLabel: null,
  settings: EMPTY_SETTINGS,
  costCredits: null,
  batchSize: 1,
  batchPosition: null,
};

/**
 * Net credits a paid job actually cost, folded from its ledger rows.
 *
 * A job writes RESERVE (a hold) then SETTLE (or REFUND). Summing the signed balance deltas of
 * every row for that job gives the net charge regardless of which half we happen to see, so a
 * refunded failure reads as 0 rather than as a charge. Exported for its unit test.
 */
export function netChargedInternalCredits(
  rows: ReadonlyArray<{ balanceDelta: number }>,
): number {
  return rows.reduce((total, row) => total - row.balanceDelta, 0);
}

/**
 * FSE-009 —— 一张上传卡背后那些**自动理解**任务的账本行，按 generation id 归拢。
 *
 * 链条只有两跳，两跳都带 ownerId：generation → 它的素材 → 那件素材上的 `AssetUnderstanding`
 * 行 → 那些行**当前这一回合**的 `moneyRefId` → 账本。为什么认 `moneyRefId` 而不是按
 * `understanding:<行 id>` 前缀去捞全部回合：退款过的旧回合净额恒为 0（RESERVE + REFUND 相抵），
 * 折进来与不折进来是同一个数，而前缀匹配要为每一行各写一条 `startsWith` 谓词。
 *
 * 没有上传卡 ⇒ 一条语句都不发。
 */
async function loadUploadUnderstandingLedger(
  ownerId: string,
  uploaded: ReadonlyArray<{ id: string; assetId: string }>,
): Promise<Map<string, { balanceDelta: number }[]>> {
  const byGeneration = new Map<string, { balanceDelta: number }[]>();
  const assetIds = [...new Set(uploaded.map((generation) => generation.assetId))];
  if (!assetIds.length) return byGeneration;

  const understandings = await prisma.assetUnderstanding.findMany({
    where: { ownerId, assetId: { in: assetIds }, moneyRefId: { not: null } },
    select: { assetId: true, moneyRefId: true },
  });
  const refIds = [...new Set(understandings.map((row) => row.moneyRefId).filter((id): id is string => !!id))];
  if (!refIds.length) return byGeneration;

  const rows = await prisma.creditLedger.findMany({
    where: { orgId: ownerId, refId: { in: refIds } },
    select: { refId: true, balanceDelta: true },
  });
  const rowsByRefId = new Map<string, { balanceDelta: number }[]>();
  for (const row of rows) {
    if (!row.refId) continue;
    const group = rowsByRefId.get(row.refId) ?? [];
    group.push({ balanceDelta: row.balanceDelta });
    rowsByRefId.set(row.refId, group);
  }
  const rowsByAsset = new Map<string, { balanceDelta: number }[]>();
  for (const understanding of understandings) {
    const group = rowsByAsset.get(understanding.assetId) ?? [];
    group.push(...(rowsByRefId.get(understanding.moneyRefId!) ?? []));
    rowsByAsset.set(understanding.assetId, group);
  }
  // 同一件素材可能挂着好几张卡(同一张图放上画布两次)——每张卡说的都是这件素材上真实
  // 发生过的那笔理解费,不是各自分摊一份:费用行回答的是「这张卡背后花了多少」。
  for (const generation of uploaded) {
    const group = rowsByAsset.get(generation.assetId);
    if (group?.length) byGeneration.set(generation.id, group);
  }
  return byGeneration;
}

/**
 * Lineage for every supplied card, keyed by card id.
 *
 * Three extra owner-scoped reads for the whole board (jobs, generations, ledger rows) — not
 * one per card.
 */
export async function loadCanvasNodeLineages(
  ownerId: string,
  projectId: string,
  nodes: readonly LineageLookupNode[],
  timezone: string,
): Promise<Record<string, CanvasNodeLineage>> {
  const jobIds = [...new Set(nodes.map((node) => node.genJobId).filter((id): id is string => !!id))];
  const generationIds = [...new Set(nodes.map((node) => node.generationId).filter((id): id is string => !!id))];
  if (!jobIds.length && !generationIds.length) return {};

  const [jobs, generations, ledgerRows] = await Promise.all([
    jobIds.length
      ? prisma.genJob.findMany({
        where: { id: { in: jobIds }, ownerId, projectId },
        select: {
          id: true,
          kind: true,
          videoOptions: true,
          // #643 T2：图片卡也要说得出自己的形状 —— 这是「每个东西都要有迹可循」的同一条规矩，
          // 也是「改这张图」那条路上 UI 显示「会交付什么」的唯一依据（不从像素反推）。
          imageOptions: true,
          createdAt: true,
          finishedAt: true,
        },
      })
      : Promise.resolve([]),
    generationIds.length
      ? prisma.generation.findMany({
        where: { id: { in: generationIds }, ownerId, projectId, deletedAt: null },
        // FSE-009:`assetId` 是「这张上传的图后来被自动读过没有」那条链的第一环 ——
        // 理解任务的账本行挂在**素材**上,不在任何 GenJob 上。
        select: { id: true, createdAt: true, source: true, assetId: true },
      })
      : Promise.resolve([]),
    jobIds.length
      ? prisma.creditLedger.findMany({
        where: { orgId: ownerId, refId: { in: jobIds } },
        select: { refId: true, balanceDelta: true },
      })
      : Promise.resolve([]),
  ]);

  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const madeAtByGeneration = new Map(generations.map((generation) => [generation.id, generation.createdAt]));
  // An image the merchant dropped onto the board was never generated, so the upload itself cost
  // nothing — saying "cost not recorded" there would look like a missing record instead of a free
  // card. FSE-009 是这句话的另一半:上传本身免费,但**自动理解**这件事是收费的(MONEY-A9,
  // Founder 2026-08-31「就是用户使用照算」),商家从没点过「分析」,所以那 0.1 credit 只可能
  // 在这张卡的费用行上被看见 —— 从前这里写死 0,卡面于是说「no credits charged」而 Billing 里
  // 明明有一行。
  const uploaded = generations.filter((generation) => generation.source === "UPLOAD");
  const uploadedGenerations = new Set(uploaded.map((generation) => generation.id));
  const understandingRowsByGeneration = await loadUploadUnderstandingLedger(ownerId, uploaded);
  const ledgerByJob = new Map<string, { balanceDelta: number }[]>();
  for (const row of ledgerRows) {
    if (!row.refId) continue;
    const group = ledgerByJob.get(row.refId) ?? [];
    group.push({ balanceDelta: row.balanceDelta });
    ledgerByJob.set(row.refId, group);
  }

  const label = (at: Date | null | undefined): string | null => {
    if (!at) return null;
    const parts = partsInTz(at, timezone);
    return `${formatDayLabel(parts)}, ${formatTime(parts)}`;
  };

  const out: Record<string, CanvasNodeLineage> = {};
  for (const node of nodes) {
    const job = node.genJobId ? jobById.get(node.genJobId) : undefined;
    if (!job && !node.generationId) continue;
    const rows = node.genJobId ? ledgerByJob.get(node.genJobId) : undefined;
    // BOTH READ OFF THE CARD, never recounted (#603 T4 · spec #599 D5). This used to ask the job
    // how long its output list was and where this card's output sat in it — the right source, but
    // asked again on every read, so the Info panel and the board's own badges were two derivations
    // of one fact and could disagree. The card carries the answer the settlement wrote.
    const batchSize = Math.max(1, node.batchSize ?? 1);
    const index = typeof node.batchIndex === "number" && node.batchIndex >= 0 ? node.batchIndex : -1;
    out[node.id] = {
      madeAtLabel: label(
        (node.generationId ? madeAtByGeneration.get(node.generationId) : null)
          ?? job?.finishedAt
          ?? job?.createdAt,
      ),
      settings: job
        ? (job.kind === "IMAGE" ? canvasImageSettings(job.imageOptions) : canvasVideoSettings(job.videoOptions))
        : EMPTY_SETTINGS,
      costCredits: rows
        ? displayCredits(netChargedInternalCredits(rows))
        : (!node.genJobId && node.generationId && uploadedGenerations.has(node.generationId)
          // FSE-009(Founder 2026-09-10 裁:**只显示合计,不拆行**)—— 上传那一格的费用 =
          // 这件素材上那些自动理解任务的账本行折出来的净额。一行都没有 ⇒ 折出 0 ⇒ 卡面
          // 照旧说 "no credits charged",与从前逐字相同。
          ? displayCredits(netChargedInternalCredits(understandingRowsByGeneration.get(node.generationId) ?? []))
          : null),
      batchSize,
      batchPosition: index >= 0 ? index + 1 : null,
    };
  }
  return out;
}

/**
 * Attach every card's lineage to a already-owner-scoped board read.
 *
 * The two canvas readers (`listCanvasNodes` and the Otto canvas bridge) both end here, so a
 * merchant is told the same thing about the same card whichever one loaded the board. Times
 * are formatted in the workspace's own timezone, server-side, so the label is byte-identical
 * on server and client.
 */
export async function withCanvasLineage<T extends LineageLookupNode>(
  ownerId: string,
  projectId: string,
  nodes: T[],
): Promise<Array<T & { lineage: CanvasNodeLineage | null }>> {
  let lineages: Record<string, CanvasNodeLineage> = {};
  try {
    const organization = await prisma.organization.findFirst({
      where: { id: ownerId, deletedAt: null },
      select: { settings: true },
    });
    const timezone = mergeSettings(organization?.settings).timezone;
    lineages = await loadCanvasNodeLineages(ownerId, projectId, nodes, timezone);
  } catch (error) {
    // The board is the merchant's paid work; a traceability lookup is not. A failure here
    // costs an Info panel, so it must never blank the canvas — degrade to "no record" and
    // leave a server-side trace instead of throwing the whole read away.
    console.warn("[canvas] lineage lookup failed; cards render without their record:", error);
    lineages = {};
  }
  return nodes.map((node) => ({ ...node, lineage: lineages[node.id] ?? null }));
}
