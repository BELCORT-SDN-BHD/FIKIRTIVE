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
import { displayCredits, understandingKindForMime } from "@fikirtive/core";
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

/** Terminal `AssetUnderstanding.status` values — the ledger read behind them is a settled
 *  fact (see `packages/core/src/asset-understanding.ts` for the full status list: QUEUED /
 *  RUNNING / PAUSED / PAUSED_BALANCE are all recoverable, non-final states). */
const UNDERSTANDING_TERMINAL_STATUSES = new Set<string>(["DONE", "FAILED", "SKIPPED"]);

/** FSE-009 §5 :169 折出来的费用，外加 FSE-203 §5 行新增的「这笔钱有没有定论」信号。 */
export type UploadUnderstandingCost = {
  /** Net credits already charged and settled (display units). 0 = nothing settled — either
   *  genuinely free, or still pending; read `pending` to tell those two apart. */
  creditsCharged: number;
  /**
   * FSE-203 —— 结算还没有定论：这件素材上至少有一行理解还没到终态（QUEUED / RUNNING /
   * PAUSED / PAUSED_BALANCE），或者**一行理解都还没建**但这件素材真的会被扫描器捞起来读
   * （`wouldBeScannedForUnderstanding`，与 `scanAssetsNeedingUnderstanding` 第①段的准入
   * 门槛同一条判断，见下方定义处的判官修根说明）。false = 每一行都已经到终态（DONE /
   * FAILED / SKIPPED，账本上的净额已经是事实），或者这件素材根本不会被扫描器捞走
   * （类型不理解、软删、来路不对、或元数据永远补不齐）—— 那是真的没花钱，不是「还没轮到」。
   */
  pending: boolean;
  /**
   * FSE-203/211 判官修根 P1-1 —— `pending` 为真时,UI 该用哪一句文案,而不是一律说「快有
   * 结果」。缺省（undefined）= 不需要特殊文案：要么不是 pending，要么 pending 但卡在
   * QUEUED/RUNNING（真的快，默认的「还在读」够用）。`"waiting_for_credits"` = 至少一行
   * 卡在 PAUSED_BALANCE —— 那是商家侧余额不够、要充值才会继续，说「快」是撒谎，必须点名
   * credits；沿用既有权威口径 `UNDERSTANDING_WAITING_FOR_CREDITS`
   * （packages/core/src/asset-understanding.ts）。`"provider_paused"` = 至少一行卡在
   * PAUSED —— 我方配置/请求坏了、要人修，同理沿用 `UNDERSTANDING_PROVIDER_PAUSED`。两句
   * 都不在这里重写一遍，只搬运既有常量，别造第三套说法（家规 §7.3 单一源头）。
   */
  stalledReason?: "waiting_for_credits" | "provider_paused";
};

/**
 * 「这件素材现在会被扫描器捞去理解吗」——判官修根 P1-1（PR #1415，FSE-203/205/211）。
 *
 * 与 `apps/worker/src/jobs/understand.ts` 的 `scanAssetsNeedingUnderstanding` 第①段
 * （`fresh` 查询）同一条准入门槛，搬到这一侧只读一次，零新增查询——字段全部随调用方已经
 * 发过的 `asset` 关系带出，这里不再发一条 prisma 调用。
 *
 * 旧判据（`understandingKindForMime(mime) !== null`）只看 mime 是不是图片/视频，三类
 * 「扫描器其实永远不会捞走」的素材因此被判成「马上有结果」：元数据永远补不齐的（ffprobe
 * 失败 / 24h 超龄，understand.ts:388-391 明写这是刻意选的那一边）、已经软删的、来路不是
 * 扫描器认的那两种。诚实中间态本该在「会 resolve」时才说「还没定论」，判错的那三类会让
 * pending 永远卡着 true，变成一句永久假话。这里改成跟扫描器认同一道门槛：来路对、没被
 * 软删、元数据已经齐了（图要宽高、视频要时长）、mime 能路由出一个 kind——四条任何一条
 * 不成立，扫描器此刻就不会捞它，pending 也就不该说「还在等」。
 */
function wouldBeScannedForUnderstanding(asset: {
  mime: string;
  source: string;
  deletedAt: Date | null;
  width: number | null;
  height: number | null;
  durationS: number | null;
}): boolean {
  // 与 understand.ts 的 UNDERSTOOD_SOURCES 同一张白名单——扫描器只捞 UPLOAD / IMPORT。
  if (asset.source !== "UPLOAD" && asset.source !== "IMPORT") return false;
  if (asset.deletedAt !== null) return false;
  const kind = understandingKindForMime(asset.mime);
  if (!kind) return false;
  // 与 understand.ts 的 METADATA_READY_FOR_UNDERSTANDING 同一道元数据闸。
  if (kind === "image-caption") return asset.width !== null && asset.height !== null;
  if (kind === "video-qa") return asset.durationS !== null;
  return true;
}

/**
 * FSE-009 —— 一件**上传**素材背后那些自动理解任务折出来的费用（显示 credits），按
 * generation id 归拢。
 *
 * **两个界面共用这一份读路**：画布卡片信息面（`loadCanvasNodeLineages`，本文件）与
 * Library 资产详情的血缘节（`actions.getGenerationLineage`）。同一件上传在两处必须说出
 * 同一个数——从前两处各自写死 0，走查（FSE-009）在资产详情那一面看见「Cost: no credits
 * charged」而 Billing 里明明有一行 Understanding -0.1。费用从哪里折出来只此一处（家规 §7.3）。
 *
 * 链条只有两跳，两跳都带 ownerId：generation → 它的素材 → 那件素材上的 `AssetUnderstanding`
 * 行 → 那些行**当前这一回合**的 `moneyRefId` → 账本。为什么认 `moneyRefId` 而不是按
 * `understanding:<行 id>` 前缀去捞全部回合：退款过的旧回合净额恒为 0（RESERVE + REFUND 相抵），
 * 折进来与不折进来是同一个数，而前缀匹配要为每一行各写一条 `startsWith` 谓词。
 *
 * 折出 0（一行理解都没有，或那一笔被退过款）与「没有记录」不是一回事：上传本身确实免费，
 * 所以 0 是事实，卡面照旧说 "no credits charged"。没有条目的 generation 一律当 0 读——
 * FSE-203：但 0 **不代表**这就是终局，`pending` 才说得出「这个 0 会不会变」。
 *
 * 没有上传卡 ⇒ 一条语句都不发。纯读：不预扣、不结算、不退款。
 */
export async function loadUploadUnderstandingCredits(
  ownerId: string,
  uploaded: ReadonlyArray<{
    id: string;
    assetId: string;
    mime: string;
    /** Asset.source ——与扫描器查询同一列(判官修根 P1-1)。 */
    source: string;
    /** Asset.deletedAt ——软删的素材扫描器永远不会捞(同上)。 */
    deletedAt: Date | null;
    width: number | null;
    height: number | null;
    durationS: number | null;
  }>,
): Promise<Map<string, UploadUnderstandingCost>> {
  const byGeneration = new Map<string, UploadUnderstandingCost>();
  const assetIds = [...new Set(uploaded.map((generation) => generation.assetId))];
  if (!assetIds.length) return byGeneration;

  // FSE-203：不再只挑「已经进钱路」的那些行（`moneyRefId: { not: null }`）——一件素材建行
  // 之后、reserve 之前那几十秒同样属于「还没定论」，这里必须看得到那些行才判得出 pending。
  const understandings = await prisma.assetUnderstanding.findMany({
    where: { ownerId, assetId: { in: assetIds } },
    select: { assetId: true, moneyRefId: true, status: true },
  });
  const rowsByAsset = new Map<string, typeof understandings>();
  for (const row of understandings) {
    const group = rowsByAsset.get(row.assetId) ?? [];
    group.push(row);
    rowsByAsset.set(row.assetId, group);
  }

  const refIds = [...new Set(understandings.map((row) => row.moneyRefId).filter((id): id is string => !!id))];
  const ledgerRows = refIds.length
    ? await prisma.creditLedger.findMany({
      where: { orgId: ownerId, refId: { in: refIds } },
      select: { refId: true, balanceDelta: true },
    })
    : [];
  const rowsByRefId = new Map<string, { balanceDelta: number }[]>();
  for (const row of ledgerRows) {
    if (!row.refId) continue;
    const group = rowsByRefId.get(row.refId) ?? [];
    group.push({ balanceDelta: row.balanceDelta });
    rowsByRefId.set(row.refId, group);
  }
  // 同一件素材可能挂着好几张卡(同一张图放上画布两次)——每张卡说的都是这件素材上真实
  // 发生过的那笔理解费,不是各自分摊一份:费用行回答的是「这张卡背后花了多少」。
  for (const generation of uploaded) {
    const rows = rowsByAsset.get(generation.assetId);
    const ledgerGroup = (rows ?? []).flatMap((row) => (row.moneyRefId ? rowsByRefId.get(row.moneyRefId) ?? [] : []));
    const nonTerminal = (rows ?? []).filter((row) => !UNDERSTANDING_TERMINAL_STATUSES.has(row.status));
    const pending = rows?.length ? nonTerminal.length > 0 : wouldBeScannedForUnderstanding(generation);
    // PAUSED_BALANCE 排在 PAUSED 前面:两者都可能同时挂在一件素材的不同理解行上时,
    // 「要充值」比「等我们修」更该让商家先看到——充值是商家能做的那一件事。
    const stalledReason = nonTerminal.some((row) => row.status === "PAUSED_BALANCE")
      ? ("waiting_for_credits" as const)
      : nonTerminal.some((row) => row.status === "PAUSED")
        ? ("provider_paused" as const)
        : undefined;
    byGeneration.set(generation.id, {
      creditsCharged: displayCredits(netChargedInternalCredits(ledgerGroup)),
      pending,
      stalledReason,
    });
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
        // FSE-203/211(判官修根 P1-1):`asset.{mime,source,deletedAt,width,height,durationS}`
        // 是判「一行理解都还没建时算不算 pending」的唯一依据
        // (`wouldBeScannedForUnderstanding`,与扫描器 `scanAssetsNeedingUnderstanding` 第①段
        // 同一道准入门槛)——不额外发一条查询,顺着 Generation → Asset 那条既有关系带出来。
        select: {
          id: true,
          createdAt: true,
          source: true,
          assetId: true,
          asset: { select: { mime: true, source: true, deletedAt: true, width: true, height: true, durationS: true } },
        },
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
  const uploadCreditsByGeneration = await loadUploadUnderstandingCredits(
    ownerId,
    uploaded.map((generation) => ({
      id: generation.id,
      assetId: generation.assetId,
      mime: generation.asset?.mime ?? "",
      source: generation.asset?.source ?? "",
      deletedAt: generation.asset?.deletedAt ?? null,
      width: generation.asset?.width ?? null,
      height: generation.asset?.height ?? null,
      durationS: generation.asset?.durationS ?? null,
    })),
  );
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
          // 这件素材上那些自动理解任务的账本行折出来的净额,与资产详情那一面同一个函数。
          // 一行都没有 ⇒ 0 ⇒ 卡面照旧说 "no credits charged",与从前逐字相同。画布卡这一面
          // 本票不改文案(诚实中间态只落在 Library 资产详情——票面范围,`pending` 这一格
          // 在这里刻意不读),`creditsCharged` 的算法与从前逐字相同。
          ? (uploadCreditsByGeneration.get(node.generationId)?.creditsCharged ?? 0)
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
