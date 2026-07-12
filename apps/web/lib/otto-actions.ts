/**
 * ottoTurn — Otto agent server action (Task 1.8a)
 * ottoApprove — approve a parked generate → resume → spend (Task 1.8b)
 *
 * NON-MONEY half (ottoTurn): runs the Otto agent loop for a user message, persists
 * conversation state to ChatThread.ottoState, charges the turn's LLM cost via
 * withLlmBudget, and handles completed / interrupted (needs_approval) / maxTurns-exceeded
 * gracefully. The generate tool is gated by needsApproval:true — it PARKS and returns
 * "needs_approval". The actual spend (approve/resume) is ottoApprove (Task 1.8b).
 *
 * MONEY half (ottoApprove): rehydrates the paused RunState, verifies + approves the
 * matching generate interruption (cardId binding), and resumes the run — which executes
 * generate.execute → ctx.startGen → real spend. Resume is metered via withLlmBudget.
 *
 * MONEY-SAFETY INVARIANTS (ottoApprove):
 *   - Spend goes ONLY through the resumed generate tool → ctx.startGen (never directly).
 *   - cardId binding: approves only the generate interruption whose arguments.cardId
 *     matches the approved cardId. Mismatch → reject, no approve, no spend.
 *   - Double-approve safe: if no pending interruption but a GenJob cowork:<cardId> already
 *     exists, returns it benignly (no second approve, no second spend).
 *   - Resume turn LLM cost is metered via withLlmBudget (reserve → settle).
 *   - Tenant-scoped: thread loaded owner-scoped; cross-tenant threadId/cardId rejected.
 *
 * Owner-scoped validation mirrors coworkTurn. Does NOT modify coworkTurn/coworkGenerate.
 */
import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import type { Prisma } from "@fikirtive/db";
import {
  newId,
  coworkTurnRequest,
  OTTO_MAX_STEPS,
  GOAL_PRESETS,
  isGoalKey,
  tavilySearch,
  braveSearch,
  searchWithFallback,
  extractProductDraft,
} from "@fikirtive/core";
import { otto, withLlmBudget, OTTO_DEFAULT_MODEL, run, MaxTurnsExceededError, mapOttoUsage, ottoSimpleModeBlock, buildUserTurn, sanitizeHistory, tryRestoreRunState, extractText, collectApprovalInterruptions, approvalRefOf } from "@fikirtive/otto";
import type { OttoContext, AgentInputItem, ApprovalInterruption } from "@fikirtive/otto";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { resolveDisabledModels } from "./model-registry";
import { startGen } from "./gen-actions";
import { gatherReferenceImages } from "./otto-ref-images";
import { getBrandContextText } from "./memory-actions";
import { fetchAndExtract, fetchRawHtml } from "./fetch-extract";
import { draftScheduledPost } from "./schedule-service";
import {
  approveScheduledPost,
  cancelScheduledPost,
  updateScheduledPost,
  listScheduledPosts,
  listOwnerTargets,
} from "./schedule-actions";
import { asApprovalCardPayload, type ApprovalCardPayload, type ApprovalCardSummary } from "./approval-card-view";
import { readPageCached } from "./web-page-cache";
import { fetchOwnerInsights } from "./meta-insights";
import { fetchOwnerAdPerformance } from "./meta-performance";
import { fetchOwnerAdObjects } from "./meta-objects";
import { fetchOwnerPages } from "./meta-pages";
import { proposeMetaActionForOwner } from "./meta-propose";
import { proposeAdBuildForOwner } from "./meta-build-propose";
import { validateOwnedGenerationExt } from "./otto-generation-validate";

// mapOttoUsage re-exported from @fikirtive/otto so existing callers that import
// it from this module continue to work (the canonical source is @fikirtive/otto).
export { mapOttoUsage } from "@fikirtive/otto";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
const VIDEO_EXTS = ["mp4", "mov", "webm"];

function orderedUniqueIds(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function validateGenerationRefs(input: {
  ownerId: string;
  projectId: string;
  ids: string[];
  exts: string[];
}): Promise<string[]> {
  const valid: string[] = [];
  for (const id of input.ids) {
    const resolved = await validateOwnedGenerationExt(prisma, {
      id,
      ownerId: input.ownerId,
      projectId: input.projectId,
      exts: input.exts,
    });
    if (resolved) valid.push(resolved);
  }
  return orderedUniqueIds(valid);
}

export async function validateOttoTurnReferences(input: {
  ownerId: string;
  projectId: string;
  sourceGenerationId?: string | null;
  sourceGenerationIds?: string[] | null;
  referenceVideoGenerationId?: string | null;
  referenceVideoGenerationIds?: string[] | null;
}): Promise<{ sourceGenerationIds: string[]; referenceVideoGenerationIds: string[] }> {
  const sourceIds = orderedUniqueIds([...(input.sourceGenerationIds ?? []), input.sourceGenerationId]);
  const videoIds = orderedUniqueIds([...(input.referenceVideoGenerationIds ?? []), input.referenceVideoGenerationId]);
  const [validSourceIds, validVideoIds] = await Promise.all([
    validateGenerationRefs({ ownerId: input.ownerId, projectId: input.projectId, ids: sourceIds, exts: IMAGE_EXTS }),
    validateGenerationRefs({ ownerId: input.ownerId, projectId: input.projectId, ids: videoIds, exts: VIDEO_EXTS }),
  ]);
  return { sourceGenerationIds: validSourceIds, referenceVideoGenerationIds: validVideoIds };
}

/**
 * Safe one-line error summary for server logs. Logs name/message/statusCode only —
 * NOT the raw error, whose AI SDK provider fields (e.g. requestBodyValues) can carry
 * the full prompt, user text, and context into logs.
 */
function errSummary(e: unknown): string {
  if (!e || typeof e !== "object") return String(e);
  const x = e as { name?: unknown; message?: unknown; statusCode?: unknown };
  return [x.name, x.message, x.statusCode != null ? `status=${x.statusCode}` : null]
    .filter(Boolean)
    .join(" | ") || String(e);
}

// ---------------------------------------------------------------------------
// loadAvailableRefsForAgent — owner-scoped entity loader for the agent context
// ---------------------------------------------------------------------------

/** Returns the slim { id, name, type } shape the agent context needs.
 *  Best-effort: returns [] on any error so context injection never fails the turn. */
async function loadAvailableRefsForAgent(ownerId: string): Promise<{ id: string; name: string; type: string }[]> {
  try {
    const entities = await prisma.entity.findMany({
      // Only surface entities Otto can actually USE as a visual reference: one with no
      // reference image can't meaningfully be @-mentioned (nothing to condition on). This
      // also keeps ref-less test/junk entities out of Otto's @-suggestions (audit STUFF-7).
      where: { ownerId, deletedAt: null, referenceImages: { some: { deletedAt: null } } },
      select: { id: true, name: true, type: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    return entities.map((e) => ({ id: e.id, name: e.name, type: e.type }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// buildContextSystemMessage — compose the injected system message from OttoContext
// ---------------------------------------------------------------------------

export function buildContextSystemMessage(ctx: OttoContext): AgentInputItem | null {
  const parts: string[] = [];
  if (ctx.brandContext) parts.push(`What you know about the user's brand:\n${ctx.brandContext}`);
  if (ctx.availableRefs?.length) {
    parts.push(
      `Reusable items you can @-reference (use the id with tools): ${ctx.availableRefs.map((r) => `@${r.name} [${r.type}, id=${r.id}]`).join(", ")}`,
    );
  }
  if (ctx.simpleMode) parts.push(ottoSimpleModeBlock);
  if (ctx.activeJob) {
    const s = ctx.activeJob.status;
    const human =
      s === "DONE" ? "the last generation finished"
      : s === "FAILED" ? "the last generation FAILED — the user was automatically refunded, so they were NOT charged for it"
      : s === "GENERATING" ? "a generation is being made right now"
      : s === "QUEUED" ? "a generation is queued and about to start"
      : `the last generation status is ${s}`;
    parts.push(`Current generation status for this conversation: ${human}. Speak about generation progress ONLY based on this.`);
  }
  if ((ctx.images?.length ?? 0) > 1) {
    parts.push(`The user attached ${ctx.images!.length} IMAGE REFERENCES this turn. You can inspect them as input images; compare and use all relevant visual details from the attached references.`);
  }
  const referenceVideoCount = ctx.referenceVideoGenerationIds?.length ?? (ctx.referenceVideoGenerationId ? 1 : 0);
  if (referenceVideoCount > 0) {
    // Per-turn signal: unlike an attached image (which Otto SEES as an input_image part),
    // a reference video is invisible to the model — so tell it one is attached this turn.
    parts.push(
      referenceVideoCount === 1
        ? `The user attached a REFERENCE VIDEO this turn — you cannot see it; reason from their words. Propose kind:"video" so the clip guides the generation's motion, pacing, and style.`
        : `The user attached ${referenceVideoCount} REFERENCE VIDEOS this turn — you cannot see the clips; reason from their words. Propose kind:"video" so the primary clip can guide the generation's motion, pacing, and style, and acknowledge when multiple clips may be conflicting references.`,
    );
  }
  return parts.length ? ({ role: "system", content: parts.join("\n\n") } as AgentInputItem) : null;
}

// ---------------------------------------------------------------------------
// buildOttoContext — exported for 1.8b reuse
// ---------------------------------------------------------------------------

export async function buildOttoContext({
  ownerId,
  projectId,
  threadId,
  sourceGenerationId,
  sourceGenerationIds,
  referenceVideoGenerationId,
  referenceVideoGenerationIds,
  simpleMode,
}: {
  ownerId: string;
  projectId: string;
  threadId: string;
  sourceGenerationId?: string | null;
  sourceGenerationIds?: string[] | null;
  referenceVideoGenerationId?: string | null;
  referenceVideoGenerationIds?: string[] | null;
  simpleMode?: boolean;
}): Promise<OttoContext> {
  const disabledModels = Array.from(await resolveDisabledModels());
  const imageRefIds = orderedUniqueIds([...(sourceGenerationIds ?? []), sourceGenerationId]);
  const videoRefIds = orderedUniqueIds([...(referenceVideoGenerationIds ?? []), referenceVideoGenerationId]);

  // Web-search transport (S1). Tavily is primary; Brave is the fallback when both keys
  // are present. With no key configured, `search` is left unwired — researchWeb's query
  // path then returns its graceful "not configured" message (fail-closed, never crashes).
  const k1 = process.env.TAVILY_API_KEY;
  const k2 = process.env.BRAVE_SEARCH_API_KEY;
  const primary = k1 ? tavilySearch(k1) : k2 ? braveSearch(k2) : undefined;
  const fb = k1 && k2 ? braveSearch(k2) : undefined;
  // Wrap the bare WebSearchResult[] the adapter returns in { results } to match the port shape.
  const search = primary
    ? async (query: string) => ({ results: await searchWithFallback(primary, fb)(query) })
    : undefined;

  const [brandContext, availableRefs, activeJob, images] = await Promise.all([
    getBrandContextText(ownerId, null).catch(() => ""),
    loadAvailableRefsForAgent(ownerId),
    prisma.genJob.findFirst({
      where: { threadId, ownerId },
      orderBy: { createdAt: "desc" },
      select: { status: true, kind: true, error: true },
    }).catch(() => null),
    gatherReferenceImages(ownerId, projectId, imageRefIds),
  ]);
  return {
    orgId: ownerId,
    // userId is the owner/tenant scope (= orgId), not a distinct verified per-user id — no per-user
    // token is threaded here. See OttoContext.userId doc. Do not treat as an individual-member id.
    userId: ownerId,
    projectId,
    threadId,
    disabledModels,
    // Image refs still go to Otto vision below, but when a reference video is attached
    // the current paid generation path stays single-primary video-reference only.
    sourceGenerationId: videoRefIds.length > 0 ? null : imageRefIds[0] ?? null,
    sourceGenerationIds: imageRefIds,
    referenceVideoGenerationId: videoRefIds[0] ?? null,
    referenceVideoGenerationIds: videoRefIds,
    images,
    startGen,
    brandContext,
    availableRefs,
    simpleMode: simpleMode ?? false,
    activeJob,
    metaAds: { list: () => fetchOwnerAdObjects(ownerId) },
    metaPages: { list: () => fetchOwnerPages(ownerId) },
    metaInsights: { get: (datePreset: string) => fetchOwnerInsights(ownerId, datePreset) },
    metaPerformance: { getAds: (p: string) => fetchOwnerAdPerformance(ownerId, p) },
    metaPropose: (input) => proposeMetaActionForOwner(ownerId, threadId, input),
    metaBuild: { propose: (input) => proposeAdBuildForOwner(ownerId, threadId, input) },
    brandBrain: { context: () => getBrandContextText(ownerId, null).catch(() => "") },
    research: {
      fetchUrl: fetchAndExtract,
      search,
      readPage: (url: string, page?: number) => readPageCached(url, page),
    },
    // Single write authority: Otto's schedulePosts skill drafts through the SAME server function
    // the human createScheduledPost action uses (shared validation + owner-scoped media check).
    // debt-70~74 (B4): the remaining ports are the SAME owner-scoped server actions the human
    // buttons/views use — identity re-derives from the verified session inside each action
    // (requireOwner), which is the session this run executes under; approve/cancel/update also
    // re-check impersonation there. Skills never touch Prisma (single-action-layer rule).
    schedule: {
      draft: (input) => draftScheduledPost({ ownerId, projectId, source: "otto", input }),
      approve: ({ scheduledPostId }) => approveScheduledPost(scheduledPostId),
      cancel: ({ scheduledPostId }) => cancelScheduledPost(scheduledPostId),
      update: ({ scheduledPostId, patch }) => updateScheduledPost(scheduledPostId, patch),
      list: async ({ from, to }) => {
        const rows = await listScheduledPosts({ from, to });
        return rows.map((r) => ({
          id: r.id,
          channel: r.channel,
          caption: r.caption,
          status: r.status,
          scheduledAt: r.scheduledAt.toISOString(),
          scheduledTz: r.scheduledTz,
          approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
          mediaCount: r.media.length,
          lastError: r.lastError,
        }));
      },
      listTargets: () => listOwnerTargets(),
    },
    productIngest: {
      // Layer 1 only: fetch (SSRF-hardened) + deterministic extract, plus the page text so
      // Otto itself fills any gaps (that is the skill path's Layer 2 — no separate LLM call).
      fromUrl: async (url: string) => {
        try {
          const { html, url: sourceUrl } = await fetchRawHtml(url);
          const draft = extractProductDraft(html, sourceUrl);
          const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
          return { draft, text };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Couldn't read that URL." };
        }
      },
    },
  };
}

// ---------------------------------------------------------------------------
// finalizeOttoRun — shared post-run persistence
// (extractText lives in @fikirtive/otto run-output.ts — the single source, 7-14b.)
//
// finalizeOttoRun is the EXACT post-run persistence ottoTurn performs after a
// (non-streaming) run completes, lifted verbatim so the streaming route handler
// (app/api/otto/stream/route.ts) can reuse it WITHOUT duplicating ~100 lines of
// money-adjacent CAS logic. Behavior is identical:
//   - interruption branch: CAS-write paused ottoState (existing) / plain update
//     (new) → stale on count 0 → persist partial assistant text → needs_approval
//   - completed branch: CAS-write ottoState (existing) / $transaction (new) →
//     stale on count 0 → persist assistant reply → done
// The CAS guard `updateMany({ where:{ id, ownerId, ottoState: priorOttoState }})`
// (count 0 ⇒ stale) is preserved. Does NOT call revalidatePath (caller-owned).
// ---------------------------------------------------------------------------

export type FinalizeOttoRunResult =
  | { status: "needs_approval"; pendingCardIds: string[] }
  | { status: "done"; reply: string }
  | { status: "stale" };

// ---------------------------------------------------------------------------
// Universal approval cards (B4 debt-70, spec §五 5.1·附 touchpoints ①/②) — the durable
// APPROVAL_CARD a non-generate approval-gated skill parks as. generate keeps its own
// GEN_CARD/OttoPlanCard spend path untouched; these helpers only serve the other gated skills.
// ---------------------------------------------------------------------------

/** R1: enrich the card with WHAT is being consented to (owner-scoped read), never a bare id. */
async function buildApprovalCardSummary(
  ownerId: string,
  toolName: string,
  ref: string,
): Promise<ApprovalCardSummary | null> {
  if (toolName !== "approveScheduledPost") return null;
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: ref, ownerId, deletedAt: null },
      select: {
        channel: true, caption: true, scheduledAt: true, scheduledTz: true,
        media: { select: { generationId: true } },
      },
    });
    if (!post) return null;
    return {
      channel: post.channel,
      caption: post.caption,
      scheduledAt: post.scheduledAt.toISOString(),
      scheduledTz: post.scheduledTz,
      mediaCount: post.media.length,
    };
  } catch {
    return null;
  }
}

/**
 * Persist one APPROVAL_CARD per parked non-generate approval. Deduped per (toolName, ref,
 * status=pending): a rehydrated run can re-park the SAME pending tool call (the user sent another
 * message while an approval waited), and that must not mint a second card for one consent.
 */
async function persistPendingApprovalCards(args: {
  ownerId: string;
  threadId: string;
  approvals: ApprovalInterruption[];
  seqStart: number;
}): Promise<{ cardIds: string[]; seq: number }> {
  let seq = args.seqStart;
  const cardIds: string[] = [];
  for (const a of args.approvals) {
    const existing = await prisma.chatMessage.findFirst({
      where: {
        threadId: args.threadId,
        ownerId: args.ownerId,
        kind: "APPROVAL_CARD",
        AND: [
          { payload: { path: ["toolName"], equals: a.toolName } },
          { payload: { path: ["ref"], equals: a.ref } },
          { payload: { path: ["status"], equals: "pending" } },
        ],
      },
      select: { id: true },
    });
    if (existing) {
      cardIds.push(existing.id);
      continue;
    }
    const summary = await buildApprovalCardSummary(args.ownerId, a.toolName, a.ref);
    const payload: ApprovalCardPayload = { toolName: a.toolName, ref: a.ref, status: "pending", summary };
    const id = newId();
    await prisma.chatMessage.create({
      data: {
        id,
        threadId: args.threadId,
        ownerId: args.ownerId,
        role: "AGENT",
        kind: "APPROVAL_CARD",
        seq: ++seq,
        text: "",
        payload: payload as unknown as Prisma.InputJsonObject,
      },
    });
    cardIds.push(id);
  }
  return { cardIds, seq };
}

/** Owner-scoped card-status stamp (pending → approved/rejected). The card records the consent
 *  decision; the underlying action's own result is relayed in Otto's resumed reply. */
async function setApprovalCardStatus(
  cardId: string,
  ownerId: string,
  payload: ApprovalCardPayload,
  status: "approved" | "rejected",
): Promise<void> {
  await prisma.chatMessage
    .updateMany({
      where: { id: cardId, ownerId, kind: "APPROVAL_CARD" },
      data: { payload: { ...payload, status } as unknown as Prisma.InputJsonObject },
    })
    .catch((err) => {
      console.warn(`[approval-card] status stamp failed (cardId=${cardId}).`, err);
    });
}

/**
 * Persist a completed/interrupted Otto run, with the SAME CAS + seq semantics as
 * ottoTurn. `seqAfterUser` is the seq value AFTER the USER message was written;
 * the assistant message is created at `seqAfterUser + 1`.
 */
export async function finalizeOttoRun({
  ownerId,
  threadId,
  isNew,
  priorOttoState,
  result,
  seqAfterUser,
}: {
  ownerId: string;
  threadId: string;
  isNew: boolean;
  priorOttoState: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  seqAfterUser: number;
}): Promise<FinalizeOttoRunResult> {
  const newOttoState = result.state.toString() as string;
  // Tools persist card messages MID-run at max(seq)+1 (proposePack writes one per
  // item), so the pre-run seqAfterUser snapshot can be stale. Writing the reply at
  // seqAfterUser+1 would collide with the first card — a reload (ordered by seq)
  // then interleaves the TEXT into the pack and splits the PackCard grouping.
  const lastMsg = await prisma.chatMessage.findFirst({
    where: { threadId, ownerId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  let seq = Math.max(seqAfterUser, lastMsg?.seq ?? 0);

  // Handle interruption (an approval-gated tool parked for approval)
  if (Array.isArray(result.interruptions) && result.interruptions.length > 0) {
    // Closed set from the registry (collectApprovalInterruptions): generate keeps its existing
    // contract — pendingCardIds carries its pre-persisted GEN_CARD ids. Other gated tools
    // (approveScheduledPost) get a durable APPROVAL_CARD persisted below (B4 debt-70 5.1·附①).
    const approvals = collectApprovalInterruptions(result.interruptions as unknown[]);
    const pendingCardIds: string[] = approvals.filter((a) => a.toolName === "generate").map((a) => a.ref);
    const nonGenerateApprovals = approvals.filter((a) => a.toolName !== "generate");

    // CAS: only write paused ottoState if no concurrent turn moved it (existing thread only)
    if (!isNew) {
      const { count: casCount } = await prisma.chatThread.updateMany({
        where: { id: threadId, ownerId, ottoState: priorOttoState },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });
      if (casCount === 0) return { status: "stale" };
    } else {
      await prisma.chatThread.update({
        where: { id: threadId },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });
    }

    // CAS won (or new thread) — persist any assistant text produced before the interruption
    const assistantText = extractText(result);
    if (assistantText) {
      await prisma.chatMessage.create({
        data: {
          id: newId(),
          threadId,
          ownerId,
          role: "AGENT",
          kind: "TEXT",
          seq: ++seq,
          text: assistantText,
        },
      });
    }

    // Durable approval cards for the non-generate gated tools (after the explanatory text).
    if (nonGenerateApprovals.length > 0) {
      const persisted = await persistPendingApprovalCards({
        ownerId,
        threadId,
        approvals: nonGenerateApprovals,
        seqStart: seq,
      });
      seq = persisted.seq;
      pendingCardIds.push(...persisted.cardIds);
    }

    return { status: "needs_approval", pendingCardIds };
  }

  // Completed — persist Otto's final reply + ottoState
  const replyText = extractText(result);

  if (!isNew) {
    // CAS: only write if no concurrent turn moved the state on
    const { count: casCount } = await prisma.chatThread.updateMany({
      where: { id: threadId, ownerId, ottoState: priorOttoState },
      data: { ottoState: newOttoState, updatedAt: new Date() },
    });
    if (casCount === 0) return { status: "stale" };
    await prisma.chatMessage.create({
      data: {
        id: newId(),
        threadId,
        ownerId,
        role: "AGENT",
        kind: "TEXT",
        seq: ++seq,
        text: replyText,
      },
    });
  } else {
    await prisma.$transaction([
      prisma.chatThread.update({
        where: { id: threadId },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      }),
      prisma.chatMessage.create({
        data: {
          id: newId(),
          threadId,
          ownerId,
          role: "AGENT",
          kind: "TEXT",
          seq: ++seq,
          text: replyText,
        },
      }),
    ]);
  }

  return { status: "done", reply: replyText };
}

// ---------------------------------------------------------------------------
// ottoTurn — the main server action
// ---------------------------------------------------------------------------

export async function ottoTurn(raw: unknown): Promise<
  | { threadId: string; status: "done"; reply: string }
  | { threadId: string; status: "needs_approval"; pendingCardIds: string[] }
  | { threadId: string; status: "degraded" }
  | { threadId: string; status: "stale" }
  | { error: string }
> {
  const parsed = coworkTurnRequest.safeParse(raw);
  if (!parsed.success) return { error: "Say what you'd like to make." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
  const { ownerId } = gate;

  const { projectId, text, entityIds, variantSel, sourceGenerationId, sourceGenerationIds, referenceVideoGenerationId, referenceVideoGenerationIds, replyToMessageId } = parsed.data;

  try {
    const OWNED = { ownerId, deletedAt: null } as const;

    // Validate the project is owned + live
    const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
    if (!project) return { error: "Project not found." };

    const refs = await validateOttoTurnReferences({
      ownerId,
      projectId,
      sourceGenerationId,
      sourceGenerationIds,
      referenceVideoGenerationId,
      referenceVideoGenerationIds,
    });

    // Resolve thread: new vs existing-owned-and-in-project
    const isNew = !parsed.data.threadId;
    const threadId = parsed.data.threadId ?? newId();
    let priorOttoState: string | null = null;

    if (!isNew) {
      const t = await prisma.chatThread.findFirst({
        where: { id: threadId, ...OWNED },
        select: { projectId: true, ottoState: true },
      });
      if (!t || t.projectId !== projectId) return { error: "Conversation not found." };
      priorOttoState = t.ottoState;
    }

    // Validate replyToMessageId (scoped, else null)
    let validReplyId: string | null = null;
    if (!isNew && replyToMessageId) {
      const qm = await prisma.chatMessage.findFirst({
        where: { id: replyToMessageId, threadId, ownerId, deletedAt: null },
        select: { id: true },
      });
      if (qm) validReplyId = qm.id;
    }

    // Compute next seq
    const last = isNew
      ? null
      : await prisma.chatMessage.findFirst({
          where: { threadId, ownerId },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
    let seq = last?.seq ?? 0;

    // Persist USER message first (create thread row first if new — FK ordering)
    if (isNew) {
      await prisma.chatThread.create({
        data: { id: threadId, ownerId, projectId, title: text.slice(0, 80) },
      });
    }
    const userMessageId = newId();
    await prisma.chatMessage.create({
      data: {
        id: userMessageId,
        threadId,
        ownerId,
        role: "USER",
        kind: "TEXT",
        seq: ++seq,
        text,
        payload: { entityIds, variantSel, sourceGenerationIds: refs.sourceGenerationIds, referenceVideoGenerationIds: refs.referenceVideoGenerationIds },
        replyToMessageId: validReplyId,
      },
    });

    // Build context
    const ctx = await buildOttoContext({
      ownerId,
      projectId,
      threadId,
      sourceGenerationIds: refs.sourceGenerationIds,
      referenceVideoGenerationIds: refs.referenceVideoGenerationIds,
      simpleMode: parsed.data.simple,
    });

    // Goal-intent seeding: on a new thread with a goalKey, append the preset's opening
    // to brandContext so buildContextSystemMessage injects it as a system message.
    if (isNew && parsed.data.goalKey && isGoalKey(parsed.data.goalKey)) {
      ctx.brandContext = [ctx.brandContext, `Goal for this conversation: ${GOAL_PRESETS[parsed.data.goalKey].opening}`]
        .filter(Boolean)
        .join("\n\n");
    }

    // Build run input: rehydrate prior state (multi-turn) or start fresh;
    // prepend a system message with brand context + available refs when present.
    const sys = buildContextSystemMessage(ctx);
    const userTurn = buildUserTurn(text, ctx.images);
    let runInput: AgentInputItem[];
    const priorState = priorOttoState ? await tryRestoreRunState(otto, priorOttoState) : null;
    if (priorState) {
      runInput = [...(sys ? [sys] : []), ...sanitizeHistory(priorState.history), userTurn];
    } else {
      // No prior state OR an unrestorable one (F24): start fresh — the turn still runs and its
      // normal state write self-heals ottoState to the current schema.
      runInput = [...(sys ? [sys] : []), userTurn];
    }

    // Run agent, metered. Key the reservation off the UNIQUE user-message id, not threadId:seq —
    // seq is read-max-then-insert with only a non-unique index, so two concurrent turns can land
    // the same seq → the same `otto-turn:threadId:seq` refId → the second reserveCredits collides
    // on the reserve:<refId> unique index and no-ops, running a turn WITHOUT holding credits (F27).
    const refId = `otto-turn:${userMessageId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let agentResult: any;

    try {
      agentResult = await withLlmBudget(
        {
          orgId: ownerId,
          refId,
          model: OTTO_DEFAULT_MODEL,
          paid: true,
          maxSteps: OTTO_MAX_STEPS,
          usageOnError: (e) => (e instanceof MaxTurnsExceededError && (e as { state?: { usage?: unknown } }).state?.usage)
            ? mapOttoUsage((e as { state: { usage: Parameters<typeof mapOttoUsage>[0] } }).state.usage)
            : null,
        },
        async () => {
          const r = await run(otto, runInput, { context: ctx, maxTurns: OTTO_MAX_STEPS });
          return { result: r, usage: mapOttoUsage(r.state.usage) };
        },
      );
    } catch (e) {
      if (e instanceof MaxTurnsExceededError) {
        // Graceful degrade — withLlmBudget already settled actual usage (or refunded if no usage)
        const degradeText = "I got a bit tangled up — try asking again.";
        await prisma.chatMessage.create({
          data: {
            id: newId(),
            threadId,
            ownerId,
            role: "AGENT",
            kind: "TEXT",
            seq: ++seq,
            text: degradeText,
          },
        });
        revalidatePath("/", "layout");
        return { threadId, status: "degraded" };
      }
      // InsufficientCredits and other errors bubble to {error} contract
      throw e;
    }

    // agentResult is a RunResult from withLlmBudget; typed as any to avoid overload ambiguity
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = agentResult as any;

    // Persist the run (interruption / completed / stale) with CAS — shared with the
    // streaming route handler via finalizeOttoRun (identical behavior).
    const finalized = await finalizeOttoRun({ ownerId, threadId, isNew, priorOttoState, result, seqAfterUser: seq });
    revalidatePath("/", "layout");
    if (finalized.status === "stale") return { threadId, status: "stale" };
    if (finalized.status === "needs_approval") {
      return { threadId, status: "needs_approval", pendingCardIds: finalized.pendingCardIds };
    }
    return { threadId, status: "done", reply: finalized.reply };
  } catch (e) {
    // Log the real cause server-side: the generic client message hides it, and a swallowed
    // error here once masked an Anthropic 529 for hours. The client message stays generic.
    console.error("[ottoTurn] failed:", errSummary(e));
    return { error: "Couldn't reach Otto — please try again." };
  }
}

// ---------------------------------------------------------------------------
// ottoApprove — approve a parked generate interruption and resume the run
// (Task 1.8b — MONEY half)
// ---------------------------------------------------------------------------

export async function ottoApprove(raw: unknown): Promise<
  | { ok: true; status: "done"; reply: string; genJobId?: string }
  | { ok: true; status: "needs_approval"; pendingCardIds: string[] }
  | { ok: true; status: "degraded" }
  | { ok: true; status: "stale" }
  | { ok: true; genJobId: string; status: string } // double-approve: existing job
  | { ok: true; alreadyResolved: true; resolution: "approved" | "rejected" } // double-approve: consumed card
  | { error: string }
> {
  // Inline validation (no zod dep in apps/web) — mirror brief schema
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).threadId !== "string" ||
    typeof (raw as Record<string, unknown>).cardId !== "string" ||
    ((raw as Record<string, unknown>).threadId as string).length < 1 ||
    ((raw as Record<string, unknown>).threadId as string).length > 64 ||
    ((raw as Record<string, unknown>).cardId as string).length < 1 ||
    ((raw as Record<string, unknown>).cardId as string).length > 64
  ) {
    return { error: "Invalid approval request." };
  }
  const { threadId, cardId } = raw as { threadId: string; cardId: string };

  // Tenant scope: identity from requireOwner only, never from input
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
  const { ownerId } = gate;

  try {
    // Load thread owner-scoped (cross-tenant rejected)
    const thread = await prisma.chatThread.findFirst({
      where: { id: threadId, ownerId, deletedAt: null },
      select: { id: true, projectId: true, ottoState: true },
    });
    if (!thread) return { error: "Conversation not found." };
    if (!thread.ottoState) return { error: "Nothing to approve." };
    const priorOttoState = thread.ottoState;

    // Rehydrate the paused RunState. On an unrestorable state (schema bump / corruption, F24)
    // we can't resume the interruption this approval refers to — surface a clean error instead
    // of throwing (which would 500 every approve on a stale thread).
    const state = await tryRestoreRunState(otto, priorOttoState);
    if (!state) return { error: "This conversation's approval state couldn't be restored — please ask Otto to propose it again." };

    // Find the matching generate interruption (cardId binding)
    const interruptions = state.getInterruptions();
    const matchingInterruption = interruptions.find((item) => {
      // item.name uses the getter (toolName ?? rawItem.name)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const it = item as any;
      const toolName: string | undefined = it.name;
      if (toolName !== "generate") return false;
      try {
        const args = JSON.parse(it.arguments ?? "{}") as { cardId?: string };
        return args.cardId === cardId;
      } catch {
        return false;
      }
    });

    // Universal branch (B4 debt-70, spec §五 5.1·附②): when the id isn't a parked generate card,
    // it may be an APPROVAL_CARD message id (a non-generate gated skill, e.g. approveScheduledPost).
    // The card payload carries the (toolName, ref) binding; ref anchors idempotency (the B0-29
    // ApprovalRequest payload-hash anchor upgrades this binding when that row lands).
    let approvalCard: { id: string; payload: ApprovalCardPayload } | null = null;

    if (!matchingInterruption) {
      const cardMsg = await prisma.chatMessage.findFirst({
        where: { id: cardId, threadId, ownerId, kind: "APPROVAL_CARD", deletedAt: null },
        select: { id: true, payload: true },
      });
      const cardPayload = cardMsg ? asApprovalCardPayload(cardMsg.payload) : null;
      if (cardMsg && cardPayload) {
        // Double-approve idempotency (M2 spirit): a consumed card refuses benignly — no re-approve,
        // no second execution.
        if (cardPayload.status !== "pending") {
          return { ok: true, alreadyResolved: true, resolution: cardPayload.status };
        }
        // (toolName, ref) binding against the rehydrated state's parked interruptions.
        const targetItem = interruptions.find((item) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const it = item as any;
          const toolName: string | undefined = it.name ?? it.rawItem?.name;
          if (!toolName || toolName === "generate" || toolName !== cardPayload.toolName) return false;
          try {
            const args = JSON.parse(it.arguments ?? it.rawItem?.arguments ?? "{}") as Record<string, unknown>;
            return approvalRefOf(toolName, args) === cardPayload.ref;
          } catch {
            return false;
          }
        });
        if (!targetItem) {
          // Parked ask gone (superseded/consumed). Truth first: if the post IS approved, stamp the
          // card and answer benignly instead of failing the user for a stale ask.
          if (cardPayload.toolName === "approveScheduledPost") {
            const post = await prisma.scheduledPost.findFirst({
              where: { id: cardPayload.ref, ownerId, deletedAt: null },
              select: { approvedAt: true },
            });
            if (post?.approvedAt) {
              await setApprovalCardStatus(cardMsg.id, ownerId, cardPayload, "approved");
              return { ok: true, alreadyResolved: true, resolution: "approved" };
            }
          }
          return { error: "That card isn't awaiting approval." };
        }
        // Approve — mutates the rehydrated state; resume executes the tool → the SAME owner-scoped
        // server action the human button uses (via ctx.schedule.approve).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state.approve(targetItem as any);
        approvalCard = { id: cardMsg.id, payload: cardPayload };
      } else {
        // No matching pending interruption — check if already generated (double-approve path)
        const existingJob = await prisma.genJob.findFirst({
          where: { ownerId, idempotencyKey: `cowork:${cardId}` },
          select: { id: true, status: true },
        });
        if (existingJob) {
          // Already approved/generating — return benignly, no second spend
          return { ok: true, genJobId: existingJob.id, status: existingJob.status };
        }
        return { error: "That card isn't awaiting approval." };
      }
    } else {
      // Approve — mutates the rehydrated state in place; resume will execute the tool
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state.approve(matchingInterruption as any);
    }

    // Build context — injects the real startGen port (spend path)
    const ctx = await buildOttoContext({
      ownerId,
      projectId: thread.projectId,
      threadId,
      sourceGenerationId: null,
    });

    // Resume the run, metered (LLM cost of this resume turn)
    const refId = `otto-approve:${threadId}:${cardId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let agentResult: any;

    try {
      agentResult = await withLlmBudget(
        {
          orgId: ownerId,
          refId,
          model: OTTO_DEFAULT_MODEL,
          paid: true,
          maxSteps: OTTO_MAX_STEPS,
          usageOnError: (e) => (e instanceof MaxTurnsExceededError && (e as { state?: { usage?: unknown } }).state?.usage)
            ? mapOttoUsage((e as { state: { usage: Parameters<typeof mapOttoUsage>[0] } }).state.usage)
            : null,
        },
        async () => {
          // Resuming with the approved state — generate.execute runs → ctx.startGen → spend
          const r = await run(otto, state, { context: ctx, maxTurns: OTTO_MAX_STEPS });
          return { result: r, usage: mapOttoUsage(r.state.usage) };
        },
      );
    } catch (e) {
      if (e instanceof MaxTurnsExceededError) {
        const degradeText = "I got a bit tangled up — try asking again.";
        // Persist the degrade message so the user actually sees it (parity with ottoTurn),
        // plus the partial RunState if the SDK attached one.
        const seq = await prisma.chatMessage.findFirst({
          where: { threadId, ownerId },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
        await prisma.chatMessage.create({
          data: {
            id: newId(),
            threadId,
            ownerId,
            role: "AGENT",
            kind: "TEXT",
            seq: (seq?.seq ?? 0) + 1,
            text: degradeText,
          },
        });
        const errState = (e as { state?: { toString(): string } }).state;
        if (errState) {
          await prisma.chatThread.update({
            where: { id: threadId },
            data: { ottoState: errState.toString(), updatedAt: new Date() },
          });
        }
        revalidatePath("/", "layout");
        return { ok: true, status: "degraded" };
      }
      throw e;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = agentResult as any;

    // Shared extractText (@fikirtive/otto run-output.ts) — this was a local copy until 7-14b.
    const newOttoState = result.state.toString() as string;

    // Universal card: the consent was granted and the resumed run executed the gated tool (its own
    // result is relayed in Otto's reply) — stamp the card so a second approve refuses benignly.
    if (approvalCard) {
      await setApprovalCardStatus(approvalCard.id, ownerId, approvalCard.payload, "approved");
    }

    // Handle another interruption (chained approval needed)
    if (Array.isArray(result.interruptions) && result.interruptions.length > 0) {
      // Same closed-set collection as finalizeOttoRun: generate ids ride pendingCardIds; other
      // gated tools get durable APPROVAL_CARDs persisted after the CAS below.
      const chainedApprovals = collectApprovalInterruptions(result.interruptions as unknown[]);
      const pendingCardIds: string[] = chainedApprovals.filter((a) => a.toolName === "generate").map((a) => a.ref);
      const chainedNonGenerate = chainedApprovals.filter((a) => a.toolName !== "generate");

      // CAS: only write paused ottoState if no concurrent turn moved it
      const { count: casInterrupt } = await prisma.chatThread.updateMany({
        where: { id: threadId, ownerId, ottoState: priorOttoState },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });
      if (casInterrupt === 0) { revalidatePath("/", "layout"); return { ok: true, status: "stale" }; }

      // CAS won — persist any assistant text produced before the interruption
      const assistantText = extractText(result);
      if (assistantText) {
        const seq = await prisma.chatMessage.findFirst({
          where: { threadId, ownerId },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
        await prisma.chatMessage.create({
          data: {
            id: newId(),
            threadId,
            ownerId,
            role: "AGENT",
            kind: "TEXT",
            seq: (seq?.seq ?? 0) + 1,
            text: assistantText,
          },
        });
      }

      // Durable approval cards for chained non-generate gated asks (B4 debt-70 5.1·附①).
      if (chainedNonGenerate.length > 0) {
        const seqRow = await prisma.chatMessage.findFirst({
          where: { threadId, ownerId },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
        const persisted = await persistPendingApprovalCards({
          ownerId,
          threadId,
          approvals: chainedNonGenerate,
          seqStart: seqRow?.seq ?? 0,
        });
        pendingCardIds.push(...persisted.cardIds);
      }

      revalidatePath("/", "layout");
      return { ok: true, status: "needs_approval", pendingCardIds };
    }

    // Completed — persist Otto's reply + updated ottoState (CAS guard)
    const replyText = extractText(result);

    // Look up the GenJob created by the resumed generate (best-effort, for UI)
    const genJob = await prisma.genJob.findFirst({
      where: { ownerId, idempotencyKey: `cowork:${cardId}` },
      select: { id: true, status: true },
    });

    const seq = await prisma.chatMessage.findFirst({
      where: { threadId, ownerId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });

    const { count: casCompleted } = await prisma.chatThread.updateMany({
      where: { id: threadId, ownerId, ottoState: priorOttoState },
      data: { ottoState: newOttoState, updatedAt: new Date() },
    });
    if (casCompleted === 0) { revalidatePath("/", "layout"); return { ok: true, status: "stale" }; }
    await prisma.chatMessage.create({
      data: {
        id: newId(),
        threadId,
        ownerId,
        role: "AGENT",
        kind: "TEXT",
        seq: (seq?.seq ?? 0) + 1,
        text: replyText,
      },
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      status: "done",
      reply: replyText,
      ...(genJob ? { genJobId: genJob.id } : {}),
    };
  } catch (e) {
    console.error("[ottoApprove] failed:", errSummary(e));
    return { error: "Couldn't approve — please try again." };
  }
}

// ---------------------------------------------------------------------------
// ottoReject — decline a parked non-generate approval (universal card chain, B4 debt-70)
// ---------------------------------------------------------------------------

/**
 * Reject path (spec §五 5.1·附 test ③): the user declines the approval card. The parked tool is
 * REJECTED on the rehydrated state — the SDK sends the rejection text to the model instead of
 * executing the tool, so ZERO schedule writes happen — the run resumes metered so Otto closes out
 * cleanly, and the card is stamped rejected (a later approve/reject of the same card refuses
 * benignly). generate cards are NOT handled here: their decline UX stays the existing plan-card flow.
 */
export async function ottoReject(raw: unknown): Promise<
  | { ok: true; status: "done" | "degraded" | "stale" | "needs_approval" }
  | { ok: true; alreadyResolved: true; resolution: "approved" | "rejected" }
  | { error: string }
> {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).threadId !== "string" ||
    typeof (raw as Record<string, unknown>).cardId !== "string" ||
    ((raw as Record<string, unknown>).threadId as string).length < 1 ||
    ((raw as Record<string, unknown>).threadId as string).length > 64 ||
    ((raw as Record<string, unknown>).cardId as string).length < 1 ||
    ((raw as Record<string, unknown>).cardId as string).length > 64
  ) {
    return { error: "Invalid request." };
  }
  const { threadId, cardId } = raw as { threadId: string; cardId: string };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to do this." };
  const { ownerId } = gate;

  try {
    const thread = await prisma.chatThread.findFirst({
      where: { id: threadId, ownerId, deletedAt: null },
      select: { id: true, projectId: true, ottoState: true },
    });
    if (!thread) return { error: "Conversation not found." };
    if (!thread.ottoState) return { error: "Nothing to decline." };
    const priorOttoState = thread.ottoState;

    const cardMsg = await prisma.chatMessage.findFirst({
      where: { id: cardId, threadId, ownerId, kind: "APPROVAL_CARD", deletedAt: null },
      select: { id: true, payload: true },
    });
    const cardPayload = cardMsg ? asApprovalCardPayload(cardMsg.payload) : null;
    if (!cardMsg || !cardPayload) return { error: "That card isn't awaiting approval." };
    if (cardPayload.status !== "pending") {
      return { ok: true, alreadyResolved: true, resolution: cardPayload.status };
    }

    const state = await tryRestoreRunState(otto, priorOttoState);
    if (!state) return { error: "This conversation's approval state couldn't be restored — please ask Otto again." };

    const targetItem = state.getInterruptions().find((item) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const it = item as any;
      const toolName: string | undefined = it.name ?? it.rawItem?.name;
      if (!toolName || toolName === "generate" || toolName !== cardPayload.toolName) return false;
      try {
        const args = JSON.parse(it.arguments ?? it.rawItem?.arguments ?? "{}") as Record<string, unknown>;
        return approvalRefOf(toolName, args) === cardPayload.ref;
      } catch {
        return false;
      }
    });

    if (!targetItem) {
      // The parked ask no longer exists. Truth first: if the post got approved elsewhere, record
      // that; otherwise the stale ask is safely declinable (nothing can execute — stamp and close).
      if (cardPayload.toolName === "approveScheduledPost") {
        const post = await prisma.scheduledPost.findFirst({
          where: { id: cardPayload.ref, ownerId, deletedAt: null },
          select: { approvedAt: true },
        });
        if (post?.approvedAt) {
          await setApprovalCardStatus(cardMsg.id, ownerId, cardPayload, "approved");
          return { ok: true, alreadyResolved: true, resolution: "approved" };
        }
      }
      await setApprovalCardStatus(cardMsg.id, ownerId, cardPayload, "rejected");
      revalidatePath("/", "layout");
      return { ok: true, alreadyResolved: true, resolution: "rejected" };
    }

    // Reject — the SDK records a rejection for this tool call; the tool NEVER executes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state.reject(targetItem as any, { message: "The user declined this request." });

    const ctx = await buildOttoContext({
      ownerId,
      projectId: thread.projectId,
      threadId,
      sourceGenerationId: null,
    });

    // Resume the run, metered (LLM cost of the close-out turn — same withLlmBudget as approve).
    const refId = `otto-reject:${threadId}:${cardId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let agentResult: any;
    try {
      agentResult = await withLlmBudget(
        {
          orgId: ownerId,
          refId,
          model: OTTO_DEFAULT_MODEL,
          paid: true,
          maxSteps: OTTO_MAX_STEPS,
          usageOnError: (e) => (e instanceof MaxTurnsExceededError && (e as { state?: { usage?: unknown } }).state?.usage)
            ? mapOttoUsage((e as { state: { usage: Parameters<typeof mapOttoUsage>[0] } }).state.usage)
            : null,
        },
        async () => {
          const r = await run(otto, state, { context: ctx, maxTurns: OTTO_MAX_STEPS });
          return { result: r, usage: mapOttoUsage(r.state.usage) };
        },
      );
    } catch (e) {
      if (e instanceof MaxTurnsExceededError) {
        // The decline itself is done (the parked tool can no longer execute) — stamp the card
        // even on degrade, then persist the degrade message like ottoApprove does.
        await setApprovalCardStatus(cardMsg.id, ownerId, cardPayload, "rejected");
        const degradeText = "I got a bit tangled up — try asking again.";
        const seq = await prisma.chatMessage.findFirst({
          where: { threadId, ownerId },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
        await prisma.chatMessage.create({
          data: {
            id: newId(),
            threadId,
            ownerId,
            role: "AGENT",
            kind: "TEXT",
            seq: (seq?.seq ?? 0) + 1,
            text: degradeText,
          },
        });
        const errState = (e as { state?: { toString(): string } }).state;
        if (errState) {
          await prisma.chatThread.update({
            where: { id: threadId },
            data: { ottoState: errState.toString(), updatedAt: new Date() },
          });
        }
        revalidatePath("/", "layout");
        return { ok: true, status: "degraded" };
      }
      throw e;
    }

    // The parked tool was rejected — zero writes happened; stamp the card.
    await setApprovalCardStatus(cardMsg.id, ownerId, cardPayload, "rejected");

    // Persist the resumed run through the shared finalizer (CAS + seq semantics identical to
    // ottoTurn; also persists cards for any chained approvals the close-out turn parked).
    const seqRow = await prisma.chatMessage.findFirst({
      where: { threadId, ownerId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const finalized = await finalizeOttoRun({
      ownerId,
      threadId,
      isNew: false,
      priorOttoState,
      result: agentResult,
      seqAfterUser: seqRow?.seq ?? 0,
    });
    revalidatePath("/", "layout");
    if (finalized.status === "stale") return { ok: true, status: "stale" };
    if (finalized.status === "needs_approval") return { ok: true, status: "needs_approval" };
    return { ok: true, status: "done" };
  } catch (e) {
    console.error("[ottoReject] failed:", errSummary(e));
    return { error: "Couldn't decline that — please try again." };
  }
}

// ---------------------------------------------------------------------------
// createEmptyCoworkThread — create an empty thread shell (NO first turn, NO spend)
// so the streaming front door can stream the first message into a thread that
// already exists (the stream route's existing-thread branch then handles it:
// priorOttoState null, seq 0). Owner-scoped + project-validated, mirroring ottoTurn.
// (Task 6: founder-flagged streaming front door.)
// ---------------------------------------------------------------------------
export async function createEmptyCoworkThread(raw: unknown): Promise<{ id: string } | { error: string }> {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).projectId !== "string" ||
    typeof (raw as Record<string, unknown>).title !== "string"
  ) {
    return { error: "Invalid request." };
  }
  const { projectId, title } = raw as { projectId: string; title: string };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  try {
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
    if (!project) return { error: "Project not found." };

    const id = newId();
    await prisma.chatThread.create({
      data: { id, ownerId, projectId, title: title.slice(0, 80) || "New campaign" },
    });
    return { id };
  } catch (e) {
    console.error("[createEmptyCoworkThread] failed:", errSummary(e));
    return { error: "Couldn't start a new conversation — please try again." };
  }
}

// ---------------------------------------------------------------------------
// deleteCoworkThread — permanently delete a conversation record (owner-scoped)
// ---------------------------------------------------------------------------

export async function deleteCoworkThread(threadId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  try {
    const thread = await prisma.chatThread.findFirst({
      where: { id: threadId, ownerId, deletedAt: null },
      select: { id: true },
    });
    if (!thread) return { error: "Conversation not found." };
    await prisma.$transaction(async (tx) => {
      const threadLockKey = `thread:${threadId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${threadLockKey}, 0::bigint))`;
      const liveThread = await tx.chatThread.findFirst({
        where: { id: threadId, ownerId, deletedAt: null },
        select: { id: true },
      });
      if (!liveThread) throw new Error("THREAD_NOT_FOUND_DURING_DELETE");
      const activeResearch = await tx.researchJob.findFirst({
        where: { ownerId, threadId, status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true },
      });
      if (activeResearch) throw new Error("RESEARCH_RUNNING_DURING_DELETE");
      await tx.researchJob.deleteMany({ where: { ownerId, threadId } });
      await tx.canvasNode.updateMany({ where: { ownerId, threadId }, data: { threadId: null } });
      await tx.generation.updateMany({ where: { ownerId, threadId }, data: { threadId: null } });
      await tx.genJob.updateMany({ where: { ownerId, threadId }, data: { threadId: null } });
      await tx.chatMessage.deleteMany({ where: { ownerId, threadId } });
      await tx.chatThread.deleteMany({ where: { id: threadId, ownerId } });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && e.message === "THREAD_NOT_FOUND_DURING_DELETE") return { error: "Conversation not found." };
    if (e instanceof Error && e.message === "RESEARCH_RUNNING_DURING_DELETE") return { error: "Research is still running in this conversation. Delete it after research finishes." };
    console.error("[deleteCoworkThread] failed:", errSummary(e));
    return { error: "Couldn't delete the conversation — please try again." };
  }
}

// ---------------------------------------------------------------------------
// setCoworkThreadPinned — pin/unpin a conversation in the sidebar
// ---------------------------------------------------------------------------

export async function setCoworkThreadPinned(threadId: string, pinned: boolean): Promise<{ ok: true; pinnedAt: string | null } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  try {
    const thread = await prisma.chatThread.findFirst({
      where: { id: threadId, ownerId, deletedAt: null },
      select: { id: true },
    });
    if (!thread) return { error: "Conversation not found." };
    const pinnedAt = pinned ? new Date() : null;
    const { count } = await prisma.chatThread.updateMany({
      where: { id: thread.id, ownerId },
      data: { pinnedAt },
    });
    if (!count) return { error: "Conversation not found." };
    return { ok: true, pinnedAt: pinnedAt ? pinnedAt.toISOString() : null };
  } catch (e) {
    console.error("[setCoworkThreadPinned] failed:", errSummary(e));
    return { error: "Couldn't update the conversation — please try again." };
  }
}
