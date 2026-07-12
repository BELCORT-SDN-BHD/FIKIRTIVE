import type { GenRequestInput, ProductDraft, ScheduleChannel, ScheduleDraftInput } from "@fikirtive/core";

/** Patch for the editScheduledPost skill (debt-72). Structural re-declaration mirroring the web
 *  UpdateScheduledPostPatch — the web type (apps/web/lib/schedule-actions.ts) must NOT be imported
 *  here (same rule as MetaAdObject). `channel` reuses the CORE ScheduleChannel (already imported). */
export type ScheduleUpdatePatch = {
  channel?: ScheduleChannel;
  caption?: string;
  scheduledAt?: string;
  scheduledTz?: string;
  media?: string[];
  firstComment?: string | null;
  metaTargetId?: string | null;
};

/** Slim, serializable view of a scheduled post Otto reads (debt-73). No Date/web types cross the
 *  package boundary — the web port maps its rows to this shape (ISO strings, media count). */
export type ScheduledPostSummary = {
  id: string;
  channel: string;
  caption: string;
  status: string;
  scheduledAt: string; // ISO instant
  scheduledTz: string;
  approvedAt: string | null; // ISO instant, null until approved
  mediaCount: number;
  lastError: string | null;
};

/** A connectable publish target for the composer's account picker (debt-74). */
export type ScheduleTarget = { id: string; name: string; channel: string };

/** Minimal structural re-declaration of MetaAdObject for the otto package.
 *  The web type (apps/web/lib/meta-objects.ts) must NOT be imported here. */
export type MetaAdObject = {
  id: string;
  level: "campaign" | "adset" | "ad";
  name: string;
  status: string;
  dailyBudgetMinor?: number;
  lifetimeBudgetMinor?: number;
  startTime?: string;
  endTime?: string;
  currency: string;
  accountId: string;
};

/** Per-run context the caller (web route / worker) supplies to `run(otto, input, { context })`.
 *  It is re-derived FRESH every run from the verified session — it is NOT persisted in RunState,
 *  so identity/config can never go stale. Tools read identity/scope from HERE, never from model args. */
export interface OttoContext {
  /** = ownerId under org-as-tenant. Ledger key + ownership scope. From the verified session, NEVER the model. */
  orgId: string;
  /** Owner/tenant scope for this run — set to ownerId (= orgId) at every construction site, because
   *  that is the only identity in scope: the web caller has the session's ownerId and the worker
   *  resume path (otto-resume.ts) has only job.ownerId (no session, no per-user token). This is NOT
   *  a distinct verified per-user id — do not use it to attribute an action to an individual member.
   *  Threading a real actor would need the actor persisted on the job; deferred (no consumer today). */
  userId: string;
  /** The active, owned project. */
  projectId: string;
  /** The existing chat thread Otto is operating in. */
  threadId: string;
  /** Admin-disabled model ids the caller resolved via resolveDisabledModels() (passed as an array; the tool builds a Set). */
  disabledModels: string[];
  /** "Animate this result": a server-validated i2v source frame, if the turn carries one. */
  sourceGenerationId?: string | null;
  /** All server-validated canvas image references attached to this turn. The first one
   *  remains `sourceGenerationId` for generation-card compatibility. */
  sourceGenerationIds?: string[];
  /** Whole-clip reference video for THIS turn (整段视频参考). Server-validated video-ext.
   *  Threaded to the gen ONLY for a video plan; ignored for image plans. */
  referenceVideoGenerationId?: string | null;
  /** All server-validated whole-clip reference videos attached to this turn. The first
   *  one remains `referenceVideoGenerationId` for the current single-primary spend path. */
  referenceVideoGenerationIds?: string[];
  /** Reference images shown to Otto THIS turn (the dropped reference → vision). Bounded +
   *  best-effort (gathered by the web caller). Appended as input_image parts to the CURRENT
   *  user turn only; never persisted into RunState history (stripHistoryImages drops them). */
  images?: { label: string; dataUrl: string }[];
  /** App-level spend entrypoint, injected by the web caller (Task 1.8). The generate tool calls this;
   *  $0 tools never touch it. It is `startGen` from apps/web (unchanged) — which does its own
   *  requireOwner() + genRequest validation + reserve + GenJob insert + enqueue. */
  startGen?: (req: GenRequestInput) => Promise<{ id: string } | { error: string }>;
  /** Compiled brand memory text for THIS run (injected as a system message at run assembly). */
  brandContext?: string;
  /** The owner's reusable entities the agent may @-reference (name + type only; ids for tools). */
  availableRefs?: { id: string; name: string; type: string }[];
  /** When true, buildContextSystemMessage injects the Simple-mode plain-language block so
   *  Otto speaks to a beginner without jargon. NOT baked into the shared identity — injected
   *  only on the simple door path (via buildContextSystemMessage). */
  simpleMode?: boolean;
  /** The latest generation's status for THIS thread (best-effort), so Otto speaks truthfully
   *  about progress instead of guessing. Null/undefined = unknown. */
  activeJob?: { status: string; kind: string; error?: string | null } | null;
  /** Meta ad objects port (G7) — injected by the web caller; lists the owner's connected ad objects
   *  (campaigns, ad sets, ads). Skills reach it ONLY via ctx.metaAds, never importing meta-objects.ts. */
  metaAds?: {
    list(): Promise<{ objects: MetaAdObject[] } | { needsReconnect: true } | { transientError: true } | { notConnected: true }>;
  };
  /** Meta pages port (G7 v2) — injected by the web caller; lists the owner's connected Facebook Pages.
   *  Skills reach it ONLY via ctx.metaPages, never importing meta-pages.ts. */
  metaPages?: {
    list(): Promise<
      | { pages: { id: string; name: string }[] }
      | { needsReconnect: true }
      | { transientError: true }
      | { notConnected: true }
      | { needsPageScope: true }
    >;
  };
  /** Meta analytics port (G6b) — injected by the web caller; reads the owner's connected ad-account
   *  performance. Skills reach it ONLY via ctx.metaInsights, never importing meta-insights.ts. */
  metaInsights?: {
    get(datePreset: string): Promise<
      | { accounts: { accountId: string; name: string; metrics: Record<string, string | null> }[] }
      | { needsReconnect: true }
      | { transientError: true }
      | { notConnected: true }
    >;
  };
  /** Meta per-ad performance port (P1a) — injected by the web caller; reads the owner's
   *  connected ad-level performance + creative. Skills reach it ONLY via ctx.metaPerformance,
   *  never importing meta-performance.ts. Single action layer: this port and the P1b human
   *  panel's getAdPerformance action both resolve to fetchOwnerAdPerformance. */
  metaPerformance?: {
    getAds(datePreset: string): Promise<
      | {
          ads: {
            adId: string;
            adName: string | null;
            accountId: string;
            metrics: Record<string, string | null>;
            creative: { imageUrl: string | null; body: string | null; title: string | null; videoId: string | null } | null;
          }[];
          truncated: boolean;
          organic: { status: "pending_permission" } | { posts: [] };
          datePreset: string;
          fetchedAt: string;
        }
      | { needsReconnect: true }
      | { transientError: true }
      | { notConnected: true }
    >;
  };
  /** Web-research port — injected by the web/worker caller (G3a). Skills use this to fetch
   *  pages or (when wired) search the web. Never imported directly inside skills/. */
  research?: {
    /** Fetch a public URL, extract its text, and return title + cleaned body. */
    fetchUrl(url: string): Promise<{ url: string; title?: string; text: string }>;
    /** Full-text web search. Optional — not wired until a search-API key is configured.
     *  Returns THIN results ({title,url,snippet}); Otto reads full pages on demand via readPage. */
    search?: (query: string) => Promise<{ results: { url: string; title: string; snippet: string }[] }>;
    /** Read ONE page of a public URL's clean text, backed by a shared cache (Nous-style paging).
     *  Optional — a context without it falls back to fetchUrl. `page` is 1-based; the result carries
     *  totalPages so Otto knows there is more to read. */
    readPage?(
      url: string,
      page?: number,
    ): Promise<{ url: string; title?: string; page: number; totalPages: number; text: string; stale: boolean }>;
  };
  /** Meta propose port (G7) — injected by the web caller; builds + persists an ACTION_CARD
   *  chat message from a structured plan. Skills reach it ONLY via ctx.metaPropose,
   *  never importing meta-propose.ts or prisma directly (CI fence rule).
   *  Input/result shape re-declared here — NO web import. */
  metaPropose?: (input: {
    planTitle: string;
    steps: Array<{
      op: "pause" | "resume" | "set_budget" | "reschedule";
      targetId: string;
      intent: { dailyBudgetMinor?: number; startTime?: string; endTime?: string };
    }>;
  }) => Promise<
    | { cardId: string; autoEligible: boolean }
    | { notConnected: true }
    | { needsReconnect: true }
    | { transientError: true }
    | { unknownTargets: string[] }
    | { invalidSteps: Array<{ targetId: string; reason: string }> }
  >;
  /** Meta build port (G7 v2) — injected by the web caller; builds + persists a BUILD_CARD
   *  ChatMessage from the LLM-proposed ad build strategy. Skills reach it ONLY via ctx.metaBuild,
   *  never importing meta-build-propose.ts or prisma directly (CI fence rule).
   *  Input/result shape re-declared structurally here — NO web import. */
  metaBuild?: {
    propose(input: {
      goal: string;
      reasoning: string;
      mode: "create" | "into_existing";
      objective: string;
      pageId: string;
      targetingHint?: {
        countries?: string[];
        cities?: string[];
        ageMin?: number;
        ageMax?: number;
        interests?: string[];
      };
      dailyBudgetMinor: number;
      startTime?: string;
      creative: {
        assetId: string;
        kind: "image" | "video";
        message: string;
        headline?: string;
        cta: string;
        link: string;
      };
      intoExisting?: { adsetId: string };
    }): Promise<
      | { cardId: string; autoBuilt: boolean }
      | { notConnected: true }
      | { needsReconnect: true }
      | { transientError: true }
      | { needsPageScope: true }
      | { invalid: Array<{ field: string; reason: string }> }
    >;
  };
  /** Brand brain port (G3b) — injected by the web caller; returns the compiled brand context
   *  text for the current owner. Skills reach it ONLY via ctx.brandBrain — never importing
   *  memory-actions.ts directly (CI fence rule). */
  brandBrain?: {
    context(): Promise<string>;
  };
  /** Schedule-draft port (#123) — injected by the web caller. Drafts ONE IG/FB post through the
   *  SAME shared authority the human action uses (draftScheduledPost: shared core validation +
   *  owner-scoped media check + create). Skills reach it ONLY via ctx.schedule — never importing
   *  prisma/schedule-service directly (single-action-layer rule). Absent in the minimal worker
   *  verdict ctx; the skill degrades gracefully when it is not injected. Never publishes/approves/spends. */
  schedule?: {
    draft(input: ScheduleDraftInput): Promise<{ ok: true; id: string } | { error: string }>;
    /** debt-70 (gated). Approve one owned DRAFT → SCHEDULED (consent to publish). Reached only on
     *  approval-card resume; the port is the SAME owner-scoped approveScheduledPost server action.
     *  `expectedUpdatedAt` (ISO) = the post's updatedAt captured server-side at the moment the
     *  card's content hash was verified (AR2 处方1 TOCTOU weld) — the action pins its CAS on THIS
     *  value, so any material edit between hash-check and the resume's re-read fails the CAS. */
    approve(input: { scheduledPostId: string; expectedUpdatedAt: string }): Promise<{ ok: true } | { error: string }>;
    /** debt-71. Cancel one owned post through the shared state machine (owner-scoped). */
    cancel(input: { scheduledPostId: string }): Promise<{ ok: true } | { error: string }>;
    /** debt-72. Patch one owned DRAFT/queued post; a MATERIAL edit to a SCHEDULED post revokes
     *  consent (drops to DRAFT, clears approvedAt) — invariant inherited from the shared action. */
    update(input: { scheduledPostId: string; patch: ScheduleUpdatePatch }): Promise<{ ok: true } | { error: string }>;
    /** debt-73 (read parity). Owner-scoped list of the schedule, optional [from,to] window. */
    list(input: { from?: string; to?: string }): Promise<ScheduledPostSummary[]>;
    /** debt-74 (read parity). Owner-scoped connectable publish targets (empty when unconnected). */
    listTargets(): Promise<ScheduleTarget[]>;
  };
  /** Approval-consent snapshot (AR2 处方1, B4 debt-70) — injected ONLY by ottoApprove when
   *  resuming a universal approval card, NEVER derived from model args. Carries the post's
   *  updatedAt as read at hash-verification time; the approveScheduledPost skill threads it to
   *  ctx.schedule.approve so the server action CAS-pins the exact content the human consented to.
   *  Absent on every other path — the skill fails closed without it. */
  approvalConsent?: { scheduledPostId: string; expectedUpdatedAt: string };

  /** Product-ingest port (P1-01) — injected by the web caller. Fetches a URL (SSRF-hardened)
   *  and runs the deterministic Layer-1 extractor, returning a product DRAFT plus the page text.
   *  Otto fills any gaps itself from `text` (no separate LLM call) — that is this path's Layer 2.
   *  Skills reach it ONLY via ctx.productIngest — never importing fetch-extract/product-extract
   *  or calling fetch() directly (CI fence rule). Absent in the minimal worker verdict ctx; the
   *  skill degrades gracefully when it is not injected. */
  productIngest?: {
    fromUrl(url: string): Promise<{ draft: ProductDraft; text: string } | { error: string }>;
  };
  /** Canvas port (W-B3-A, $0) — injected by the web caller. Every function is a thin closure over
   *  the SAME owner-gated $0 server actions the human canvas UI uses (canvas-actions +
   *  otto-canvas-bridge) — single action layer (宪法 7 / Seam 9). None of these touch startGen /
   *  reserveCredits / the provider: placing a node only references media that was ALREADY
   *  generated and charged. Skills reach it ONLY via ctx.canvas — never importing web actions or
   *  Prisma (CI fence rule). Absent in the minimal worker verdict ctx; the skill degrades
   *  gracefully when it is not injected. */
  canvas?: {
    /** $0 read: this project's canvas nodes (listCanvasNodes). */
    list(): Promise<CanvasNodeView[] | { error: string }>;
    /** $0 display-only sync: materialize chat GEN_RESULTs as nodes, then return all nodes
     *  (syncOttoCanvasNodes — idempotent, never spends). */
    sync(): Promise<CanvasNodeView[] | { error: string }>;
    /** $0 write: place a text note or an ALREADY-generated image/video (createCanvasNode). */
    place(input: {
      type: "image" | "video" | "text";
      x: number;
      y: number;
      w: number;
      h: number;
      text?: string;
      prompt?: string;
      generationId?: string;
      sourceNodeId?: string;
    }): Promise<{ id: string } | { error: string }>;
    /** $0 write: edit a text node's content (updateTextNode). */
    editText(id: string, text: string): Promise<{ ok: true } | { error: string }>;
    /** $0 write: stamp a node's terminal display state (resolveCanvasNode). */
    resolve(
      id: string,
      input: { status: "done" | "failed" | "timeout" | "missing"; generationId?: string },
    ): Promise<{ ok: true } | { error: string }>;
    /** $0 write: delete a node (deleteCanvasNode). Never refunds/cancels the underlying job. */
    remove(id: string): Promise<{ ok: true } | { error: string }>;
  };
  /** Projects port (W-B3-D, $0, debt-03~07) — injected by the web caller. Every function is a thin
   *  closure over the SAME owner-gated project server actions the human sidebar uses (actions.ts:
   *  getOrCreateDefaultProject / createProject / renameProject / setProjectPinned / deleteProject) —
   *  single action layer (宪法 7 / Seam 9). Owner scope + fail-closed not-found guards live INSIDE
   *  those actions (requireOwner). None touch startGen / reserveCredits / the provider. Skills reach
   *  it ONLY via ctx.projects — never importing web actions or Prisma (CI fence rule). Absent in the
   *  minimal worker verdict ctx; the skill degrades gracefully when it is not injected. */
  projects?: {
    /** debt-03: the owner's default campaign id (idempotent bootstrap read — creates "My Videos" if none). */
    getDefault(): Promise<{ id: string } | { error: string }>;
    /** debt-04: create a new named campaign. */
    create(name: string): Promise<{ id: string } | { error: string }>;
    /** debt-06: rename an owned campaign (display metadata only). */
    rename(projectId: string, name: string): Promise<{ ok: true; name: string } | { error: string }>;
    /** debt-07: pin/unpin an owned campaign in the sidebar. */
    setPinned(projectId: string, pinned: boolean): Promise<{ ok: true; pinnedAt: string | null } | { error: string }>;
    /** debt-05: PERMANENTLY delete an owned campaign and its project-scoped work (guarded: refuses while
     *  a generation is running, refunds queued jobs). Irreversible — not a soft delete. */
    remove(projectId: string): Promise<{ ok: true } | { error: string }>;
  };
  /** Entities port (W-B3-D, $0, debt-08~10) — injected by the web caller. Thin closures over the SAME
   *  owner-gated element server actions the human elements UI uses (actions.ts: createEntity /
   *  softDeleteEntity / softDeleteReferenceImage). createEntity here makes a NAMED element WITHOUT
   *  reference photos — uploading photos stays a human file-picker action. Skills reach it ONLY via
   *  ctx.entities. Absent in the minimal worker verdict ctx. */
  entities?: {
    /** debt-08: create a named reusable element (character/location/product/brandmark), no photo upload. */
    create(input: { name: string; type: EntityType }): Promise<{ id: string } | { error: string }>;
    /** debt-10: soft-delete an element (tombstone; history/snapshots stay intact). */
    remove(entityId: string): Promise<{ ok: true } | { error: string }>;
    /** debt-09: remove one reference photo from an element (soft — asset row becomes a tombstone). */
    removeReferenceImage(refImageId: string): Promise<{ ok: true } | { error: string }>;
  };
  /** Library port (W-B3-D, $0, debt-29/30/50) — injected by the web caller. Thin closures over the SAME
   *  owner-gated read/preference actions the human Library uses (library-actions.getGenerationHistory,
   *  asset-actions.getGeneration / setFavorite). history/detail are reads; setFavorite is a $0 preference
   *  write. Skills reach it ONLY via ctx.library. Absent in the minimal worker verdict ctx. */
  library?: {
    /** debt-50: one keyset page of the owner's full generation history (newest first). */
    history(input: { search?: string; favoriteOnly?: boolean; cursor?: string | null }): Promise<LibraryHistoryView | { error: string }>;
    /** debt-29: one owned generation's detail. */
    detail(generationId: string): Promise<LibraryItemView | { error: string }>;
    /** debt-30: star/unstar one owned generation (Library preference; $0). */
    setFavorite(generationId: string, favorite: boolean): Promise<{ favorite: boolean } | { error: string }>;
  };
  /** Brand-memory lifecycle port (W-B3-D, $0, debt-31/32/51) — injected by the web caller. Thin closures
   *  over the SAME owner-gated actions the human Brand memory UI uses (brand-record-actions.deleteBrandRecord
   *  / restoreBrandRecord, memory-actions.deleteMemory). All are SOFT deletes (deletedAt); records also have
   *  an undo (restore). Skills reach it ONLY via ctx.brandMemory. Absent in the minimal worker verdict ctx. */
  brandMemory?: {
    /** debt-31: soft-delete one product/segment/offer record from the living collections. */
    deleteRecord(id: string): Promise<{ ok: true } | { error: string }>;
    /** debt-32: undo an OTTO-removed record (restore the soft-deleted row). */
    restoreRecord(id: string): Promise<{ ok: true } | { error: string }>;
    /** debt-51: soft-delete one brand fact/memory. */
    deleteFact(id: string): Promise<{ ok: true } | { error: string }>;
  };
}

/** A canvas node as skills see it — structural re-declaration; the web DTO
 *  (apps/web/lib/canvas-actions.ts) must NOT be imported here. */
export type CanvasNodeView = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string | null;
  prompt: string | null;
  generationId: string | null;
  status: string;
  sourceNodeId: string | null;
  url?: string | null;
};

/** Entity kinds a skill may create (mirror of actions.ts ENTITY_TYPES / core RefEntityType). */
export type EntityType = "CHARACTER" | "LOCATION" | "PRODUCT" | "BRANDMARK";

/** A library generation as skills see it — structural re-declaration; the web DTOs
 *  (library-actions.LibraryItem / asset-actions.GenerationDTO) must NOT be imported here. */
export type LibraryItemView = {
  id: string;
  projectId: string;
  kind: string; // "image" | "video"
  prompt: string;
  favorite: boolean;
  createdAt?: string; // ISO instant (history rows carry it; a single detail read may not)
};

/** One keyset page of generation history as skills see it (mirror of library-actions.LibraryPage). */
export type LibraryHistoryView = {
  items: LibraryItemView[];
  nextCursor: string | null;
  hasMore: boolean;
};
