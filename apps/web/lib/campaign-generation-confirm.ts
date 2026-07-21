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
 * MONEY SAFETY (money-safety-review; B0-57 §7.2; 零新钱路 / 零第二金库):
 *   - This file adds NO spend authority. It does NOT import or call reserveCredits /
 *     settleCredits / refundReservation / grantCredits, never creates a GenJob, never calls
 *     a provider, never sends to GEN_QUEUE. Every dollar still flows through startGen's
 *     per-cell reserve/settle/refund (inside orchestrateBatch → startGen → the worker). This
 *     layer only reads the PERSISTED owner-scoped plan, assembles the gen cells the approved
 *     entries describe, and hands them to the existing batch orchestrator.
 *   - Server recompute / anti-flip (§7.2.1): the cells (prompt, kind, model) and the price
 *     are derived SERVER-side from the persisted planJson, never from client input. The
 *     client supplies only ids — which campaign, which destination project, and the stable
 *     batch/attempt idempotency ids; it can never inject a prompt, model, or price.
 *   - Quote authority (§6.5 credits-only): the displayed total is `pricedGenCredits(...)`
 *     (via factory-batch `quoteCell`) summed per cell — the SAME value startGen reserves per
 *     cell — so quote == reserve == settle. No batch-level price constant, no credit literal
 *     anywhere in this file (a static test enforces it).
 *   - Idempotency (§7.2.2, exactly-once, fail-closed): one confirmation = one stable
 *     `batchId` + `attemptId`; each cell's key is `factoryAttemptKey(batchId, index,
 *     attemptId)`. A double-click / network replay of the SAME confirmation reuses the same
 *     keys → startGen's lock-time factory verdict + the partial-unique index dedup it to
 *     exactly once (zero double charge). An explicit Retry uses the SAME batchId + a NEW
 *     attemptId: succeeded cells reuse (0 charge), only cells whose prior jobs ALL FAILED
 *     re-dispatch — "you only pay when a generation finishes, never on errors".
 *   - RBAC (owner-only): requireOwner + impersonation block on both actions; every query is
 *     owner-scoped; startGen re-resolves the owner and re-validates the project under its own
 *     advisory transaction lock per cell (the in-transaction recheck — broadcast/inbox
 *     precedent), so a stale/cross-tenant target cannot be stamped onto newly paid work.
 *   - Partial failure is honest and $0 for the failed cells — orchestrateBatch / startGen's
 *     own per-cell behaviour; there is NO batch-level rollback / all-refund here.
 */
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import { z } from "zod";
import { activeImageModel, activeVideoModel, displayCredits, newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { startGen } from "./gen-actions";
import {
  orchestrateBatch,
  quoteCell,
  MAX_BATCH_CELLS,
  type BatchResult,
  type GenCell,
} from "./factory-batch";

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const IMPERSONATION_BLOCK = "Paused while impersonating a customer — exit impersonation to do this.";

/** Formats that generate a video clip rather than a still image. Everything else (image,
 *  post, carousel, story, …) prices and generates as an image. The confirm page shows the
 *  resolved kind + unit price for every entry BEFORE the owner confirms, so this mapping is
 *  reviewed, never a hidden charge. NOT a price — the price comes from pricedGenCredits. */
const VIDEO_FORMATS = new Set(["video", "reel", "reels", "short", "shorts", "clip", "animation", "gif"]);

type CampaignGenKind = "image" | "video";

function campaignGenKindForFormat(format: string): CampaignGenKind {
  return VIDEO_FORMATS.has(format.trim().toLowerCase()) ? "video" : "image";
}

interface ApprovedCampaignEntry {
  id: string;
  format: string;
  brief: string;
}

/** Build the gen cells an approved-entry set describes. PURE (no DB, no spend): prompt is the
 *  persisted English brief, kind derives from the format, the model is the active
 *  server-configured model for that kind, count is 1. genRequest (inside startGen) stays the
 *  authoritative (model,params) spend gate — this only shapes the batch envelope. */
function buildCampaignGenCells(
  entries: ApprovedCampaignEntry[],
  models: { image: string; video: string },
): GenCell[] {
  return entries.map((entry) => {
    const kind = campaignGenKindForFormat(entry.format);
    return {
      type: "gen",
      prompt: entry.brief,
      kind,
      model: kind === "video" ? models.video : models.image,
      count: 1,
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

/** Approved entries only, in persisted plan order (stable index within one confirmation). */
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
  kind: CampaignGenKind;
  model: string;
  /** displayed credits for this entry (the per-cell reserve, displayed). */
  displayCredits: number;
}

export interface CampaignGenQuote {
  lines: CampaignGenQuoteLine[];
  /** sum in displayed credits — the "N credits" on the Confirm button. */
  totalDisplayCredits: number;
  count: number;
}

/** Server-side price recompute (§7.2.1). Every number is `quoteCell` = `pricedGenCredits(...)`
 *  — the SAME authority startGen reserves on — never a literal. PURE. */
function quoteCampaignGenCells(entries: ApprovedCampaignEntry[], cells: GenCell[]): CampaignGenQuote {
  const lines = cells.map((cell, index) => ({
    entryId: entries[index].id,
    kind: (cell.kind ?? "image") as CampaignGenKind,
    model: cell.model ?? "seedream",
    displayCredits: displayCredits(quoteCell(cell)),
  }));
  return {
    lines,
    totalDisplayCredits: lines.reduce((sum, line) => sum + line.displayCredits, 0),
    count: cells.length,
  };
}

const campaignIdSchema = z.string().regex(ULID_PATTERN);

export type CampaignGenQuoteResult = { ok: true; quote: CampaignGenQuote } | { error: string };

/**
 * Server-recompute the per-entry + total price for a campaign's APPROVED plan entries.
 * READ-only and $0 — it never dispatches, reserves, or writes. Owner-scoped. Returns an empty
 * quote (not an error) when nothing is approved yet, so the confirm page can show its empty
 * state distinctly from a not-found / denied campaign.
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

  const approved = approvedEntriesFromPlan(campaign.planJson);
  const models = { image: activeImageModel(), video: activeVideoModel() };
  const cells = buildCampaignGenCells(approved, models);
  return { ok: true, quote: quoteCampaignGenCells(approved, cells) };
}

/**
 * The batch id is DERIVED on the server from (campaignId, projectId), never supplied by the
 * client. This is a money-safety choice: every confirmation of the same campaign into the same
 * project shares one batch id, so two concurrent tabs / a replay / a later re-visit all resolve
 * to the SAME per-cell logical keys — startGen's lock-time factory verdict then dedups them to
 * exactly-once (zero double charge) without trusting the client to reuse an id. A different
 * destination project is a different, intentional generation and gets its own batch.
 */
function deriveCampaignBatchId(campaignId: string, projectId: string): string {
  return createHash("sha256")
    .update("campaign-gen-batch-v1")
    .update("\0")
    .update(campaignId)
    .update("\0")
    .update(projectId)
    .digest("hex")
    .slice(0, 32);
}

const confirmInputSchema = z
  .object({
    campaignId: campaignIdSchema,
    /** Destination project — must be owned AND grouped under this campaign. */
    projectId: z.string().min(1).max(64),
  })
  .strict();

export type ConfirmCampaignGenerationInput = z.infer<typeof confirmInputSchema>;

export type ConfirmCampaignGenerationResult =
  | { ok: true; result: BatchResult; quote: CampaignGenQuote }
  | { error: string };

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
  const { campaignId, projectId } = parsed.data;

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

  // Stable batch id (per campaign+project) + a fresh attempt id per call. The stable batch id
  // makes a replay / concurrent confirm reuse the same logical cells (startGen dedups a
  // non-FAILED prior → 0 charge); the fresh attempt id is what lets an explicit retry
  // re-dispatch a cell whose prior jobs ALL FAILED (exact-attempt miss + all-FAILED history →
  // fresh), i.e. "you only pay when a generation finishes, never on errors".
  const batchId = deriveCampaignBatchId(campaignId, projectId);
  const attemptId = newId();

  // Dispatch through the SAME existing spend authority. orchestrateBatch loops startGen per
  // cell (reserve inside startGen's transaction), dedups on the factory keys, and returns the
  // honest per-cell outcome. It touches no credits itself.
  const result = await orchestrateBatch(
    { startGen, prisma },
    { ownerId, projectId, batchId, attemptId, name: `${campaign.name} — campaign generation`, cells },
  );
  if ("error" in result) return result;

  revalidatePath(`/campaign/${campaignId}`);
  revalidatePath(`/campaign/${campaignId}/confirm`);
  return { ok: true, result, quote };
}
