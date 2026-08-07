"use server";
/**
 * campaign-generation-confirm — C2b (issue #395): the Campaign "turn the approved AI
 * proposal into real generation" spend gate. Two owner-scoped server actions over the SAME
 * existing spend authority the factory batch uses — `orchestrateBatch` looping the ONE
 * `startGen` per cell:
 *   - quoteCampaignGeneration: READ-only, $0. Server-recomputes the per-entry + total price
 *     from the persisted plan so the confirm page can show it before the owner confirms.
 *   - confirmCampaignGeneration: dispatches the approved entries through orchestrateBatch.
 *
 * MONEY SAFETY (零新钱路 / 零第二金库):
 *   - This file adds NO spend authority. It does NOT import or call reserveCredits /
 *     settleCredits / refundReservation / grantCredits, never creates a GenJob, never calls
 *     a provider, never sends to GEN_QUEUE. Every dollar still flows through startGen's
 *     per-cell reserve/settle/refund (inside orchestrateBatch → startGen → the worker). This
 *     layer only reads the PERSISTED owner-scoped plan, assembles the gen cells the approved
 *     entries describe, and hands them to the existing batch orchestrator.
 *   - Server recompute / anti-flip (§7.2.1): the cells (prompt, kind, model), per-cell prices,
 *     total, and content fingerprint are derived SERVER-side from the persisted planJson,
 *     never from client content. The client returns only the fingerprint that the server
 *     rendered with the quote; confirm re-derives it before any dispatch.
 *   - Quote authority (§6.5 credits-only): the displayed total is `pricedGenCredits(...)`
 *     (via factory-batch `quoteCell`) summed per cell — the SAME value startGen reserves per
 *     cell — so quote == reserve == settle. No batch-level price constant, no credit literal
 *     anywhere in this file (a static test enforces it).
 *   - 报价 = 真会收的钱(#708):已经生成过、这一趟只会被复用的条目计 0,内容改过、
 *     这一趟不会被受理的条目也计 0。判据是**派发那一侧的同一个** `factoryHistoryDisposition`
 *     (经 factory-batch 的 `previewBatchCharges`),只读历史、不预扣。修之前报价对每个
 *     approved 条目一律全价,于是一笔实收 1 credit 的动作被报成 12 credits,并拿这个数
 *     去比余额、去禁用按钮 —— 把商家挡在一笔他其实付得起的动作外面。
 *   - 片子档位(#709):5s/720p 不再写死。商家在卡上选的那一档随卡进计价、进指纹、进
 *     `GenJob.videoOptions` 快照(冻结形状,#657 先例),菜单与默认值来自中央配置。
 *   - Idempotency (§7.2.2, exactly-once, fail-closed): one confirmation = one stable batch id;
 *     each campaign cell additionally carries its persisted entry id, so factory-batch derives
 *     an order-independent logical key. A replay/reorder reuses the same keys → startGen's
 *     lock-time factory verdict dedups it to exactly once. A fresh attempt id still lets only
 *     an all-FAILED logical cell retry. factory-batch also replays compatible pre-migration
 *     positional keys through startGen, so deployment itself cannot re-charge old cells.
 *   - RBAC (owner-only): requireOwner + impersonation block on both actions; every query is
 *     owner-scoped; startGen re-resolves the owner and re-validates the project under its own
 *     advisory transaction lock per cell (the in-transaction recheck — broadcast/inbox
 *     precedent), so a stale/cross-tenant target cannot be stamped onto newly paid work.
 *   - Partial failure is honest: factory-batch returns its server-confirmed dispatched/reused/
 *     failed counts plus any unconfirmed remainder. There is NO batch-level rollback/refund.
 */
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import { z } from "zod";
import {
  activeImageModel,
  activeVideoModel,
  buildSpecChips,
  displayCredits,
  newId,
  videoDefaults,
  GEN_VIDEO_MODEL_OPTIONS,
  type GenVideoModel,
} from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { startGen } from "./gen-actions";
// The batch identity lives in a plain module so the undo guard in campaign-actions can ask
// "has this entry already been dispatched?" against the SAME derivation this file dispatches on.
import { deriveCampaignBatchId } from "./campaign-gen-identity";
import {
  campaignGenKindForFormat,
  campaignImageAspectForFormat,
  campaignVideoAspectForFormat,
  type CampaignGenKind,
} from "./campaign-format-shape";
import { attachCampaignApprovalGate } from "./campaign-approval-lock";
import {
  cellVideoSpec,
  orchestrateBatch,
  previewBatchCharges,
  quoteCell,
  MAX_BATCH_CELLS,
  type BatchChargePreview,
  type BatchInterruption,
  type BatchResult,
  type GenCell,
  type StartGenPort,
} from "./factory-batch";

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const IMPERSONATION_BLOCK = "Paused while impersonating a customer — exit impersonation to do this.";

interface ApprovedCampaignEntry {
  id: string;
  format: string;
  brief: string;
}

/**
 * 商家在这次确认里选定的片子档位(#709)。**只有这两项**:分辨率与时长 —— 形状仍由
 * 格式名那张表决定(`campaign-format-shape`),这里不重复第二条形状路径。
 */
export interface CampaignVideoSpec {
  resolution: string;
  durationSeconds: number;
}

/** 这台在产引擎真开出来的档 + 默认值。菜单与默认值**全部**来自中央配置(#645 T4 的
 *  `GEN_VIDEO_MODEL_OPTIONS` / `videoDefaults`),这个文件里一格价、一格档都不写死。 */
export interface CampaignVideoMenu {
  resolutions: string[];
  durations: number[];
  /** 这次报价真正用的那一档(缺省 = 模型默认档)。 */
  selected: CampaignVideoSpec;
}

function campaignVideoDefaults(model: string): CampaignVideoSpec {
  const defaults = videoDefaults(model as GenVideoModel);
  return { resolution: defaults.resolution, durationSeconds: defaults.seconds };
}

/**
 * 商家选的档 → 真会用的档。**菜单外一律 null(fail closed)**,绝不悄悄回落默认:
 * 悄悄回落就是又一次替商家做主还不说话,而且报价与实扣会按两个不同的档算。
 */
function resolveCampaignVideoSpec(model: string, requested: CampaignVideoSpec | null | undefined): CampaignVideoSpec | null {
  if (!requested) return campaignVideoDefaults(model);
  const options = GEN_VIDEO_MODEL_OPTIONS[model as GenVideoModel];
  if (!options) return null;
  if (!options.resolutions.includes(requested.resolution)) return null;
  if (!options.durations.includes(requested.durationSeconds)) return null;
  return { resolution: requested.resolution, durationSeconds: requested.durationSeconds };
}

/** Build the gen cells an approved-entry set describes. PURE (no DB, no spend): prompt is the
 *  persisted English brief, kind derives from the format, the model is the active
 *  server-configured model for that kind, count is 1. The persisted entry id becomes the
 *  order-independent factory logical identity. genRequest (inside startGen) stays the
 *  authoritative (model,params) spend gate — this only shapes the batch envelope. */
function buildCampaignGenCells(
  entries: ApprovedCampaignEntry[],
  models: { image: string; video: string },
  videoSpec: CampaignVideoSpec,
): GenCell[] {
  return entries.map((entry) => {
    const kind = campaignGenKindForFormat(entry.format);
    // #643 T2：商家在计划里写的格式名就是他要的东西 —— "story" 要的是竖版。形状来自
    // `campaign-format-shape` 那**一张**表（确认页显示的也是它），所以商家看见的格式名
    // 和真会交付的形状不可能分家。图片按张计价、不分形状，这一行不动任何价格。
    // #645 T4：片子侧同理 —— 商家写下 "reel" 要的是竖版片子。形状同样来自那张表，
    // 并且只在视频模型真给得了的时候才带上（菜单从能力表读，不写死）。
    const aspectRatio = kind === "image"
      ? campaignImageAspectForFormat(entry.format)
      : campaignVideoAspectForFormat(entry.format, GEN_VIDEO_MODEL_OPTIONS[models.video as GenVideoModel]?.aspectRatios ?? []);
    return {
      type: "gen",
      prompt: entry.brief,
      kind,
      model: kind === "video" ? models.video : models.image,
      count: 1,
      ...(aspectRatio ? { aspectRatio } : {}),
      // #709：片子的档位不再写死。商家在确认卡上选的那一档随卡进引擎，也随卡进计价 ——
      // 同一个值，所以卡上写的 480p 和真扣的 480p 价不可能分家。没选就是模型默认档。
      ...(kind === "video"
        ? { resolution: videoSpec.resolution, durationSeconds: videoSpec.durationSeconds }
        : {}),
      idempotencyId: entry.id,
    };
  });
}

/** planJson is untrusted (a JSON column); validate only the fields the spend path consumes.
 *  passthrough keeps the rest of the entry shape intact without over-coupling to it. */
const planEntrySchema = z
  .object({
    id: z.string().min(1).max(64),
    format: z.string().min(1).max(64),
    brief: z.string().trim().min(1).max(2_000),
    status: z.enum(["proposed", "approved"]),
  })
  .passthrough();

const planSchema = z.object({ entries: z.array(planEntrySchema).max(40).default([]) }).passthrough();

/** Approved entries only. Their persisted ids, not this array order, identify paid cells. */
function approvedEntriesFromPlan(planJson: unknown): ApprovedCampaignEntry[] {
  const parsed = planSchema.safeParse(planJson);
  if (!parsed.success) return [];
  return parsed.data.entries
    .filter((entry) => entry.status === "approved")
    .map((entry) => ({ id: entry.id, format: entry.format, brief: entry.brief }));
}

/**
 * 这个条目这一趟会不会被收钱(#708)。判据与派发那一侧是**同一个**
 * `factoryHistoryDisposition` —— 报价与实扣不可能分家。
 *
 *   - `new`     —— 这一趟真会新建 + 预扣,收 `displayCredits`;
 *   - `reused`  —— 已经生成过、这一趟只会被复用,收 0;
 *   - `blocked` —— 内容比上次生成时改过了,这一趟不会被受理,收 0。
 */
export type CampaignLineCharge = "new" | "reused" | "blocked";

/** One line of the server-recomputed quote — display credits for the UI. */
export interface CampaignGenQuoteLine {
  entryId: string;
  /** Exact persisted generation content rendered with this server quote. */
  brief: string;
  kind: CampaignGenKind;
  /** 这一趟真会离开余额的 credits。已生成/被挡下的条目是 0 —— 卡上写的就是真会收的钱。 */
  displayCredits: number;
  /** 这个条目单跑一趟的全价(不看历史)。`charge` 不是 `new` 时,卡面用它说明
   *  「本来 N credits,这次不收」,而不是让商家以为这条目免费。 */
  fullDisplayCredits: number;
  charge: CampaignLineCharge;
  /** #643 T2 —— 这个条目真会交付的形状（图片；视频为 null）。确认页显示它，付费请求带的
   *  是同一个值：商家复核的形状就是引擎收到的形状。 */
  aspectRatio: string | null;
  /** #709 —— 这个条目真会跑的规格,写成人话(`5s` / `720p` / `9:16` / `With sound`)。
   *  与 Otto 细节卡读**同一份** `buildSpecChips`(@fikirtive/core),取值来自这一格解析
   *  之后的 videoOptions —— 也就是落库快照与计价用的那一份。图片行为空数组(形状已在
   *  `aspectRatio` 上说过,不重复一遍)。 */
  specChips: string[];
}

export interface CampaignGenQuote {
  lines: CampaignGenQuoteLine[];
  /** sum in displayed credits — the "N credits" on the Confirm button. */
  totalDisplayCredits: number;
  count: number;
  /** Server-derived, order-independent hash of approved ids + briefs + models + unit prices. */
  contentFingerprint: string;
  /** 已生成、这一趟不会再收费的条目数(#708)。卡面据此如实说明差额去哪了。 */
  reusedCount: number;
  /** 内容改过、这一趟不会被受理的条目数(#708)。 */
  blockedCount: number;
}

/** 这一格的规格,写成商家看得懂的几个词 —— 取值是**解析之后**的 videoOptions,也就是
 *  落库快照与 `pricedGenCredits` 用的那一份(#709)。 */
function campaignSpecChips(cell: GenCell): string[] {
  if ((cell.kind ?? "image") !== "video") return [];
  const spec = cellVideoSpec(cell);
  if (!spec) return [];
  return buildSpecChips(
    "video",
    {
      aspectRatio: spec.aspectRatio,
      resolution: spec.resolution,
      durationSeconds: spec.seconds,
      audio: spec.audio,
      count: 1,
    },
    // 战役这条路没有首帧图（cell 不带 sourceGenerationId/shotId），所以形状不是「跟着首帧走」。
    false,
  );
}

/** Server-side quote + approval-content binding (§7.2.1). Every number is `quoteCell` =
 *  `pricedGenCredits(...)` — the SAME authority startGen reserves on — never a literal. The
 *  fingerprint is sorted by stable entry id, so harmless array reordering does not invalidate
 *  approval while any id/brief/model/unit-price drift does. PURE.
 *
 *  `charges` = 这一批的收费预判(#708)。给了就按「真会收的钱」报价:已生成的条目 0、
 *  被挡下的条目 0。**没给**(读不到历史 / 还没选目的项目)时按全价报 —— 宁可多报,
 *  绝不少报:少报会让商家在余额不足时以为付得起,那才是钱路上的错。 */
function quoteCampaignGenCells(
  entries: ApprovedCampaignEntry[],
  cells: GenCell[],
  charges: BatchChargePreview | null,
): CampaignGenQuote {
  const priced = cells.map((cell, index) => {
    const internalCredits = quoteCell(cell);
    const predicted = charges?.cells[index];
    const charge: CampaignLineCharge =
      predicted == null || predicted.disposition === "text" ? "new" : predicted.disposition;
    return {
      entry: entries[index],
      cell,
      internalCredits,
      line: {
        entryId: entries[index].id,
        brief: entries[index].brief,
        kind: (cell.kind ?? "image") as CampaignGenKind,
        displayCredits: displayCredits(charge === "new" ? internalCredits : 0),
        fullDisplayCredits: displayCredits(internalCredits),
        charge,
        aspectRatio: cell.aspectRatio ?? null,
        specChips: campaignSpecChips(cell),
      },
    };
  });
  const lines = priced.map(({ line }) => line);
  // 形状与档位进指纹：商家复核的是「这个条目会交付什么、什么规格」，那它们就必须是被批准的
  // 内容的一部分。不进指纹的话，复核之后形状/档位被改掉仍然能确认过去 —— 那正是
  // 「说的 ≠ 做的」的入口。**复用与否不进指纹**：那是历史状态，不是被批准的内容；
  // 它的漂移由总额对签(quote == reserve)挡住。
  const fingerprintPayload = priced
    .map(({ entry, cell, internalCredits }) => [
      entry.id,
      entry.brief,
      cell.model ?? "seedream",
      cell.aspectRatio ?? "",
      internalCredits,
      cell.resolution ?? "",
      cell.durationSeconds ?? 0,
    ] as const)
    .sort(([leftId], [rightId]) => (leftId < rightId ? -1 : leftId > rightId ? 1 : 0));
  const contentFingerprint = createHash("sha256")
    .update("campaign-generation-content-v1")
    .update("\0")
    .update(JSON.stringify(fingerprintPayload))
    .digest("hex");
  return {
    lines,
    totalDisplayCredits: lines.reduce((sum, line) => sum + line.displayCredits, 0),
    count: cells.length,
    contentFingerprint,
    reusedCount: lines.filter((line) => line.charge === "reused").length,
    blockedCount: lines.filter((line) => line.charge === "blocked").length,
  };
}

const campaignIdSchema = z.string().regex(ULID_PATTERN);

const videoSpecSchema = z
  .object({
    resolution: z.string().min(1).max(16),
    durationSeconds: z.number().int().min(1).max(600),
  })
  .strict();

const quoteOptionsSchema = z
  .object({
    /** 目的项目 —— 「已生成过」是 owner+project 范围内的事实，不知道项目就报不出真价。 */
    projectId: z.string().min(1).max(64).nullish(),
    videoSpec: videoSpecSchema.nullish(),
  })
  .strict();

const VIDEO_SPEC_OUT_OF_BOUNDS = "That video format isn't available — pick one from the list.";

export type CampaignGenQuoteResult =
  | {
      ok: true;
      quote: CampaignGenQuote;
      balanceDisplayCredits: number;
      /** #709：这条路能选的档 + 这次报价用的那一档。列表来自中央配置，不是这里发明的。 */
      videoMenu: CampaignVideoMenu;
    }
  | { error: string };

/**
 * 这一批**真会收多少钱**的读前预判(#708)。READ-only、$0。
 *
 * 目的项目未知(还没选)或读不出来时返回 null —— 调用方按全价报,宁可多报绝不少报。
 * 它永远不是预扣授权:startGen 在项目锁里重判一次,那一次才算数。
 */
async function previewCampaignCharges(
  ownerId: string,
  campaignId: string,
  projectId: string | null | undefined,
  cells: GenCell[],
): Promise<BatchChargePreview | null> {
  if (!projectId || cells.length === 0 || cells.length > MAX_BATCH_CELLS) return null;
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId, deletedAt: null },
    select: { id: true, campaignId: true },
  });
  if (!project || project.campaignId !== campaignId) return null;
  try {
    const preview = await previewBatchCharges(prisma, {
      ownerId,
      projectId: project.id,
      batchId: deriveCampaignBatchId(campaignId, project.id),
      attemptId: newId(),
      cells,
    });
    return "error" in preview ? null : preview;
  } catch (error) {
    console.warn(
      "campaign-generation-confirm: charge preview could not be read (quoting full price):",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Server-recompute the per-entry + total price and content fingerprint for a campaign's
 * APPROVED plan entries, plus the owner's point-in-time spendable balance. READ-only and $0 —
 * it never dispatches, reserves, or writes.
 *
 * #708:报的是**真会收的钱** —— 已经生成过、这一趟只会被复用的条目计 0。这个总额同时
 * 驱动余额判断与确认按钮,所以它一多报,商家就会被挡在一笔他其实付得起的动作外面。
 * #709:片子按商家选的那一档报价,并把这一档如实写在卡上。
 */
export async function quoteCampaignGeneration(
  rawCampaignId: unknown,
  rawOptions?: unknown,
): Promise<CampaignGenQuoteResult> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const parsed = campaignIdSchema.safeParse(rawCampaignId);
  if (!parsed.success) return { error: "Campaign not found." };
  const options = quoteOptionsSchema.safeParse(rawOptions ?? {});
  if (!options.success) return { error: "That generation request is out of bounds." };

  const campaign = await prisma.campaign.findFirst({
    where: { id: parsed.data, ownerId: gate.ownerId, deletedAt: null },
    select: { id: true, planJson: true },
  });
  if (!campaign) return { error: "Campaign not found." };

  const account = await prisma.creditAccount.findUnique({
    where: { orgId: gate.ownerId },
    select: { balance: true },
  });
  const approved = approvedEntriesFromPlan(campaign.planJson);
  const models = { image: activeImageModel(), video: activeVideoModel() };
  const videoSpec = resolveCampaignVideoSpec(models.video, options.data.videoSpec);
  if (!videoSpec) return { error: VIDEO_SPEC_OUT_OF_BOUNDS };
  const cells = buildCampaignGenCells(approved, models, videoSpec);
  const charges = await previewCampaignCharges(gate.ownerId, campaign.id, options.data.projectId, cells);
  const menuOptions = GEN_VIDEO_MODEL_OPTIONS[models.video as GenVideoModel];
  return {
    ok: true,
    quote: quoteCampaignGenCells(approved, cells, charges),
    balanceDisplayCredits: displayCredits(account?.balance ?? 0),
    videoMenu: {
      resolutions: [...(menuOptions?.resolutions ?? [])],
      durations: [...(menuOptions?.durations ?? [])],
      selected: videoSpec,
    },
  };
}

const confirmInputSchema = z
  .object({
    campaignId: campaignIdSchema,
    /** Destination project — must be owned AND grouped under this campaign. */
    projectId: z.string().min(1).max(64),
    /** The displayed total the owner reviewed. Server re-derives it before dispatch. */
    expectedTotalCredits: z.number().int().min(0),
    /** Opaque server-rendered approval-content binding; client content is never accepted. */
    expectedContentFingerprint: z.string().regex(FINGERPRINT_PATTERN),
    /** #709：商家在卡上选的片子档位。它是商家自己的选择，所以可以由客户端提出 —— 但价格
     *  由服务端按**这一档**重算，且必须与他复核过的总额、指纹逐字对上，否则一格都不派发。 */
    videoSpec: videoSpecSchema.nullish(),
  })
  .strict();

export type ConfirmCampaignGenerationInput = z.infer<typeof confirmInputSchema>;

export type ConfirmCampaignGenerationResult =
  | { ok: true; result: BatchResult; quote: CampaignGenQuote }
  | { error: string; partial?: BatchInterruption; quote?: CampaignGenQuote };

/**
 * Confirm and dispatch generation for a campaign's APPROVED plan entries.
 *
 * Reuses the existing factory batch orchestration — this action creates no GenJob, moves no
 * credits, and calls no provider. It reads the persisted owner-scoped plan, assembles the
 * approved-entry cells server-side, and hands them to orchestrateBatch, which loops the ONE
 * startGen (per-cell reserve inside startGen's own transaction + advisory lock recheck).
 */
export async function confirmCampaignGeneration(raw: unknown): Promise<ConfirmCampaignGenerationResult> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };
  const { ownerId } = gate;

  const parsed = confirmInputSchema.safeParse(raw);
  if (!parsed.success) return { error: "That generation request is out of bounds." };
  const { campaignId, projectId, expectedTotalCredits, expectedContentFingerprint } = parsed.data;

  // Owner-scoped campaign load — the persisted plan is the ONLY source of what will generate.
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, ownerId, deletedAt: null },
    select: { id: true, name: true, planJson: true },
  });
  if (!campaign) return { error: "Campaign not found." };

  const approved = approvedEntriesFromPlan(campaign.planJson);
  if (approved.length === 0) return { error: "Approve at least one plan entry before generating." };
  if (approved.length > MAX_BATCH_CELLS) {
    return { error: `Generate at most ${MAX_BATCH_CELLS} approved entries at once.` };
  }

  // Owner-scoped destination project, bound to THIS campaign so generations land inside the
  // campaign the owner is confirming (no cross-campaign / cross-tenant target).
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId, deletedAt: null },
    select: { id: true, campaignId: true },
  });
  if (!project) return { error: "Project not found." };
  if (project.campaignId !== campaignId) return { error: "Choose a project that belongs to this campaign." };

  const models = { image: activeImageModel(), video: activeVideoModel() };
  // #709：档位是商家的选择，但**菜单外一律拒绝**（fail closed），绝不悄悄换成默认档
  // 然后按另一个价收钱。
  const videoSpec = resolveCampaignVideoSpec(models.video, parsed.data.videoSpec);
  if (!videoSpec) return { error: VIDEO_SPEC_OUT_OF_BOUNDS };
  const cells = buildCampaignGenCells(approved, models, videoSpec);

  // Stable batch id (per campaign+project) + stable entry ids + a fresh attempt id per call.
  // startGen's existing factory history verdict remains the only reserve/reuse authority.
  const batchId = deriveCampaignBatchId(campaignId, projectId);
  const attemptId = newId();

  // #708：报价与派发同一把尺 —— 这里用**将要派发的这一批**重算一次收费预判，于是
  // 「卡上的数」与「确认后真离开余额的数」是同一个数。预判只读历史，不预扣。
  const charges = await previewCampaignCharges(ownerId, campaign.id, project.id, cells);
  const quote = quoteCampaignGenCells(approved, cells, charges);

  // Price consent and content consent both fail closed BEFORE any dispatch. The content hash is
  // re-derived from persisted entries + current server model/price config; no client brief,
  // model, entry id, or unit price participates in the decision.
  //
  // #708:价格同意是一条**上限** —— 「不许收得比按钮上写的多」。收得更少永远放行,因为
  //   ① 那正是复用该有的样子(重放/重试/别的标签页先派发过),把它判成「价格变了」会
  //      让耐久重试永远走不通 —— 那才是真的钱路风险(商家改点新一次 = 新的一笔);
  //   ② 少收从不违反商家的授权。**多收**一格都不行,一律停在花钱之前。
  // 单价漂移不靠这一行兜:它已经逐条进了内容指纹,下面那道闸会拦。
  if (quote.totalDisplayCredits > expectedTotalCredits) {
    return {
      error: `This plan or its price changed since you reviewed it (was ${expectedTotalCredits}, now ${quote.totalDisplayCredits} credits). Refresh and confirm again.`,
      quote,
    };
  }
  if (quote.contentFingerprint !== expectedContentFingerprint) {
    return {
      error: "This plan changed since you reviewed it. Review the updated plan before confirming.",
      quote,
    };
  }

  // #744 判官 r1 P1-2 / r2 P1 — everything checked above was read BEFORE the loop below starts
  // spending, and the merchant can undo or remove an approval while it runs. So each cell's
  // request carries the campaign approval gate, and startGen applies it INSIDE the transaction
  // that commits that cell's charge: it re-reads the persisted plan under the campaign lock and
  // re-derives this same fingerprint from it. A dispatch either beats the undo — and the undo is
  // then refused, because the job it can now see proves the charge — or loses to it and never
  // runs. Because the lock belongs to the charging transaction, an undo cannot land in between:
  // the lock is released by the same COMMIT that makes the charge visible.
  // This layer still opens no transaction and still spends nothing itself; startGen remains the
  // only thing that may reserve a credit, and the gate can only ever refuse it.
  //
  // 注:重算指纹时收费预判传 `null` —— **内容指纹不含历史状态**(它只哈希 id/brief/model/
  // 单价/承诺规格),所以传不传预判都是同一个值。这里传 null 是为了不在锁内多读一次历史。
  const guardedStartGen: StartGenPort = (req) =>
    startGen(
      attachCampaignApprovalGate(req, {
        ownerId,
        campaignId,
        stillApproved: (planJson) => {
          const live = approvedEntriesFromPlan(planJson);
          const liveCells = buildCampaignGenCells(live, models, videoSpec);
          return quoteCampaignGenCells(live, liveCells, null).contentFingerprint
            === quote.contentFingerprint;
        },
      }),
    );

  const result = await orchestrateBatch(
    { startGen: guardedStartGen, prisma },
    { ownerId, projectId, batchId, attemptId, name: `${campaign.name} — campaign generation`, cells },
  );
  if ("error" in result) return { ...result, quote };

  // Revalidation is post-spend presentation metadata. Never throw away an honest dispatch
  // result after startGen has committed reservations; the destination pages can refresh later.
  try {
    revalidatePath(`/campaign/${campaignId}`);
    revalidatePath(`/campaign/${campaignId}/confirm`);
  } catch (error) {
    console.warn(
      "campaign-generation-confirm: post-dispatch revalidation failed (non-fatal):",
      error instanceof Error ? error.message : error,
    );
  }
  return { ok: true, result, quote };
}
