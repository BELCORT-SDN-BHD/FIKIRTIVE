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
import { activeImageModel, activeVideoModel, displayCredits, newId, GEN_VIDEO_MODEL_OPTIONS, type GenVideoModel } from "@fikirtive/core";
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
import {
  orchestrateBatch,
  quoteCell,
  MAX_BATCH_CELLS,
  type BatchInterruption,
  type BatchResult,
  type GenCell,
} from "./factory-batch";

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const IMPERSONATION_BLOCK = "Paused while impersonating a customer — exit impersonation to do this.";

interface ApprovedCampaignEntry {
  id: string;
  format: string;
  brief: string;
}

/** Build the gen cells an approved-entry set describes. PURE (no DB, no spend): prompt is the
 *  persisted English brief, kind derives from the format, the model is the active
 *  server-configured model for that kind, count is 1. The persisted entry id becomes the
 *  order-independent factory logical identity. genRequest (inside startGen) stays the
 *  authoritative (model,params) spend gate — this only shapes the batch envelope. */
function buildCampaignGenCells(
  entries: ApprovedCampaignEntry[],
  models: { image: string; video: string },
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

/** One line of the server-recomputed quote — display credits for the UI. */
export interface CampaignGenQuoteLine {
  entryId: string;
  /** Exact persisted generation content rendered with this server quote. */
  brief: string;
  kind: CampaignGenKind;
  /** displayed credits for this entry (the per-cell reserve, displayed). */
  displayCredits: number;
  /** #643 T2 —— 这个条目真会交付的形状（图片；视频为 null）。确认页显示它，付费请求带的
   *  是同一个值：商家复核的形状就是引擎收到的形状。 */
  aspectRatio: string | null;
}

export interface CampaignGenQuote {
  lines: CampaignGenQuoteLine[];
  /** sum in displayed credits — the "N credits" on the Confirm button. */
  totalDisplayCredits: number;
  count: number;
  /** Server-derived, order-independent hash of approved ids + briefs + models + unit prices. */
  contentFingerprint: string;
}

/** Server-side quote + approval-content binding (§7.2.1). Every number is `quoteCell` =
 *  `pricedGenCredits(...)` — the SAME authority startGen reserves on — never a literal. The
 *  fingerprint is sorted by stable entry id, so harmless array reordering does not invalidate
 *  approval while any id/brief/model/unit-price drift does. PURE. */
function quoteCampaignGenCells(entries: ApprovedCampaignEntry[], cells: GenCell[]): CampaignGenQuote {
  const priced = cells.map((cell, index) => {
    const internalCredits = quoteCell(cell);
    return {
      entry: entries[index],
      cell,
      internalCredits,
      line: {
        entryId: entries[index].id,
        brief: entries[index].brief,
        kind: (cell.kind ?? "image") as CampaignGenKind,
        displayCredits: displayCredits(internalCredits),
        aspectRatio: cell.aspectRatio ?? null,
      },
    };
  });
  const lines = priced.map(({ line }) => line);
  // 形状进指纹：商家复核的是「这个条目会交付什么形状」，那它就必须是被批准的内容的一部分。
  // 不进指纹的话，复核之后形状被改掉仍然能确认过去 —— 那正是「说的 ≠ 做的」的入口。
  const fingerprintPayload = priced
    .map(({ entry, cell, internalCredits }) => [
      entry.id,
      entry.brief,
      cell.model ?? "seedream",
      cell.aspectRatio ?? "",
      internalCredits,
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
  };
}

const campaignIdSchema = z.string().regex(ULID_PATTERN);

export type CampaignGenQuoteResult =
  | { ok: true; quote: CampaignGenQuote; balanceDisplayCredits: number }
  | { error: string };

/**
 * Server-recompute the per-entry + total price and content fingerprint for a campaign's
 * APPROVED plan entries, plus the owner's point-in-time spendable balance. READ-only and $0 —
 * it never dispatches, reserves, or writes.
 */
export async function quoteCampaignGeneration(rawCampaignId: unknown): Promise<CampaignGenQuoteResult> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const parsed = campaignIdSchema.safeParse(rawCampaignId);
  if (!parsed.success) return { error: "Campaign not found." };

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
  const cells = buildCampaignGenCells(approved, models);
  return {
    ok: true,
    quote: quoteCampaignGenCells(approved, cells),
    balanceDisplayCredits: displayCredits(account?.balance ?? 0),
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
  const cells = buildCampaignGenCells(approved, models);
  const quote = quoteCampaignGenCells(approved, cells);

  // Price consent and content consent both fail closed BEFORE any dispatch. The content hash is
  // re-derived from persisted entries + current server model/price config; no client brief,
  // model, entry id, or unit price participates in the decision.
  if (quote.totalDisplayCredits !== expectedTotalCredits) {
    return {
      error: `This plan or its price changed since you reviewed it (was ${expectedTotalCredits}, now ${quote.totalDisplayCredits} credits). Refresh and confirm again.`,
    };
  }
  if (quote.contentFingerprint !== expectedContentFingerprint) {
    return {
      error: "This plan changed since you reviewed it. Review the updated plan before confirming.",
    };
  }

  // Stable batch id (per campaign+project) + stable entry ids + a fresh attempt id per call.
  // startGen's existing factory history verdict remains the only reserve/reuse authority.
  const batchId = deriveCampaignBatchId(campaignId, projectId);
  const attemptId = newId();

  const result = await orchestrateBatch(
    { startGen, prisma },
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
