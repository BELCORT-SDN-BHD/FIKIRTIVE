// F12: deliberately NOT "use server". runAdBuild/maybeAutoBuild take a TRUSTED ownerId and do
// not re-authenticate — if this module were "use server", every export (incl. those two) would
// become a public Server Action any authenticated user could POST with another org's ownerId.
// The client-facing, requireOwner-gated actions (approveAdBuild / launchAdDraft) are re-exposed
// through the "use server" wrapper otto-client-actions.ts; maybeAutoBuild is called only from the
// plain server module meta-build-propose.ts. This mirrors meta-write-actions.ts (runApprovedPlan).
/**
 * runAdBuild — the ONLY code path in the system that CREATES Meta objects (campaign,
 * adset, ad creative, ad) in the user's real ad account. Trusted, internal, server-side
 * executor. It is reached ONLY via `approveAdBuild` (human approve) or `maybeAutoBuild`
 * (the AUTO path) — never directly by the LLM, never from the worker.
 *
 * MIRRORS meta-write-actions.ts (runApprovedPlan / approveMetaActionPlan / maybeAutoRun):
 * owner-scoped reads/writes, per-step idempotency claim on MetaActionExecution, P2002
 * race catch, kill-switch refusal before any graph call, kill-switch+gate BEFORE consume,
 * impersonation block, the maybeAuto try/catch → outcome shape.
 *
 * Security invariants (do not weaken without re-reading task-7-brief.md):
 *  - Kill-switch (`adsWritesPaused`) refuses EVERYTHING, before any upload/graph call (throws).
 *  - !canWrite → refusal (no creates).
 *  - EVERY created object is `status:"PAUSED"` ($0) with `special_ad_categories:"[]"`.
 *  - Per-step idempotency: an APPLIED row's id is REUSED, never re-created (no duplicate
 *    campaign/adset/ad in the user's account on a re-run).
 *  - Stop-on-first-failure: a create error halts the build; no later object is attempted;
 *    earlier created ids are returned (state "partial"); NO auto-delete.
 *  - Asset bytes are read owner-scoped (a wrong ownerId can only ever read its own assets).
 */
import { prisma, Prisma } from "@fikirtive/db";
import { newId, storageKey } from "@fikirtive/core";
import { decryptToken } from "./token-encryption";
import { metaGraphPost, uploadAdImage, uploadAdVideo, type AdFile } from "./meta-graph";
import { storage, mimeOf } from "./storage";
import { policyDecision } from "./meta-action-policy";
import { verifyApproval, type PlanStep } from "./meta-approval";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import type { MetaAdBuildCardPayload } from "./meta-build-spec";

export type BuildState = "done" | "partial" | "failed" | "needs_review";
export type BuildResult = { createdIds: Record<string, string>; state: BuildState };

/**
 * Sentinel thrown by claimAndCreate when it meets an APPLYING leftover from a prior crash:
 * the Meta create for that step MAY have fired before the crash (no id was recorded), so
 * re-creating risks a duplicate object. We refuse to re-create and surface needs_review.
 */
class InterruptedBuildError extends Error {
  constructor() {
    super("INTERRUPTED: a prior build crashed mid-create — refusing to re-create (ambiguous).");
    this.name = "InterruptedBuildError";
  }
}

/** User-facing reason stamped onto buildOutcome.reason when a build comes back needs_review. */
const NEEDS_REVIEW_REASON =
  "A previous build was interrupted partway — I won't risk creating duplicate ads. " +
  "Please check your Meta Ads Manager, then ask me to build again.";

// ── step indices (stable; the MetaActionExecution claim key is (ownerId,cardId,stepIndex)) ──
const STEP_UPLOAD = 0;
const STEP_CREATIVE = 1;
const STEP_CAMPAIGN = 2;
const STEP_ADSET = 3;
const STEP_AD = 4;

/** A sane optimization_goal valid for each supported objective. */
function optimizationGoalFor(objective: string): string {
  switch (objective) {
    case "OUTCOME_LEADS":
      return "LEAD_GENERATION";
    case "OUTCOME_SALES":
      return "OFFSITE_CONVERSIONS";
    case "OUTCOME_ENGAGEMENT":
      return "POST_ENGAGEMENT";
    case "OUTCOME_TRAFFIC":
    default:
      return "LINK_CLICKS";
  }
}

/**
 * Per-object idempotency claim. The unique index (ownerId,cardId,stepIndex) is RAW SQL,
 * not a Prisma @@unique, so we findFirst → create-with-catch (the index is the race-proof
 * backstop). Returns the created object's id.
 *
 * - APPLIED row → return its stored `appliedValue.id`, SKIP the create (never re-create).
 * - else: create PENDING (P2002 race → re-findFirst → APPLIED branch), mark APPLYING,
 *   run `create`, persist the id in `appliedValue`, mark APPLIED.
 *
 * `create()` throwing propagates to the caller, which records partial state and STOPS.
 */
async function claimAndCreate(
  ownerId: string,
  cardId: string,
  stepIndex: number,
  create: () => Promise<string>,
): Promise<string> {
  // 1. Existing row?
  let row = await prisma.metaActionExecution.findFirst({ where: { ownerId, cardId, stepIndex } });
  if (row) {
    if (row.status === "APPLIED") {
      const id = readAppliedId(row.appliedValue);
      if (id) return id; // already created — reuse, never re-create.
      // APPLIED but no recorded id: ambiguous (the object may exist in Meta). Re-creating
      // would duplicate it, so refuse rather than fall through to a fresh create. (F13)
      throw new InterruptedBuildError();
    }
    if (row.status === "APPLYING") {
      // AMBIGUOUS crash state: the row reached APPLYING before a prior crash, so the Meta
      // create for this step MAY have already fired (no id was recorded). Re-creating could
      // duplicate the object. Mark FAILED and refuse — the caller surfaces needs_review.
      await prisma.metaActionExecution.update({ where: { id: row.id }, data: { status: "FAILED" } });
      throw new InterruptedBuildError();
    }
    // PENDING/FAILED leftover → SAFE to re-claim this same row: no Meta create was attempted
    // (PENDING never reached APPLYING), so creating now cannot duplicate anything.
  } else {
    // 2. No row → create a PENDING claim. On a duplicate-insert race, re-read by index.
    try {
      row = await prisma.metaActionExecution.create({
        data: { id: newId(), ownerId, cardId, stepIndex, status: "PENDING" },
      });
    } catch (e) {
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        const existing = await prisma.metaActionExecution.findFirst({ where: { ownerId, cardId, stepIndex } });
        if (existing?.status === "APPLIED") {
          const id = readAppliedId(existing.appliedValue);
          if (id) return id;
        }
        // We LOST the unique-index insert race: another claimant already owns this step's row.
        // A PENDING/APPLYING row means that concurrent claimant is the rightful executor and may
        // be firing the Meta create right now — re-claiming and creating here would DUPLICATE the
        // object (duplicate campaign/adset, double budget). An APPLIED row without a usable id is
        // equally ambiguous. Refuse and surface needs_review; a genuinely crashed leftover (not
        // concurrent) is recovered by a later retry via the step-1 PENDING re-claim path. (F13)
        if (existing) throw new InterruptedBuildError();
        throw e;
      } else {
        throw e;
      }
    }
  }

  // 3. Mark APPLYING immediately before the create (the MAYBE-APPLIED window).
  await prisma.metaActionExecution.update({ where: { id: row.id }, data: { status: "APPLYING" } });

  // 4. Create the Meta object. A throw propagates → caller stops the build (partial).
  const createdId = await create();

  // 5. Persist the id and mark APPLIED.
  await prisma.metaActionExecution.update({
    where: { id: row.id },
    data: { status: "APPLIED", appliedValue: { id: createdId } as unknown as Prisma.InputJsonValue },
  });
  return createdId;
}

function readAppliedId(applied: unknown): string | null {
  if (applied && typeof applied === "object" && "id" in applied) {
    const id = (applied as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

/** Read the owner's asset bytes for a Generation id. Owner-scoped at every hop; returns
 *  null when the generation/asset is missing or foreign (NOT an error → caller fails the build). */
async function loadCreativeFile(ownerId: string, generationId: string): Promise<AdFile | null> {
  const generation = await prisma.generation.findFirst({
    where: { id: generationId, ownerId, deletedAt: null },
    select: { assetId: true },
  });
  if (!generation) return null;
  const asset = await prisma.asset.findUnique({
    where: { id: generation.assetId },
    select: { ownerId: true, contentHash: true, ext: true, mime: true },
  });
  if (!asset || asset.ownerId !== ownerId) return null; // defense in depth: never cross-tenant.
  let bytes: Uint8Array;
  try {
    bytes = await storage.get(storageKey(asset.ownerId, asset.contentHash, asset.ext));
  } catch {
    return null;
  }
  return {
    bytes,
    filename: `${generationId}.${asset.ext}`,
    contentType: asset.mime || mimeOf(asset.ext),
  };
}

/**
 * runAdBuild — the trusted ordered create. Caller already authorized (approveAdBuild or
 * maybeAutoBuild). This file does NOT re-authenticate, but every read/write is owner-scoped.
 */
export async function runAdBuild(ownerId: string, cardId: string): Promise<BuildResult> {
  // 1. KILL-SWITCH FIRST — before any upload/graph call, before loading the card.
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  if (!conn) return { createdIds: {}, state: "failed" };
  if (conn.adsWritesPaused === true) {
    // Hard refusal: throw so a caller can never mistake a paused org for a no-op success.
    throw new Error("KILL_SWITCH: ads writes are paused for this org");
  }
  if (!conn.canWrite) return { createdIds: {}, state: "failed" };

  let token: string;
  try {
    token = decryptToken(conn.accessTokenEnc);
  } catch {
    return { createdIds: {}, state: "failed" };
  }

  // 2. Load the owner-scoped BUILD_CARD → its frozen payload.
  const message = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "BUILD_CARD" },
  });
  if (!message || !message.payload) return { createdIds: {}, state: "failed" };
  const payload = message.payload as unknown as MetaAdBuildCardPayload;

  const accountId = payload.accountId;
  const createdIds: Record<string, string> = {};

  try {
    // ── step 0: upload the owner's asset bytes → image_hash / video_id ──
    const isVideo = payload.creative.kind === "video";
    const file = await loadCreativeFile(ownerId, payload.creative.assetId);
    if (!file) {
      // Missing/foreign asset → cannot build. Nothing created yet → failed.
      return { createdIds, state: "failed" };
    }
    const uploaded = await claimAndCreate(ownerId, cardId, STEP_UPLOAD, () =>
      isVideo ? uploadAdVideo(token, accountId, file) : uploadAdImage(token, accountId, file),
    );
    if (isVideo) createdIds.videoId = uploaded;
    else createdIds.imageHash = uploaded;

    // ── step 1: ad creative (object_story_spec is JSON-stringified per Meta) ──
    const creativeId = await claimAndCreate(ownerId, cardId, STEP_CREATIVE, async () => {
      const objectStorySpec = isVideo
        ? {
            page_id: payload.pageId,
            video_data: {
              video_id: uploaded,
              message: payload.creative.message,
              call_to_action: { type: payload.creative.cta, value: { link: payload.creative.link } },
            },
          }
        : {
            page_id: payload.pageId,
            link_data: {
              message: payload.creative.message,
              link: payload.creative.link,
              image_hash: uploaded,
              call_to_action: { type: payload.creative.cta, value: { link: payload.creative.link } },
            },
          };
      const res = await metaGraphPost(token, `${accountId}/adcreatives`, {
        object_story_spec: JSON.stringify(objectStorySpec),
      });
      return String(res.id);
    });
    createdIds.creativeId = creativeId;

    // ── steps 2-3 (create mode): campaign → adset. (into_existing: skip, use the given adset.) ──
    let adsetId: string;
    if (payload.mode === "into_existing") {
      adsetId = payload.intoExisting?.adsetId ?? "";
      if (!adsetId) return { createdIds, state: "partial" };
      createdIds.adsetId = adsetId;
    } else {
      const campaignId = await claimAndCreate(ownerId, cardId, STEP_CAMPAIGN, async () => {
        const res = await metaGraphPost(token, `${accountId}/campaigns`, {
          name: payload.goal || "Otto campaign",
          objective: payload.objective,
          status: "PAUSED",
          special_ad_categories: "[]",
        });
        return String(res.id);
      });
      createdIds.campaignId = campaignId;

      adsetId = await claimAndCreate(ownerId, cardId, STEP_ADSET, async () => {
        const body: Record<string, string | number> = {
          name: payload.goal || "Otto ad set",
          campaign_id: campaignId,
          daily_budget: payload.dailyBudgetMinor,
          billing_event: "IMPRESSIONS",
          optimization_goal: optimizationGoalFor(payload.objective),
          targeting: JSON.stringify(payload.targeting),
          status: "PAUSED",
        };
        if (payload.startTime) body.start_time = payload.startTime;
        const res = await metaGraphPost(token, `${accountId}/adsets`, body);
        return String(res.id);
      });
      createdIds.adsetId = adsetId;
    }

    // ── step 4: ad ──
    const adId = await claimAndCreate(ownerId, cardId, STEP_AD, async () => {
      const res = await metaGraphPost(token, `${accountId}/ads`, {
        name: payload.goal || "Otto ad",
        adset_id: adsetId,
        creative: JSON.stringify({ creative_id: creativeId }),
        status: "PAUSED",
      });
      return String(res.id);
    });
    createdIds.adId = adId;

    return { createdIds, state: "done" };
  } catch (e) {
    // An APPLYING leftover from a prior crash → ambiguous (a create may have fired). We did NOT
    // re-create; stop the batch and surface needs_review so the user checks Meta Ads Manager.
    if (e instanceof InterruptedBuildError) {
      return { createdIds, state: "needs_review" };
    }
    // Stop-on-first-failure: a create threw. Earlier ids are already in createdIds and
    // recorded in their MetaActionExecution rows. NO auto-delete; NO later object attempted.
    const anyCreated = Object.keys(createdIds).length > 0;
    return { createdIds, state: anyCreated ? "partial" : "failed" };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AUTHORIZATION GATES — the only two sanctioned entries to runAdBuild.
// ════════════════════════════════════════════════════════════════════════════

/** Reconstruct the EXACT single PlanStep the card's approval was built over. MUST mirror
 *  buildAdBuildCard's approval step (same fields, same order) or the hash won't match. */
function bindingSteps(payload: MetaAdBuildCardPayload): PlanStep[] {
  return [
    {
      index: 0,
      op: "build",
      targetId: payload.creative.assetId,
      targetValue: {
        objective: payload.objective,
        dailyBudgetMinor: payload.dailyBudgetMinor,
        pageId: payload.pageId,
        mode: payload.mode,
        adsetId: payload.intoExisting?.adsetId ?? null,
        startTime: payload.startTime ?? null,
        // F17: MUST mirror buildAdBuildCard's approval step exactly (same fields, same order).
        creative: {
          kind: payload.creative.kind,
          message: payload.creative.message,
          headline: payload.creative.headline ?? null,
          cta: payload.creative.cta,
          link: payload.creative.link,
        },
        targeting: payload.targeting,
      },
    },
  ];
}

/** Patch the card's frozen JSON payload with a single-use consume stamp, BEFORE executing,
 *  so a concurrent/duplicate trigger re-reads a consumed approval and is refused. */
async function consumeApproval(
  cardId: string,
  payload: MetaAdBuildCardPayload,
  nowIso: string,
): Promise<void> {
  const consumed: MetaAdBuildCardPayload = {
    ...payload,
    approval: { ...payload.approval, consumedAt: nowIso },
  };
  await prisma.chatMessage.update({
    where: { id: cardId },
    data: { payload: consumed as unknown as Prisma.InputJsonObject },
  });
}

/**
 * approveAdBuild — the HUMAN-approve gate (`'use server'`). The build card UI calls this when
 * the user clicks approve. This is where authorization happens:
 *   1. requireOwner (resolve ownerId server-side — NEVER a param).
 *   2. Block impersonation — staff must never build ads in a customer's account.
 *   3. Load the owner-scoped BUILD_CARD → frozen payload.
 *   4. Kill-switch + canWrite BEFORE consuming the single-use approval (per the v1 ultra-fix):
 *      runAdBuild throws KILL_SWITCH when paused — consuming first would burn the approval.
 *   5. Verify the approval BINDING (hash/actor/expiry/consumed). On any failure: refuse, do
 *      NOT execute, do NOT consume.
 *   6. Consume (single-use) — persist consumedAt BEFORE executing.
 *   7. runAdBuild (the trusted executor).
 */
export async function approveAdBuild(
  cardId: string,
): Promise<{ ok: true; state: BuildState; createdIds: Record<string, string> } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) {
    return { error: "Paused while impersonating a customer — exit impersonation to do this." };
  }
  const { ownerId } = gate;

  const message = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "BUILD_CARD" },
  });
  if (!message || !message.payload) return { error: "That build card no longer exists." };
  const payload = message.payload as unknown as MetaAdBuildCardPayload;

  // Kill-switch / canWrite gate BEFORE consuming the single-use approval. runAdBuild throws
  // KILL_SWITCH when adsWritesPaused — if we consumed first, that throw would burn the approval
  // forever (card un-approvable, nothing built). Check up front so the approval survives.
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  if (!conn || conn.canWrite !== true) {
    return { error: "Meta isn't connected for ad changes — reconnect and try again." };
  }
  if (conn.adsWritesPaused === true) {
    return { error: "Ad changes are paused (kill-switch on). Turn it off in Connections and try again." };
  }

  const verdict = verifyApproval(payload.approval, bindingSteps(payload), ownerId, new Date().toISOString());
  if (!verdict.ok) {
    return { error: `This build can't be approved (${verdict.reason}). Ask Otto to propose it again.` };
  }

  // Single-use: stamp consumedAt and persist BEFORE executing. A concurrent/duplicate approve
  // now re-reads a consumed approval (verifyApproval → "consumed") and is refused. The per-step
  // MetaActionExecution unique index is the real exactly-once serialization point.
  await consumeApproval(cardId, payload, new Date().toISOString());

  const result = await runAdBuild(ownerId, cardId);
  // Stamp buildOutcome onto the card so launchAdDraft can read it.
  // Use record() so a stamp failure never masks the build result.
  await record(ownerId, cardId, null, {
    built: result.state === "done",
    createdIds: result.createdIds,
    state: result.state,
    ...(result.state === "needs_review" ? { reason: NEEDS_REVIEW_REASON } : {}),
  });
  return { ok: true, state: result.state, createdIds: result.createdIds };
}

/**
 * launchAdDraft — creates a v1 ACTION_CARD that `resume`s the campaign/adset/ad created by
 * a done BUILD_CARD. The user then approves that ACTION_CARD via v1's approveMetaActionPlan
 * gate — no new spend/approval logic here.
 *
 * Returns the new ACTION_CARD id so the UI can surface it to the user, or `metaFallback:true`
 * when createdIds are incomplete (user should open Meta Ads Manager instead).
 */
export async function launchAdDraft(
  cardId: string,
): Promise<{ actionCardId: string } | { metaFallback: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const message = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "BUILD_CARD" },
    select: { threadId: true, payload: true },
  });
  if (!message || !message.payload) return { error: "That build card no longer exists." };

  const payload = message.payload as unknown as MetaAdBuildCardPayload;
  const buildOutcome = payload.buildOutcome as
    | { built?: boolean; state?: string; createdIds?: Record<string, string> }
    | undefined;

  if (!buildOutcome || buildOutcome.built !== true || buildOutcome.state !== "done") {
    return { error: "The draft hasn't been built yet — approve it first." };
  }

  const createdIds = buildOutcome.createdIds ?? {};
  const { campaignId, adsetId, adId } = createdIds;

  if (!campaignId || !adsetId || !adId) {
    return { metaFallback: true };
  }

  const { proposeMetaActionForOwner } = await import("./meta-propose");

  const result = await proposeMetaActionForOwner(ownerId, message.threadId, {
    planTitle: `Launch "${payload.goal || "ad"}"`,
    steps: [
      { op: "resume", targetId: campaignId, intent: {} },
      { op: "resume", targetId: adsetId, intent: {} },
      { op: "resume", targetId: adId, intent: {} },
    ],
  });

  if ("notConnected" in result) return { error: "Meta isn't connected — reconnect and try again." };
  if ("needsReconnect" in result) return { error: "Meta token expired — reconnect and try again." };
  if ("unknownTargets" in result) return { metaFallback: true };
  if ("invalidSteps" in result) return { metaFallback: true };

  return { actionCardId: result.cardId };
}

/**
 * maybeAutoBuild — the AUTO path (internal). Called by proposeAdBuildForOwner right after
 * persisting an auto-eligible build card. Defense-in-depth: re-derive authorization
 * server-side — never trust a stored flag:
 *   - require MetaConnection.adsAutonomy === "AUTO"
 *   - require policyDecision("AUTO","safe") === "auto" (build is money-safe → autos under AUTO)
 *   - kill-switch off + canWrite
 * On success: stamp consumedAt then run. Records `buildOutcome` onto the card payload and
 * returns the outcome — it NEVER throws to the propose turn (a build failure must not break
 * the proposal that already persisted).
 */
export async function maybeAutoBuild(
  ownerId: string,
  cardId: string,
): Promise<{ built: false; reason: string } | { built: true; state: BuildState; createdIds: Record<string, string> }> {
  try {
    const message = await prisma.chatMessage.findFirst({
      where: { id: cardId, ownerId, kind: "BUILD_CARD" },
    });
    if (!message || !message.payload) return await record(ownerId, cardId, null, { built: false, reason: "missing-card" });
    const payload = message.payload as unknown as MetaAdBuildCardPayload;

    // Re-derive server-side — do NOT trust any stored flag.
    const conn = await prisma.metaConnection.findUnique({
      where: { ownerId },
      select: { adsAutonomy: true, adsWritesPaused: true, canWrite: true },
    });
    const mode = conn?.adsAutonomy ?? "ASK";
    if (mode !== "AUTO") return await record(ownerId, cardId, payload, { built: false, reason: "mode-ask" });
    // build is money-safe; under AUTO it auto-runs. Re-derive via the policy table (no hardcode).
    if (policyDecision("AUTO", "safe") !== "auto") {
      return await record(ownerId, cardId, payload, { built: false, reason: "policy-ask" });
    }

    // Kill-switch / canWrite BEFORE consuming the single-use approval — same reason as approve.
    if (!conn || conn.canWrite !== true) return await record(ownerId, cardId, payload, { built: false, reason: "cannot-write" });
    if (conn.adsWritesPaused === true) return await record(ownerId, cardId, payload, { built: false, reason: "kill-switch" });

    await consumeApproval(cardId, payload, new Date().toISOString());

    const result = await runAdBuild(ownerId, cardId);
    if (result.state === "needs_review") {
      return await record(ownerId, cardId, payload, {
        built: false,
        state: result.state,
        createdIds: result.createdIds,
        reason: NEEDS_REVIEW_REASON,
      });
    }
    return await record(ownerId, cardId, payload, { built: true, state: result.state, createdIds: result.createdIds });
  } catch (e) {
    // A throw (incl. KILL_SWITCH from a race) must never break the propose turn.
    const reason = e instanceof Error ? e.message.slice(0, 200) : "build-threw";
    return await record(ownerId, cardId, null, { built: false, reason });
  }
}

/**
 * Patch a `buildOutcome` stamp onto the card payload (best-effort, mirrors the v1 autoOutcome
 * patch) and return the outcome. A failed stamp must never break the propose turn.
 */
async function record<T extends { built: boolean; reason?: string; state?: BuildState; createdIds?: Record<string, string> }>(
  ownerId: string,
  cardId: string,
  payload: MetaAdBuildCardPayload | null,
  outcome: T,
): Promise<T> {
  try {
    const base =
      payload ??
      ((await prisma.chatMessage.findFirst({ where: { id: cardId, ownerId, kind: "BUILD_CARD" } }))
        ?.payload as unknown as MetaAdBuildCardPayload | undefined);
    if (base) {
      const patched: MetaAdBuildCardPayload = { ...base, buildOutcome: outcome as Record<string, unknown> };
      await prisma.chatMessage.update({
        where: { id: cardId },
        data: { payload: patched as unknown as Prisma.InputJsonObject },
      });
    }
  } catch {
    // best-effort stamp — never throw.
  }
  return outcome;
}
