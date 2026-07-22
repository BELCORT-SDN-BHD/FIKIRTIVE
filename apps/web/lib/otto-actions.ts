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
  GOAL_PRESETS,
  isGoalKey,
  tavilySearch,
  braveSearch,
  searchWithFallback,
  extractProductDraft,
  type SegmentRuleGroup,
} from "@fikirtive/core";
import {
  otto,
  ottoInteractiveRuntime,
  ottoApprovalResumeRuntime,
  runOttoTurn,
  finalizeOttoTurn,
  withLlmBudget,
  run,
  MaxTurnsExceededError,
  ottoSimpleModeBlock,
  buildUserTurn,
  sanitizeHistory,
  tryRestoreRunState,
  approvalRefOf,
} from "@fikirtive/otto";
import type { OttoContext, AgentInputItem, ApprovalInterruption } from "@fikirtive/otto";
import { requireOwner } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { resolveDisabledModels } from "./model-registry";
import { startCoworkGen } from "./gen-actions";
import { runVariantBatch, runBulkGrid } from "./factory-actions";
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
  suggestPostTimes,
  sharePostPreview,
  revokeSharePreview,
} from "./schedule-actions";
import { asApprovalCardPayload, type ApprovalCardPayload, type ApprovalCardSummary } from "./approval-card-view";
import { computeApprovalContentHash, refgenApprovalHashFromArgs, factoryBatchApprovalHashFromArgs, APPROVAL_CARD_TTL_MS } from "./approval-content-hash";
import { readPageCached } from "./web-page-cache";
import { fetchOwnerInsights } from "./meta-insights";
import { fetchOwnerAdPerformance } from "./meta-performance";
import { fetchOwnerAdObjects } from "./meta-objects";
import { fetchOwnerPages } from "./meta-pages";
import { proposeMetaActionForOwner } from "./meta-propose";
import { proposeAdBuildForOwner } from "./meta-build-propose";
import { validateOwnedGenerationExt } from "./otto-generation-validate";
import { makeOttoCanvasPort } from "./otto-canvas-port";
import { makeOttoMediaPort, makeOttoRenderPort, makeOttoMediaImportPort } from "./otto-media-port";
import { makeOttoProjectsPort } from "./otto-projects-port";
import { makeOttoRefgenPort } from "./otto-refgen-port";
import { makeOttoEntitiesPort } from "./otto-entities-port";
import { makeOttoLibraryPort } from "./otto-library-port";
import { makeOttoBrandMemoryPort } from "./otto-brand-memory-port";
import { makeOttoWorkflowsPort } from "./otto-workflows-port";
import {
  buildSegment as buildCrmSegment,
  getSegment as getCrmSegment,
  listSegments as listCrmSegments,
  previewSegment as previewCrmSegment,
} from "./segment-actions";
import {
  approveCampaignEntry,
  proposeCampaign,
  proposeCampaignEntry,
  removeCampaignEntry,
  setCampaignGrouping,
  updateCampaignEntry,
} from "./campaign-actions";
import { getCampaign, listCampaigns } from "./campaign-view-data";
import { listTrendSnapshots, saveTrendSnapshot } from "./trend-actions";
import {
  createContact,
  importContacts,
  setContactConsent,
  setContactDndFromOtto,
  updateContact,
} from "./crm-actions";
import { getContact, listContacts, searchContacts, type CrmContactRow } from "./crm-view-data";

// mapOttoUsage re-exported from @fikirtive/otto so existing callers that import
// it from this module continue to work (the canonical source is @fikirtive/otto).
export { mapOttoUsage } from "@fikirtive/otto";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
const VIDEO_EXTS = ["mp4", "mov", "webm"];

function makeOttoSegmentsPort() {
  const context = {
    list: async () => {
      const result = await listCrmSegments();
      if (!("ok" in result)) return result;
      return { ok: true as const, evaluatedAt: result.evaluatedAt, segments: result.segments };
    },
    get: async (segmentId: string) => {
      const result = await getCrmSegment(segmentId);
      if (!("ok" in result)) return result;
      return { ok: true as const, evaluatedAt: result.evaluatedAt, segment: result.segment };
    },
    preview: async (rules: SegmentRuleGroup) => {
      const result = await previewCrmSegment(rules);
      if (!("ok" in result)) return result;
      return {
        ok: true as const,
        evaluatedAt: result.evaluatedAt,
        phrase: result.phrase,
        matchedCount: result.matchedCount,
        contactableCount: result.contactableCount,
        knownOptOutCount: result.knownOptOutCount,
        contacts: result.contacts,
      };
    },
    build: async ({ operation, segmentId, name, rules }: {
      operation: "create" | "update";
      segmentId?: string;
      name: string;
      rules: SegmentRuleGroup;
    }) => {
      if (operation === "update") {
        if (!segmentId) return { error: "Update needs the exact segment id." };
        return buildCrmSegment({ operation, segmentId, name, rules });
      }

      // The model never mints a Segment id. Reuse the action layer's owner-bound signed draft,
      // then enter the exact same validated create/replay path as the human page.
      const draft = await listCrmSegments();
      if (!("ok" in draft)) return draft;
      return buildCrmSegment({
        operation,
        segmentId: draft.nextSegmentId,
        segmentProof: draft.nextSegmentProof,
        name,
        rules,
      });
    },
  };
  return context;
}

function makeOttoCampaignsPort(): NonNullable<OttoContext["campaigns"]> {
  return {
    list: async () => {
      const result = await listCampaigns();
      if (!("ok" in result)) return result;
      return { ok: true as const, campaigns: result.campaigns };
    },
    get: async (campaignId) => {
      const result = await getCampaign(campaignId);
      if (!("ok" in result)) return result;
      return { ok: true as const, campaign: result.campaign };
    },
    listTrends: async (input) => {
      const result = await listTrendSnapshots(input);
      if (!("ok" in result)) return result;
      return { ok: true as const, snapshots: result.snapshots };
    },
    create: async (input) => {
      // The model never mints a Campaign id. The authenticated list action issues an owner-bound
      // signed draft, then creation enters the same retry-safe action as the human workbench.
      const draft = await listCampaigns();
      if (!("ok" in draft)) return draft;
      return proposeCampaign({
        campaignId: draft.nextCampaignId,
        campaignProof: draft.nextCampaignProof,
        title: input.name,
        goal: input.goal,
        status: input.status,
        period: input.period,
        theme: input.theme ?? input.name,
        items: [],
        ideas: [],
      });
    },
    proposeEntry: async ({ campaignId, entry }) => {
      // Entry ids are also server-issued and owner-bound. A lost response can replay the same id.
      const draft = await getCampaign(campaignId);
      if (!("ok" in draft)) return draft;
      return proposeCampaignEntry({
        campaignId,
        entryId: draft.nextEntryId,
        entryProof: draft.nextEntryProof,
        entry,
      });
    },
    updateEntry: (input) => updateCampaignEntry(input),
    removeEntry: (input) => removeCampaignEntry(input),
    approveEntry: (input) => approveCampaignEntry(input),
    group: (input) => setCampaignGrouping(input),
    saveTrend: async ({ campaignId, evidence }) => {
      const draft = await listTrendSnapshots();
      if (!("ok" in draft)) return draft;
      return saveTrendSnapshot({
        snapshotId: draft.nextSnapshotId,
        snapshotProof: draft.nextSnapshotProof,
        campaignId,
        evidence,
      });
    },
  };
}

function contactForOtto(contact: CrmContactRow) {
  return {
    ...contact,
    firstTouchAt: contact.firstTouchAt.toISOString(),
    lastSeenAt: contact.lastSeenAt.toISOString(),
    createdAt: contact.createdAt.toISOString(),
    consentState: {
      ...contact.consentState,
      lastReceivedAt: contact.consentState.lastReceivedAt?.toISOString() ?? null,
    },
  };
}

function makeOttoContactsPort(): NonNullable<OttoContext["contacts"]> {
  return {
    list: async (input) => {
      const result = await listContacts(input);
      if (!("ok" in result)) return result;
      return { ok: true as const, contacts: result.contacts.map(contactForOtto) };
    },
    get: async (contactId) => {
      const result = await getContact(contactId);
      if (!("ok" in result)) return result;
      return {
        ok: true as const,
        contact: {
          ...contactForOtto(result.contact),
          consentEvents: result.contact.consentEvents.map((event) => ({
            ...event,
            occurredAt: event.occurredAt?.toISOString() ?? null,
            receivedAt: event.receivedAt.toISOString(),
          })),
        },
      };
    },
    search: async (input) => {
      const result = await searchContacts(input);
      if (!("ok" in result)) return result;
      return { ok: true as const, contacts: result.contacts.map(contactForOtto) };
    },
    create: (input) => createContact({ ...input, source: "otto" }),
    update: (input) => updateContact(input),
    importCsv: (input) => importContacts(input),
    recordConsent: (input) => setContactConsent(input),
    setDnd: (input) => setContactDndFromOtto(input),
  };
}

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
  approvalConsent,
  factoryAttemptId,
}: {
  ownerId: string;
  projectId: string;
  threadId: string;
  sourceGenerationId?: string | null;
  sourceGenerationIds?: string[] | null;
  referenceVideoGenerationId?: string | null;
  referenceVideoGenerationIds?: string[] | null;
  simpleMode?: boolean;
  /** AR2 处方1: set ONLY by ottoApprove's universal branch — the hash-time updatedAt snapshot. */
  approvalConsent?: { scheduledPostId: string; expectedUpdatedAt: string };
  /** Server-only factory attempt token: the hash-verified, CAS-consumed APPROVAL_CARD.id. */
  factoryAttemptId?: string;
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
  const context: OttoContext & {
    segments: ReturnType<typeof makeOttoSegmentsPort>;
    campaigns: ReturnType<typeof makeOttoCampaignsPort>;
    contacts: ReturnType<typeof makeOttoContactsPort>;
  } = {
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
    startGen: startCoworkGen,
    // W-B3-F-P: factory batch port — routes to the SAME owner-scoped server actions. The model
    // never receives an attemptId; only ottoApprove can inject the verified + consumed card id.
    runFactoryBatch: {
      variant: (input) => factoryAttemptId
        ? runVariantBatch({ ...input, attemptId: factoryAttemptId })
        : Promise.resolve({ error: "That batch approval attempt is missing — ask Otto to propose it again." }),
      bulk: (input) => factoryAttemptId
        ? runBulkGrid({ ...input, attemptId: factoryAttemptId })
        : Promise.resolve({ error: "That batch approval attempt is missing — ask Otto to propose it again." }),
    },
    brandContext,
    availableRefs,
    simpleMode: simpleMode ?? false,
    activeJob,
    // C7: exact authenticated read/draft capability. Revision publish changes only the definition
    // pointer; activation, authorization, run, dispatch, send, provider, and spend methods are absent.
    workflows: makeOttoWorkflowsPort(),
    // B0-61/C3: list/get/preview/build all enter the authenticated Segment action layer.
    // The port never accepts ownerId and never compiles free-form language into rules.
    segments: makeOttoSegmentsPort(),
    // B0-51..58/C2a: zero-cost Campaign planning only. Reads/writes re-enter the authenticated
    // action layer; no UTM, generation, credits, schedule approval, send, publish, or provider port.
    campaigns: makeOttoCampaignsPort(),
    // B0-59/60/C1: owner-scoped Contact reads/writes re-enter the same authenticated actions.
    // Identity stays read-only; consent and DND mutations route through the closed runtime writers.
    contacts: makeOttoContactsPort(),
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
    approvalConsent,
    schedule: {
      draft: (input) => draftScheduledPost({ ownerId, projectId, source: "otto", input }),
      // AR2 处方1: the CAS inside approveScheduledPost pins the THREADED hash-time snapshot,
      // not its own fresh read — a material edit after hash-check hard-fails the approve.
      approve: ({ scheduledPostId, expectedUpdatedAt }) => approveScheduledPost(scheduledPostId, { expectedUpdatedAt }),
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
      // B0-103 read parity: reads the static global seed table (no owner scope), $0, never writes.
      suggestTimes: ({ channel, limit }) => suggestPostTimes({ channel, limit }),
      // B0-28: mints a seat-less read-only share link for one OWNED post (owner-verified server-side;
      // TTL server-fixed; one authority row per mint). Revoke kills every active link for a post.
      sharePreview: ({ scheduledPostId }) => sharePostPreview({ scheduledPostId }),
      sharePreviewRevoke: ({ scheduledPostId }) => revokeSharePreview({ scheduledPostId }),
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
    // Canvas port (W-B3-A, $0) — single action layer (宪法 7 / Seam 9): Otto's manageCanvas
    // skill drives the SAME owner-gated $0 server actions the human canvas UI uses
    // (canvas-actions + the display-only chat→canvas bridge), with Otto-side pre-validation
    // (generationId must be real + in-project; edit/remove are project-bound) — see
    // makeOttoCanvasPort. None of these touch startGen / reserveCredits / the provider.
    canvas: makeOttoCanvasPort(ownerId, projectId),
    // Media ports (W-B3-B, $0) — single action layer: Otto's manageMedia / renderVideo /
    // importMedia skills drive the SAME owner-gated $0 server actions the human media UI uses
    // (getEditorMedia/loadMoreMedia/attach/detach/delete/discard/cancelGenJob; startRender/
    // getRenderJobs/startCaption/getCaptionJob/getTranscript; finalizeCandidateUploads via a
    // server-side SSRF-guarded fetch), each pre-bound to this owner+project. None touch startGen.
    media: makeOttoMediaPort(ownerId, projectId),
    render: makeOttoRenderPort(ownerId, projectId),
    mediaImport: makeOttoMediaImportPort(ownerId, projectId),
    // Projects / entities / library / brand-memory ports (W-B3-D, $0) — single action layer
    // (宪法 7 / Seam 9): Otto's manage* skills drive the SAME owner-gated server actions the human
    // UI uses (actions.ts / library-actions / asset-actions / brand-record-actions / memory-actions).
    // Each action re-derives the owner from the verified session (requireOwner) and is fail-closed on
    // a missing/cross-owner id; none touch startGen / reserveCredits / the provider.
    projects: makeOttoProjectsPort(ownerId),
    entities: makeOttoEntitiesPort(),
    library: makeOttoLibraryPort(),
    brandMemory: makeOttoBrandMemoryPort(),
    // Reference-generation port (W-B3-G-P, debt-68/69). generate forwards to the SOLE refgen spend
    // authority (startRefGen — own requireOwner + refGenRequest gate + server-priced reserve); the
    // generateReferences skill is cost:"spend" ⇒ needsApproval literal true. deleteVariant is $0 with
    // an Otto-only fail-closed active-job gate (refuses while a paid job runs). None duplicate spend.
    refgen: makeOttoRefgenPort(ownerId),
  };
  return context;
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

/** R1 + AR1 处方2: enrich the card with WHAT is being consented to (owner-scoped read of the
 *  MATERIAL fields) and hash-bind it. Returns null when the post can't be read — the resulting
 *  hashless card is unapprovable (fail-closed). */
async function readApprovalConsent(
  ownerId: string,
  toolName: string,
  ref: string,
  args?: Record<string, unknown>,
): Promise<{ summary: ApprovalCardSummary | null; contentHash: string; updatedAt: string } | null> {
  // generateReferences (debt-68, spend): the consent object is the EXACT parked tool-call args, not a
  // mutable DB row — nothing to re-read for drift, no TOCTOU snapshot to thread. Bind the args with a
  // content hash (anti-flip: a same-entity prompt/count/mode swap ⇒ a different hash ⇒ hard refuse at
  // approve). No entity read is needed to be approvable — startRefGen owner-gates the entity at execute
  // time; the generic approval-card view renders this card (named action, no rich summary).
  if (toolName === "generateReferences") {
    const contentHash = refgenApprovalHashFromArgs(args);
    if (!contentHash) return null; // no bindable consent ⇒ fail-closed (hashless, unapprovable card)
    return {
      summary: null,
      contentHash,
      updatedAt: "", // no mutable row ⇒ no TOCTOU snapshot (only approveScheduledPost threads one)
    };
  }
  // runFactoryBatch (W-B3-F-P, spend): same consent shape as generateReferences — the consent object
  // is the EXACT parked tool-call args (mode/batchId/name/base/variants/cells; immutable in the
  // RunState, no mutable row, no TOCTOU snapshot). ANY post-mint flip of the batch content ⇒ a
  // different hash ⇒ hard refuse at approve. The generic approval-card view renders this card.
  if (toolName === "runFactoryBatch") {
    const contentHash = factoryBatchApprovalHashFromArgs(args);
    if (!contentHash) return null; // no bindable consent ⇒ fail-closed (hashless, unapprovable card)
    return {
      summary: null,
      contentHash,
      updatedAt: "", // no mutable row ⇒ no TOCTOU snapshot (only approveScheduledPost threads one)
    };
  }
  if (toolName !== "approveScheduledPost") return null;
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: ref, ownerId, deletedAt: null },
      select: {
        channel: true, caption: true, scheduledAt: true, scheduledTz: true,
        firstComment: true, metaTargetId: true, updatedAt: true,
        media: { select: { generationId: true }, orderBy: { position: "asc" } },
      },
    });
    if (!post) return null;
    const scheduledAtIso = post.scheduledAt.toISOString();
    return {
      summary: {
        channel: post.channel,
        caption: post.caption,
        scheduledAt: scheduledAtIso,
        scheduledTz: post.scheduledTz,
        mediaCount: post.media.length,
      },
      contentHash: computeApprovalContentHash({
        channel: post.channel,
        scheduledAt: scheduledAtIso,
        caption: post.caption,
        firstComment: post.firstComment ?? null,
        metaTargetId: post.metaTargetId ?? null,
        mediaGenerationIds: post.media.map((m) => m.generationId),
      }),
      // The TOCTOU-weld snapshot (AR2 处方1): captured in the SAME read the hash is computed from.
      updatedAt: post.updatedAt.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Persist one APPROVAL_CARD per parked non-generate approval. Deduped per (toolName, ref,
 * status=pending): a rehydrated run can re-park the SAME pending tool call (the user sent another
 * message while an approval waited), and that must not mint a second card for one consent.
 * generateReferences additionally pins contentHash in the dedup (P2 ref collision): its ref
 * (entityId) is NOT unique across two same-entity parks with different prompts — without the hash,
 * the second distinct ask would silently reuse the first ask's card and become unapprovable. The
 * re-park-same-call dedup still holds (same args ⇒ same hash ⇒ same card).
 * runFactoryBatch pins the hash for the same reason: its ref (batchId) can repeat across two parks
 * with different cells (the orchestration layer only fails-closed on changed content at execute).
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
    // P2 ref collision: refgen's consent object is the parked args themselves, so the pending-card
    // identity must include their hash (null for unbindable args — those dedupe by ref alone and
    // mint a hashless, unapprovable card).
    const consentHash =
      a.toolName === "generateReferences" ? refgenApprovalHashFromArgs(a.args)
      : a.toolName === "runFactoryBatch" ? factoryBatchApprovalHashFromArgs(a.args)
      : null;
    const existing = await prisma.chatMessage.findFirst({
      where: {
        threadId: args.threadId,
        ownerId: args.ownerId,
        kind: "APPROVAL_CARD",
        AND: [
          { payload: { path: ["toolName"], equals: a.toolName } },
          { payload: { path: ["ref"], equals: a.ref } },
          { payload: { path: ["status"], equals: "pending" } },
          ...(consentHash !== null ? [{ payload: { path: ["contentHash"], equals: consentHash } }] : []),
        ],
      },
      select: { id: true },
    });
    if (existing) {
      cardIds.push(existing.id);
      continue;
    }
    const consent = await readApprovalConsent(args.ownerId, a.toolName, a.ref, a.args);
    const payload: ApprovalCardPayload = {
      toolName: a.toolName,
      ref: a.ref,
      status: "pending",
      summary: consent?.summary ?? null,
      // Fail-closed: a card without a hash can never be approved (post unreadable at mint).
      contentHash: consent?.contentHash ?? null,
      expiresAt: new Date(Date.now() + APPROVAL_CARD_TTL_MS).toISOString(),
    };
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

/** ATOMIC card consumption (AR1 处方2): a conditional pending→terminal update — the WHERE pins
 *  payload.status="pending", so of two concurrent resolvers exactly ONE wins (count 1) and the
 *  loser sees count 0 (double-click / replay = idempotent refusal). The card is the consumable. */
async function consumeApprovalCard(
  cardId: string,
  ownerId: string,
  payload: ApprovalCardPayload,
  status: "approved" | "rejected" | "expired",
): Promise<boolean> {
  try {
    const { count } = await prisma.chatMessage.updateMany({
      where: {
        id: cardId,
        ownerId,
        kind: "APPROVAL_CARD",
        AND: [{ payload: { path: ["status"], equals: "pending" } }],
      },
      data: { payload: { ...payload, status } as unknown as Prisma.InputJsonObject },
    });
    return count > 0;
  } catch (err) {
    console.warn(`[approval-card] consume failed (cardId=${cardId}).`, err);
    return false;
  }
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
  const finalization = finalizeOttoTurn(result, ottoInteractiveRuntime);
  const newOttoState = finalization.newOttoState;
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
  if (finalization.interrupted) {
    // Closed set from the registry (collectApprovalInterruptions): generate keeps its existing
    // contract — pendingCardIds carries its pre-persisted GEN_CARD ids. Other gated tools
    // (approveScheduledPost) get a durable APPROVAL_CARD persisted below (B4 debt-70 5.1·附①).
    const approvals = finalization.approvals;
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
    const assistantText = finalization.text;
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
  const replyText = finalization.text;

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
      agentResult = await runOttoTurn(
        { orgId: ownerId, refId, input: runInput },
        ctx,
        ottoInteractiveRuntime,
        { meter: withLlmBudget, runAgent: run, maxTurnsExceededError: MaxTurnsExceededError },
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
  | { ok: true; alreadyResolved: true; resolution: "approved" | "rejected" | "expired" } // consumed/expired card: idempotent refusal
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
    const state = await tryRestoreRunState(ottoApprovalResumeRuntime.agent, priorOttoState);
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
    // The card payload carries the (toolName, ref) binding, the content hash binds the consent
    // object, and CAS consumption makes the card single-use (AR1 处方2).
    // AR2 处方1: the hash-time updatedAt snapshot rides the resume context so the server action
    // CAS-pins exactly the content the hash verified (TOCTOU weld).
    let approvalConsent: { scheduledPostId: string; expectedUpdatedAt: string } | undefined;
    let factoryAttemptId: string | undefined;

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
        // TTL (AR1 处方2): an expired ASK is no longer confirmable — consume to "expired" and say so.
        if (!cardPayload.expiresAt || Date.now() > new Date(cardPayload.expiresAt).getTime()) {
          await consumeApprovalCard(cardMsg.id, ownerId, cardPayload, "expired");
          return { ok: true, alreadyResolved: true, resolution: "expired" };
        }
        // (toolName, ref) binding FIRST — locate the parked interruption this card refers to. We need
        // its exact args to bind the consent for tools whose consent object IS the parked call
        // (generateReferences), and it lets a stale/already-approved card short-circuit before any read.
        // P2 ref collision: for generateReferences the ref (entityId) is NOT unique — two same-entity
        // parks with different prompts share it — so the match is additionally pinned to the card's
        // content hash: each card matches exactly ITS OWN parked call, never a sibling's.
        const targetItem = interruptions.find((item) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const it = item as any;
          const toolName: string | undefined = it.name ?? it.rawItem?.name;
          if (!toolName || toolName === "generate" || toolName !== cardPayload.toolName) return false;
          try {
            const args = JSON.parse(it.arguments ?? it.rawItem?.arguments ?? "{}") as Record<string, unknown>;
            if (approvalRefOf(toolName, args) !== cardPayload.ref) return false;
            if (toolName === "generateReferences") {
              return refgenApprovalHashFromArgs(args) === cardPayload.contentHash;
            }
            // Same P2 discipline for runFactoryBatch: the ref (batchId) may repeat across two parks
            // with different content — each card matches exactly ITS OWN parked call via the hash.
            if (toolName === "runFactoryBatch") {
              return factoryBatchApprovalHashFromArgs(args) === cardPayload.contentHash;
            }
            return true;
          } catch {
            return false;
          }
        });
        if (!targetItem) {
          // Parked ask gone (superseded/consumed). Truth first: if the post IS approved, consume the
          // card and answer benignly instead of failing the user for a stale ask.
          if (cardPayload.toolName === "approveScheduledPost") {
            const post = await prisma.scheduledPost.findFirst({
              where: { id: cardPayload.ref, ownerId, deletedAt: null },
              select: { approvedAt: true },
            });
            if (post?.approvedAt) {
              // NODE-279① regression fix: hash BEFORE consume on this short-circuit too — the
              // pre-reorder code verified the content hash before ANY resolution path could run.
              // approvedAt=true must not launder a drifted card: if the post's material fields
              // changed since mint (or the card is hashless), hard-refuse WITHOUT consuming,
              // exactly like the main path below.
              const current = await readApprovalConsent(ownerId, cardPayload.toolName, cardPayload.ref);
              if (!cardPayload.contentHash || !current || current.contentHash !== cardPayload.contentHash) {
                return { error: "This post changed since Otto asked — review it and ask Otto to request approval again." };
              }
              await consumeApprovalCard(cardMsg.id, ownerId, cardPayload, "approved");
              return { ok: true, alreadyResolved: true, resolution: "approved" };
            }
          }
          return { error: "That card isn't awaiting approval." };
        }
        // The matched interruption's exact args — the consent object for tools that bind the parked
        // call itself (generateReferences hashes these; approveScheduledPost ignores them and re-reads
        // its DB row instead).
        const targetArgs: Record<string, unknown> = (() => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const it = targetItem as any;
            return JSON.parse(it.arguments ?? it.rawItem?.arguments ?? "{}") as Record<string, unknown>;
          } catch {
            return {};
          }
        })();
        // Content-hash binding (AR1 处方2, spec 5.1·附②): recompute the consent hash — for
        // approveScheduledPost by re-reading the post's material fields (drift check), for
        // generateReferences from the matched interruption's args (anti-flip). ANY drift/mismatch (or
        // an unreadable/hashless card) = hard refuse WITHOUT consuming — the user asks Otto afresh.
        const current = await readApprovalConsent(ownerId, cardPayload.toolName, cardPayload.ref, targetArgs);
        if (!cardPayload.contentHash || !current || current.contentHash !== cardPayload.contentHash) {
          return {
            error:
              cardPayload.toolName === "generateReferences"
                ? "That reference request changed since Otto asked — ask Otto to request it again."
                : cardPayload.toolName === "runFactoryBatch"
                  ? "That batch request changed since Otto asked — ask Otto to request it again."
                  : "This post changed since Otto asked — review it and ask Otto to request approval again.",
          };
        }
        // AR2 处方1 (approveScheduledPost only): snapshot updatedAt from the SAME read the hash was
        // verified against, so the resumed approve threads it to the server action's CAS (TOCTOU weld).
        // generateReferences has no mutable row ⇒ no snapshot to thread (approvalConsent stays undefined).
        if (cardPayload.toolName === "approveScheduledPost") {
          approvalConsent = { scheduledPostId: cardPayload.ref, expectedUpdatedAt: current.updatedAt };
        }
        // ATOMIC consumption BEFORE the resume (AR1 处方2): exactly one resolver wins; a concurrent
        // double-click loses the CAS and refuses benignly — the resume (and the tool) runs at most
        // once per card. A consumed-but-failed resume is fail-closed: consent is spent, nothing
        // published; the user asks Otto for a fresh request (never auto-retry a consent).
        const consumed = await consumeApprovalCard(cardMsg.id, ownerId, cardPayload, "approved");
        if (!consumed) {
          const fresh = await prisma.chatMessage.findFirst({
            where: { id: cardId, threadId, ownerId, kind: "APPROVAL_CARD", deletedAt: null },
            select: { payload: true },
          });
          const freshPayload = fresh ? asApprovalCardPayload(fresh.payload) : null;
          const resolution = freshPayload && freshPayload.status !== "pending" ? freshPayload.status : "approved";
          return { ok: true, alreadyResolved: true, resolution };
        }
        if (cardPayload.toolName === "runFactoryBatch") factoryAttemptId = cardMsg.id;
        // Approve — mutates the rehydrated state; resume executes the tool → the SAME owner-scoped
        // server action the human button uses (via ctx.schedule.approve).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state.approve(targetItem as any);
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

    // Build context — injects the real startGen port (spend path) and, for a universal card,
    // the hash-time consent snapshot (AR2 处方1) the approve skill threads to the server action.
    const ctx = await buildOttoContext({
      ownerId,
      projectId: thread.projectId,
      threadId,
      sourceGenerationId: null,
      approvalConsent,
      factoryAttemptId,
    });

    // Resume the run, metered (LLM cost of this resume turn)
    const refId = `otto-approve:${threadId}:${cardId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let agentResult: any;

    try {
      agentResult = await runOttoTurn(
        { orgId: ownerId, refId, input: state },
        ctx,
        ottoApprovalResumeRuntime,
        { meter: withLlmBudget, runAgent: run, maxTurnsExceededError: MaxTurnsExceededError },
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
    const finalization = finalizeOttoTurn(result, ottoApprovalResumeRuntime);
    const newOttoState = finalization.newOttoState;

    // (Universal card already consumed pending→approved BEFORE the resume — AR1 处方2 CAS.)

    // Handle another interruption (chained approval needed)
    if (finalization.interrupted) {
      // Same closed-set collection as finalizeOttoRun: generate ids ride pendingCardIds; other
      // gated tools get durable APPROVAL_CARDs persisted after the CAS below.
      const chainedApprovals = finalization.approvals;
      const pendingCardIds: string[] = chainedApprovals.filter((a) => a.toolName === "generate").map((a) => a.ref);
      const chainedNonGenerate = chainedApprovals.filter((a) => a.toolName !== "generate");

      // CAS: only write paused ottoState if no concurrent turn moved it
      const { count: casInterrupt } = await prisma.chatThread.updateMany({
        where: { id: threadId, ownerId, ottoState: priorOttoState },
        data: { ottoState: newOttoState, updatedAt: new Date() },
      });
      if (casInterrupt === 0) { revalidatePath("/", "layout"); return { ok: true, status: "stale" }; }

      // CAS won — persist any assistant text produced before the interruption
      const assistantText = finalization.text;
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
    const replyText = finalization.text;

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

/** Deterministic decline confirmation — inserted verbatim, NO LLM involved (AR1 处方1). */
const DECLINE_CONFIRMATION_TEXT =
  "Declined — nothing was published. The post stays unapproved in your schedule.";

/**
 * Reject path (spec §五 5.1·附 test ③; AR1 处方1 structural guarantee): declining is a STATIC
 * confirmation — no LLM resume happens at all, so the gated tool structurally cannot execute:
 * ZERO EXTERNAL writes, zero LLM cost. The INTERNAL writes are exactly (honest accounting, AR2
 * 处方2): ① the card's terminal state (CAS pending→rejected — the park is terminated at the
 * consumable, so ottoApprove can never approve it), ② best-effort RunState hygiene (deterministic
 * SDK state mutation, no run) so a later turn rehydrates a rejected tool call instead of a
 * dangling park, ③ the deterministic "declined" conversation message, ④ the
 * ActionEvent(approval.declined) audit row.
 * generate cards are NOT handled here: their decline UX stays the existing plan-card flow.
 */
export async function ottoReject(raw: unknown): Promise<
  | { ok: true; status: "done"; reply: string }
  | { ok: true; alreadyResolved: true; resolution: "approved" | "rejected" | "expired" }
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

    const cardMsg = await prisma.chatMessage.findFirst({
      where: { id: cardId, threadId, ownerId, kind: "APPROVAL_CARD", deletedAt: null },
      select: { id: true, payload: true },
    });
    const cardPayload = cardMsg ? asApprovalCardPayload(cardMsg.payload) : null;
    if (!cardMsg || !cardPayload) return { error: "That card isn't awaiting approval." };
    if (cardPayload.status !== "pending") {
      return { ok: true, alreadyResolved: true, resolution: cardPayload.status };
    }

    // TTL: an expired ask resolves to "expired", not "rejected" (honest terminal state).
    if (!cardPayload.expiresAt || Date.now() > new Date(cardPayload.expiresAt).getTime()) {
      await consumeApprovalCard(cardMsg.id, ownerId, cardPayload, "expired");
      return { ok: true, alreadyResolved: true, resolution: "expired" };
    }

    // Truth first: if the post got approved elsewhere, record that instead of a false "rejected".
    if (cardPayload.toolName === "approveScheduledPost") {
      const post = await prisma.scheduledPost.findFirst({
        where: { id: cardPayload.ref, ownerId, deletedAt: null },
        select: { approvedAt: true },
      });
      if (post?.approvedAt) {
        await consumeApprovalCard(cardMsg.id, ownerId, cardPayload, "approved");
        return { ok: true, alreadyResolved: true, resolution: "approved" };
      }
    }

    // ATOMIC consumption (CAS pending→rejected) — the park terminates HERE: a consumed card can
    // never be approved (ottoApprove requires pending), regardless of what the run state holds.
    const consumed = await consumeApprovalCard(cardMsg.id, ownerId, cardPayload, "rejected");
    if (!consumed) {
      const fresh = await prisma.chatMessage.findFirst({
        where: { id: cardId, threadId, ownerId, kind: "APPROVAL_CARD", deletedAt: null },
        select: { payload: true },
      });
      const freshPayload = fresh ? asApprovalCardPayload(fresh.payload) : null;
      const resolution = freshPayload && freshPayload.status !== "pending" ? freshPayload.status : "rejected";
      return { ok: true, alreadyResolved: true, resolution };
    }

    // Best-effort state hygiene (deterministic, NO run/LLM): mark the parked tool call rejected on
    // the persisted RunState so the next turn rehydrates a rejected call, not a dangling park. A
    // stale CAS (concurrent turn moved the state) is fine — the consumed card already dead-ends it.
    if (thread.ottoState) {
      try {
        const state = await tryRestoreRunState(otto, thread.ottoState);
        if (state) {
          const targetItem = state.getInterruptions().find((item) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const it = item as any;
            const toolName: string | undefined = it.name ?? it.rawItem?.name;
            if (!toolName || toolName === "generate" || toolName !== cardPayload.toolName) return false;
            try {
              const args = JSON.parse(it.arguments ?? it.rawItem?.arguments ?? "{}") as Record<string, unknown>;
              if (approvalRefOf(toolName, args) !== cardPayload.ref) return false;
              // P2 ref collision (same as ottoApprove's matcher): a refgen card must reject exactly
              // ITS OWN parked call, never a same-entity sibling's still-pending ask.
              if (toolName === "generateReferences") {
                return refgenApprovalHashFromArgs(args) === cardPayload.contentHash;
              }
              // Same discipline for runFactoryBatch (ref=batchId may repeat across parks).
              if (toolName === "runFactoryBatch") {
                return factoryBatchApprovalHashFromArgs(args) === cardPayload.contentHash;
              }
              return true;
            } catch {
              return false;
            }
          });
          if (targetItem) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            state.reject(targetItem as any, { message: "The user declined this request." });
            await prisma.chatThread.updateMany({
              where: { id: threadId, ownerId, ottoState: thread.ottoState },
              data: { ottoState: state.toString() as string, updatedAt: new Date() },
            });
          }
        }
      } catch (err) {
        console.warn(`[ottoReject] state hygiene skipped (threadId=${threadId}).`, err);
      }
    }

    // Deterministic confirmation message (no LLM) + audit trail.
    const seqRow = await prisma.chatMessage.findFirst({
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
        seq: (seqRow?.seq ?? 0) + 1,
        text: DECLINE_CONFIRMATION_TEXT,
      },
    });
    await prisma.actionEvent
      .create({
        data: {
          id: newId(),
          ownerId,
          projectId: thread.projectId,
          type: "approval.declined",
          payload: { cardId, toolName: cardPayload.toolName, ref: cardPayload.ref },
        },
      })
      .catch(() => {});

    revalidatePath("/", "layout");
    return { ok: true, status: "done", reply: DECLINE_CONFIRMATION_TEXT };
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
