import type { GenRequestInput, ProductDraft, ScheduleDraftInput } from "@fikirtive/core";

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
  /** Verified user id (audit). */
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
    list(): Promise<{ objects: MetaAdObject[] } | { needsReconnect: true } | { notConnected: true }>;
  };
  /** Meta pages port (G7 v2) — injected by the web caller; lists the owner's connected Facebook Pages.
   *  Skills reach it ONLY via ctx.metaPages, never importing meta-pages.ts. */
  metaPages?: {
    list(): Promise<
      | { pages: { id: string; name: string }[] }
      | { needsReconnect: true }
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
  };
  /** Product-ingest port (P1-01) — injected by the web caller. Fetches a URL (SSRF-hardened)
   *  and runs the deterministic Layer-1 extractor, returning a product DRAFT plus the page text.
   *  Otto fills any gaps itself from `text` (no separate LLM call) — that is this path's Layer 2.
   *  Skills reach it ONLY via ctx.productIngest — never importing fetch-extract/product-extract
   *  or calling fetch() directly (CI fence rule). Absent in the minimal worker verdict ctx; the
   *  skill degrades gracefully when it is not injected. */
  productIngest?: {
    fromUrl(url: string): Promise<{ draft: ProductDraft; text: string } | { error: string }>;
  };
}
