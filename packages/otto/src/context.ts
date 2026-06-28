import type { GenRequestInput } from "@fikirtive/core";

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
  /** Web-research port — injected by the web/worker caller (G3a). Skills use this to fetch
   *  pages or (when wired) search the web. Never imported directly inside skills/. */
  research?: {
    /** Fetch a public URL, extract its text, and return title + cleaned body. */
    fetchUrl(url: string): Promise<{ url: string; title?: string; text: string }>;
    /** Full-text web search. Optional — not wired until a search-API key is configured.
     *  TODO(G3): wire a web-search API transport (needs a key). */
    search?: (query: string) => Promise<{ results: { url: string; title: string; snippet: string }[] }>;
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
}
