import type {
  ChannelReadState,
  GenRequestInput,
  ProductDraft,
  ScheduleChannel,
  ScheduleDraftInput,
  SegmentRuleGroup,
} from "@fikirtive/core";
import type { GenFailureReason } from "@fikirtive/core/gen-failure";

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

/** CRM Segment read model. The web action remains the authority and maps Prisma rows into this
 * serializable shape; Otto never imports Prisma or trusts a model-supplied owner identity. */
export type CrmSegmentSummary = {
  id: string;
  name: string;
  phrase: string;
  rules: SegmentRuleGroup | null;
  status: "ready" | "unavailable";
  matchedCount: number;
  contactableCount: number;
  knownOptOutCount: number;
  /** Known opt-outs this segment's consent rule kept out — the number the merchant reads. */
  excludedByConsentCount: number;
  /** Of those, the ones held out by an opt-out recorded before the consent ledger existed. */
  unresolvedLegacyOptOutCount: number;
  /** Contacts kept in on an opt-out the merchant recorded himself (unverified) — #716. */
  reportedOptOutCount: number;
  createdAt: string;
};

export type CrmSegmentContact = {
  id: string;
  name: string;
  channels: string[];
  contactable: boolean;
  /** The merchant recorded an opt-out for this contact; it is not verified consent. */
  reportedOptOut: boolean;
  /** Held out by an opt-out recorded before this contact had a consent history. */
  unresolvedLegacyOptOut: boolean;
};

/** CRM Contact read model (B0-59/60/C1). Dates are ISO strings across the package seam. */
export type CrmContactSummary = {
  id: string;
  name: string;
  lifecycleStage: string;
  source: string;
  firstTouchCampaignId: string | null;
  firstTouchAt: string;
  lastSeenAt: string;
  consentState: {
    state: "unknown" | "verified_grant" | "effective_revoke";
    stateSourceKind: string | null;
    evidenceStatus: string | null;
    lastReceivedAt: string | null;
    /** Held out by an opt-out recorded before this contact had a consent history (#752).
     *  Otto reads the merchant's own truth — never a nicer version of it. */
    unresolvedLegacyOptOut: boolean;
  };
  doNotDisturb: boolean;
  totalOrdersMyr: string | null;
  createdAt: string;
  identities: {
    id: string;
    channel: string;
    externalId: string;
    handle: string | null;
    label: string | null;
  }[];
};

/**
 * One page of contacts, with the two facts that stop it from passing as the whole list (#742).
 *
 * `contacts` is a page — never everything the merchant has. `totalCount` is how many rows the
 * SAME owner-scoped filter has in total (the number the Contacts page prints as "Showing 50 of
 * 65 contacts"), `returned` is how many are in this payload, and `hasMore` is true when the rest
 * were left out. The counts ride WITH the rows because the alternative — handing over the page
 * and trusting the reader to remember it was cut — is exactly what went wrong.
 */
export type CrmContactPage = {
  ok: true;
  contacts: CrmContactSummary[];
  returned: number;
  totalCount: number;
  hasMore: boolean;
};

export type CrmContactDetailSummary = CrmContactSummary & {
  consentEvents: {
    id: string;
    channel: string;
    purpose: string;
    action: string;
    actorKind: string;
    entryMode: string;
    sourceKind: string;
    evidenceStatus: string;
    occurredAt: string | null;
    receivedAt: string;
  }[];
};

/** Zero-cost Campaign planner shapes (B0-51..58/C2a). These are structural mirrors only:
 * the authenticated web actions remain the validator and owner-scoped authority. */
export type CampaignPlanEntrySummary = {
  id: string;
  date: string;
  platform: string;
  format: string;
  hook: string;
  brief: string;
  estCredits: number;
  status: "proposed" | "approved";
};

export type ProposedCampaignPlanEntry = Omit<CampaignPlanEntrySummary, "id" | "status">;

export type CampaignPlanSummary = {
  theme: string;
  rationale: {
    summary: string;
    sources: { title: string; domain: string }[];
    capturedAt?: string;
  } | null;
  entries: CampaignPlanEntrySummary[];
  ideas: string[];
};

export type CampaignSummary = {
  id: string;
  name: string;
  status: string;
  goal: string;
  startAt: string;
  endAt: string;
  plan: CampaignPlanSummary | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignDetailSummary = CampaignSummary & {
  grouped: {
    projects: { id: string; name: string; createdAt: string }[];
    scheduledPosts: {
      id: string;
      channel: string;
      caption: string;
      scheduledAt: string;
      status: string;
      createdAt: string;
    }[];
    generations: { id: string; assetId: string; kind: "image" | "video"; createdAt: string }[];
  };
  trendSnapshots: Omit<TrendSnapshotSummary, "campaignId">[];
};

export type TrendSnapshotSummary = {
  id: string;
  summary: string;
  sources: unknown;
  capturedAt: string;
  campaignId: string | null;
  createdAt: string;
};

/** C7 Workflow Routine scope exposed to Otto. This mirrors the engine's closed M2 shape only;
 * empty collections/zero limits authorize nothing, and the authenticated service validates it again. */
export type OttoWorkflowRoutineScope = {
  actionKinds: Array<"conversation_reply" | "broadcast_run" | "wait" | "complete">;
  channelScopes: Array<{ channel: string; providerConnectionId: string | null }>;
  contactIds: string[];
  segmentIds: string[];
  maxActions: number;
  maxRecipients: number;
};

/** C7 Workflow read/draft capability. Exactly fourteen authenticated methods are exposed: no tenant
 * identity argument and no activate/authorize/kill/create/advance/dispatch/send/provider/spend seam.
 * Routine draft credit caps and summary policy inputs are deliberately absent; the web adapter fixes them. */
export type OttoWorkflowsPort = {
  listWorkflowDefinitions(input?: { limit?: number }): Promise<unknown>;
  getWorkflowDefinition(input: { workflowDefinitionId: string }): Promise<unknown>;
  listWorkflowRevisions(input: { workflowDefinitionId: string; limit?: number }): Promise<unknown>;
  listRoutines(input?: {
    workflowDefinitionId?: string;
    status?: "draft" | "active" | "paused" | "revoked" | "expired";
    cursor?: string;
    limit?: number;
  }): Promise<unknown>;
  getRoutine(input: { routineId: string }): Promise<unknown>;
  listRoutineRuns(input: {
    routineId?: string;
    workflowDefinitionId?: string;
    status?: "queued" | "running" | "waiting" | "completed" | "blocked" | "cancelled" | "failed";
    cursor?: string;
    limit?: number;
  }): Promise<unknown>;
  getContactJourneyStates(input: {
    routineId?: string;
    workflowDefinitionId?: string;
    status?: "active" | "waiting" | "paused" | "completed" | "exited" | "blocked" | "failed";
    cursor?: string;
    limit?: number;
  }): Promise<unknown>;
  listBusinessHoursPolicies(input?: {
    status?: "draft" | "published" | "archived";
    cursor?: string;
    limit?: number;
  }): Promise<unknown>;
  getBusinessHoursPolicy(input: { businessHoursPolicyId: string }): Promise<unknown>;
  createWorkflowDefinition(input: {
    slug: string;
    name: string;
    definitionKind: "rule" | "journey";
    originKind: "custom";
  }): Promise<unknown>;
  validateWorkflowRules(input: { workflowDefinitionId: string; rulesSource: string }): Promise<unknown>;
  saveWorkflowRevision(input: { workflowDefinitionId: string; rulesSource: string }): Promise<unknown>;
  publishWorkflowRevision(input: {
    workflowDefinitionId: string;
    workflowRevisionId: string;
    expectedRowRevision: number;
  }): Promise<unknown>;
  createRoutineDraft(input: {
    workflowDefinitionId: string;
    workflowRevisionId: string;
    routineKey: string;
    scopeJson: OttoWorkflowRoutineScope;
    expiresAt?: string | null;
  }): Promise<unknown>;
};

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
/** Result of one factory batch run (W-B3-F-P). Structural mirror of factory-batch's
 *  BatchResult — declared here so packages/otto never imports apps/web across the seam. */
export interface FactoryBatchResult {
  batchId: string;
  cells: {
    index: number;
    type: "gen" | "text";
    status: "queued" | "reused" | "text" | "error";
    jobId?: string;
    credits: number;
    error?: string;
  }[];
  totalCredits: number;
  dispatched: number;
  reused: number;
  failed: number;
}

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
  startGen?: (req: GenRequestInput) => Promise<
    | { id: string; disposition: "fresh" | "reused" }
    // `retryable` = 结果不明、花钱之前就停住了(#656 P1);Otto 侧照旧只把错误原样呈上去。
    | { error: string; disposition?: "conflict" | "retryable" }
  >;
  /** Factory batch port (W-B3-F-P, spec §5.2) — injected by the web caller. Runs a HEADLESS
   *  batch of generations through the SAME startGen authority, one startGen call per cell, so
   *  there is zero new spend path: each cell reserves/settles/refunds inside startGen and text
   *  cells are $0. The server closure injects a caller-stable attemptId (APPROVAL_CARD.id for
   *  Otto) that is deliberately absent from model args; startGen atomically returns fresh/reused.
   *  The two methods mirror runVariantBatch / runBulkGrid. Reached ONLY via this port — never
   *  importing factory-actions / prisma (single-action-layer rule, same as ctx.startGen). */
  runFactoryBatch?: {
    variant(input: Record<string, unknown>): Promise<FactoryBatchResult | { error: string }>;
    bulk(input: Record<string, unknown>): Promise<FactoryBatchResult | { error: string }>;
  };
  /** Compiled brand memory text for THIS run (injected as a system message at run assembly). */
  brandContext?: string;
  /** The merchant's own brief for THIS project (Project.coworkBrief), already trimmed.
   *  Injected as a system message right AFTER brandContext at run assembly — shop-wide
   *  identity first, then the direction the merchant set for this one project. Absent
   *  (undefined) when the project has no brief; never an empty string. */
  projectBrief?: string;
  /** The owner's reusable entities the agent may @-reference (name + type only; ids for tools). */
  availableRefs?: { id: string; name: string; type: string }[];
  /** When true, buildContextSystemMessage injects the Simple-mode plain-language block so
   *  Otto speaks to a beginner without jargon. NOT baked into the shared identity — injected
   *  only on the simple door path (via buildContextSystemMessage). */
  simpleMode?: boolean;
  /** The latest generation's status for THIS thread (best-effort), so Otto speaks truthfully
   *  about progress instead of guessing. Null/undefined = unknown. */
  activeJob?: { status: string; kind: string; error?: string | null } | null;
  /** C7 Workflow read/draft parity. The web caller injects an exact authenticated eight-method
   * capability. Workflow publish moves only the definition pointer; Routine authority is absent. */
  workflows?: OttoWorkflowsPort;
  /** CRM Segments port (B0-61/C3, $0). Every method is injected by the web caller and delegates to
   * the SAME requireOwner-gated Segment server actions the human page uses. `build` accepts only a
   * structured rule group; it never compiles free-form language inside the skill. Create IDs and
   * proofs are issued server-side by the action layer, while update IDs are owner-scoped there. */
  segments?: {
    list(): Promise<
      | { ok: true; evaluatedAt: string; segments: CrmSegmentSummary[] }
      | { error: string }
    >;
    get(segmentId: string): Promise<
      | { ok: true; evaluatedAt: string; segment: CrmSegmentSummary }
      | { error: string }
    >;
    preview(rules: SegmentRuleGroup): Promise<
      | {
          ok: true;
          evaluatedAt: string;
          phrase: string;
          matchedCount: number;
          contactableCount: number;
          knownOptOutCount: number;
          excludedByConsentCount: number;
          unresolvedLegacyOptOutCount: number;
          reportedOptOutCount: number;
          contacts: CrmSegmentContact[];
          /** #819 — the sample is cut at ten rows; `returned`/`hasMore` say so in the payload
           *  so the sample can never be read as the whole match. Same shape as the contact
           *  page port (#742): the truncation travels with the data, not in a prompt. */
          returned: number;
          hasMore: boolean;
        }
      | { error: string }
    >;
    build(input: {
      operation: "create" | "update";
      segmentId?: string;
      name: string;
      rules: SegmentRuleGroup;
    }): Promise<
      | {
          ok: true;
          idempotent: boolean;
          operation: "create" | "update";
          segment: Omit<
            CrmSegmentSummary,
            | "status"
            | "matchedCount"
            | "contactableCount"
            | "knownOptOutCount"
            | "excludedByConsentCount"
            | "unresolvedLegacyOptOutCount"
            | "reportedOptOutCount"
          >;
        }
      | { error: string }
    >;
  };
  /** CRM Contact port (B0-59/60/C1, $0). Reads and writes delegate to the same authenticated
   * web actions as the human surface. The port never accepts owner identity; identity records are
   * read-only, duplicate matches are suggestions, and consent/DND writes enter the shared runtime. */
  contacts?: {
    list(input?: { lifecycleStage?: "New" | "Active" | "Dormant"; limit?: number }): Promise<
      CrmContactPage | { error: string }
    >;
    get(contactId: string): Promise<
      { ok: true; contact: CrmContactDetailSummary } | { error: string }
    >;
    search(input: { query: string; lifecycleStage?: "New" | "Active" | "Dormant"; limit?: number }): Promise<
      CrmContactPage | { error: string }
    >;
    create(input: { name: string; lifecycleStage?: "New" | "Active" | "Dormant" }): Promise<unknown>;
    update(input: {
      contactId: string;
      patch: { name?: string; lifecycleStage?: "New" | "Active" | "Dormant" };
    }): Promise<unknown>;
    importCsv(input: { csv: string; importId: string }): Promise<unknown>;
    recordConsent(input: {
      contactId: string;
      action: "grant" | "revoke";
      requestId: string;
    }): Promise<unknown>;
    setDnd(input: { contactId: string; enabled: boolean; requestId: string }): Promise<unknown>;
  };
  /** Connected channel-account port (#495/#500 read parity, $0). The web caller injects the SAME
   * owner-scoped customer-inbox gateway read the human template picker uses (the broadcast
   * composer reads the same owner-scoped rows through its own broadcast gateway).
   * The port never accepts owner identity; it returns only { id, channel, scopeKey } rows. */
  channelScopes?: {
    list(): Promise<
      { ok: true; scopes: { id: string; channel: string; scopeKey: string }[] } | { error: string }
    >;
  };
  /** Spend-visibility port (#555, $0 READ). The web caller injects the SAME owner-scoped read the
   * Billing page renders (spend-history-data.getSpendOverview), so Otto answers "how much have I
   * spent?" from the merchant's real ledger instead of pointing at a page. The port never accepts
   * owner identity and can only read: no reserve, settle, refund, grant, adjust, or top-up.
   * `window` is returned so the answer can say how far back it reaches — the history is the most
   * recent `taskLimit` items, not all time. Amounts are DISPLAYED credits; `credits` is signed
   * (negative = charged, positive = added). */
  spending?: {
    overview(): Promise<
      | {
          ok: true;
          balance: number;
          reserved: number;
          window: { taskLimit: number; returned: number; hasMore: boolean };
          entries: {
            category: string;
            label: string;
            credits: number;
            at: string;
            pending: boolean;
            detail?: string;
          }[];
        }
      | { error: string }
    >;
  };
  /** Campaign planner port (B0-51..58/C2a, $0). Every method delegates to the SAME authenticated
   * Campaign/Trend action used by the manual surface. The model cannot supply identity, mint ids,
   * write legacy UTM, dispatch generation, touch credits, or authorize publishing. */
  campaigns?: {
    list(): Promise<{ ok: true; campaigns: CampaignSummary[] } | { error: string }>;
    get(campaignId: string): Promise<{ ok: true; campaign: CampaignDetailSummary } | { error: string }>;
    listTrends(input: { campaignId?: string; limit?: number }): Promise<
      { ok: true; snapshots: TrendSnapshotSummary[] } | { error: string }
    >;
    create(input: {
      name: string;
      goal: string;
      status: "DRAFT" | "ACTIVE" | "DONE" | "CANCELLED";
      period: { start: string; end: string; tz: "Asia/Kuala_Lumpur" };
      theme?: string;
    }): Promise<unknown>;
    proposeEntry(input: { campaignId: string; entry: ProposedCampaignPlanEntry }): Promise<unknown>;
    updateEntry(input: {
      campaignId: string;
      entryId: string;
      patch: Partial<ProposedCampaignPlanEntry>;
    }): Promise<unknown>;
    removeEntry(input: { campaignId: string; entryId: string }): Promise<unknown>;
    approveEntry(input: { campaignId: string; entryId: string }): Promise<unknown>;
    group(input: {
      campaignId: string | null;
      targetType: "project" | "scheduled_post" | "generation";
      targetId: string;
    }): Promise<unknown>;
    saveTrend(input: {
      campaignId: string | null;
      evidence: {
        summary: string;
        sources: { title: string; domain: string }[];
        capturedAt?: string;
      };
    }): Promise<unknown>;
  };
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
   *  performance. Skills reach it ONLY via ctx.metaInsights, never importing meta-insights.ts.
   *  #692 r3: money arrives as FINISHED TEXT (`money.*`) already carrying its currency, or naming
   *  the account when Meta reported none. There is deliberately no numeric spend/cpc/cpm here —
   *  a rule in a comment cannot stop a model, an absent field can. `moneyBucket` says which
   *  figures share a denomination; figures from different buckets may never be combined. */
  metaInsights?: {
    get(datePreset: string): Promise<
      | {
          accounts: {
            accountId: string;
            name: string;
            currency: string | null;
            moneyBucket: string;
            money: { spend: string; cpc: string; cpm: string };
            metrics: Record<string, string | null>;
          }[];
        }
      | { needsReconnect: true }
      | { transientError: true }
      | { notConnected: true }
    >;
  };
  /** Meta per-ad performance port (P1a) — injected by the web caller; reads the owner's
   *  connected ad-level performance + creative. Skills reach it ONLY via ctx.metaPerformance,
   *  never importing meta-performance.ts. Single action layer: this port and the P1b human
   *  panel's getAdPerformance action both resolve to fetchOwnerAdPerformance.
   *  #692 r3: same money boundary as metaInsights — `money.*` is finished text, there is no
   *  numeric spend/cpc/cpm, and `moneyBucket` says which figures share a denomination. Ads arrive
   *  grouped into buckets; accounts with NO reported currency each get their own bucket, because
   *  two of them are not thereby in the same currency. `hasSpend` carries the only thing the
   *  diagnosis ever needed the amount for: did this ad actually spend? */
  metaPerformance?: {
    getAds(datePreset: string): Promise<
      | {
          ads: {
            adId: string;
            adName: string | null;
            accountId: string;
            accountName: string | null;
            currency: string | null;
            moneyBucket: string;
            money: { spend: string; cpc: string; cpm: string };
            hasSpend: boolean;
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
    /** debt-74 (read parity). Owner-scoped connectable publish targets, PLUS what the read found
     *  for each channel (#741 r5 P1). `targets` alone is not an answer: a channel that could not be
     *  read, or that is connected-but-expired, contributes nothing to the list, and reporting that
     *  silence as "nothing connected" is the same lie whichever mouth says it. A channel missing
     *  from `channelStates` was never read. */
    listTargets(): Promise<{ targets: ScheduleTarget[]; channelStates: Record<string, ChannelReadState> }>;
    /** B0-103 (read parity, $0). Cold-start best-time-to-post suggestions for a channel, read from
     *  the STATIC global seed table (no owner scope — same craft knowledge for everyone), ordered
     *  best-first. Skills reach it ONLY via this port — never Prisma directly. Never writes. */
    suggestTimes(input: { channel: string; limit?: number }): Promise<
      { dayOfWeek: number; hourUtc: number; score: number; rationale: string }[]
    >;
    /** B0-28 (write, internal). Mint a SEAT-LESS, read-only share link for one OWNED post: the
     *  server verifies ownership, writes ONE SharePreviewToken row (the authority layer — audit +
     *  revocation), and signs an HMAC (ownerId+postId+exp) token (never touches an external
     *  platform). TTL is SERVER-FIXED — no caller-supplied expiry (NODE-275 收口3). Returns the
     *  link or an error (post not found / not owned). Reached ONLY via this port → the same
     *  owner-scoped server action. */
    sharePreview(input: { scheduledPostId: string }): Promise<
      { token: string; url: string; expiresAt: string } | { error: string }
    >;
    /** B0-28 (write, internal). Revoke every ACTIVE share link for one OWNED post — sets revokedAt
     *  on the authority rows, killing already-shared links immediately (verify = HMAC ∧ row live). */
    sharePreviewRevoke(input: { scheduledPostId: string }): Promise<
      { ok: true; revoked: number } | { error: string }
    >;
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
  /** Media library port (W-B3-B, $0) — injected by the web caller. Thin closures over the SAME
   *  owner-gated $0 server actions the human asset-viewer / library uses (getEditorMedia,
   *  loadMoreMedia, attach/detach/delete/softDeleteGeneration, cancelGenJob), each pre-bound to
   *  THIS owner+project. $0: cancelJob only ever REFUNDS a still-QUEUED job (never charges);
   *  delete/discard are soft tombstones. Skills reach it ONLY via ctx.media — never importing web
   *  actions or Prisma (CI fence rule). Absent in the minimal worker verdict ctx; degrades gracefully. */
  media?: {
    /** $0 read: this project's generated media as timeline-ready clips (getEditorMedia). */
    list(): Promise<EditorMediaClip[]>;
    /** $0 read: one page of the Assets library (loadMoreMedia); cursor = previous page's nextCursor. */
    loadMore(cursor?: string | null): Promise<MediaLibraryPage | { error: string }>;
    /** $0 write: attach a candidate generation to a shot (attachGeneration). */
    attach(generationId: string, shotId: string): Promise<{ ok: true } | { error: string }>;
    /** $0 write: detach a generation back to the candidate zone (detachGeneration). */
    detach(generationId: string): Promise<{ ok: true } | { error: string }>;
    /** $0 write: soft-delete a generation from the Assets library (deleteGeneration). */
    remove(generationId: string): Promise<{ ok: true } | { error: string }>;
    /** $0 write: hide a generation from the candidate zone (softDeleteGeneration). */
    discard(generationId: string): Promise<{ ok: true } | { error: string }>;
    /** $0: cancel a still-QUEUED gen job — refunds it (cancelGenJob). alreadyStarted = too late to cancel. */
    cancelJob(jobId: string): Promise<{ refunded: true } | { alreadyStarted: true } | { error: string }>;
  };
  /** Render/caption port (W-B3-B, $0) — injected by the web caller. export renders the SAVED cut
   *  (startRender, ffmpeg concat — "re-rendering is free"); caption dispatches whisper.cpp captions
   *  (startCaption); the rest are reads. No gen job, no spend. Skills reach it ONLY via ctx.render. */
  render?: {
    /** $0: export the project's SAVED cut to a video (startRender). No saved cut → honest error. */
    export(): Promise<{ id: string } | { error: string }>;
    /** $0 read: recent render jobs for this project (getRenderJobs). */
    jobs(): Promise<RenderJobView[]>;
    /** $0: dispatch whisper captions for one clip by its content-addressed src (startCaption). */
    caption(src: string): Promise<{ id: string } | { error: string }>;
    /** $0 read: poll a caption job (getCaptionJob); null when not found. */
    captionJob(jobId: string): Promise<CaptionJobView | null>;
    /** $0 read: the cached transcript for a clip (getTranscript); [] when none cached yet. */
    transcript(src: string): Promise<TranscriptCue[]>;
  };
  /** Media-import port (W-B3-B, $0) — injected by the web caller. The server-side analogue of the
   *  browser direct-upload chain: SSRF-guarded fetch → storage.put → the SAME finalizeCandidateUploads
   *  authority the human upload lands through. $0 (no gen). Skills reach it ONLY via ctx.mediaImport. */
  mediaImport?: {
    /** $0: import an image/video from a public URL into this project (Generation source:UPLOAD). */
    fromUrl(
      url: string,
      opts?: { promptText?: string; entityIds?: string[] },
    ): Promise<{ ok: true; generationId: string } | { error: string }>;
  };
  /** Projects port (W-B3-D, $0, debt-03~07) — injected by the web caller. Every function is a thin
   *  closure over the SAME owner-gated project server actions the human sidebar uses (actions.ts:
   *  getOrCreateDefaultProject / createProject / renameProject / setProjectPinned / deleteProject) —
   *  single action layer (宪法 7 / Seam 9). Owner scope + fail-closed not-found guards live INSIDE
   *  those actions (requireOwner). None touch startGen / reserveCredits / the provider. Skills reach
   *  it ONLY via ctx.projects — never importing web actions or Prisma (CI fence rule). Absent in the
   *  minimal worker verdict ctx; the skill degrades gracefully when it is not injected. */
  projects?: {
    /** debt-03: the owner's default project id (idempotent bootstrap read — creates the "New project" placeholder if none, #546). */
    getDefault(): Promise<{ id: string } | { error: string }>;
    /** debt-04: create a new named project. */
    create(name: string): Promise<{ id: string } | { error: string }>;
    /** debt-06: rename an owned project (display metadata only). */
    rename(projectId: string, name: string): Promise<{ ok: true; name: string } | { error: string }>;
    /** debt-07: pin/unpin an owned project in the sidebar. */
    setPinned(projectId: string, pinned: boolean): Promise<{ ok: true; pinnedAt: string | null } | { error: string }>;
    /** debt-05: PERMANENTLY delete an owned EMPTY project. The port hard-refuses (deterministic
     *  live-Generation count gate, fail-closed) a project that still contains generated media —
     *  deleting it would physically destroy settled paid outputs with no refund; that deletion is
     *  UI-only (type-the-name confirm). The action stays guarded (refuses while a generation runs,
     *  refunds queued jobs). Irreversible — not a soft delete. */
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
  /** Reference-generation port (W-B3-G-P, debt-68/69) — injected by the web caller. Thin closures over
   *  the SAME owner-gated reference-generation server actions the human element UI uses
   *  (refgen-actions.startRefGen / deleteVariant). `generate` is the PAID reference-image path: it
   *  goes THROUGH startRefGen — the sole spend authority — which re-derives the owner (requireOwner),
   *  re-validates via the typed refGenRequest gate, derives the price server-side (pricedRefgenCredits,
   *  the model can't set it), guards per-entity double-spend, and reserves atomically with the job
   *  insert. The generateReferences skill is cost:"spend" ⇒ needsApproval is a machine-derived LITERAL
   *  true (anti-flip). `deleteVariant` is a $0 soft delete fronted by an Otto-only fail-closed active-job
   *  gate (see makeOttoRefgenPort — refuses while a paid job for that variant is in flight, #271
   *  deleteProject precedent). Skills reach it ONLY via ctx.refgen — never importing web actions, the
   *  provider, or Prisma (CI fence rule). Absent in the minimal worker verdict ctx; the skills degrade
   *  gracefully when it is not injected. */
  refgen?: {
    /** debt-68 (SPEND): generate reference images for an OWNED element through the startRefGen
     *  authority. count is bounded 1–6 by the typed gate; model/mode/price are server-owned. Returns
     *  the RefGenJob id or a structured error ("Element not found." fail-closes a cross-tenant/forged id). */
    generate(input: {
      entityId: string;
      prompt: string;
      count?: number;
      mode?: "BASE" | "REFSHEET";
    }): Promise<{ id: string } | { error: string }>;
    /** debt-69 ($0, guarded): soft-delete an OWNED reference variant (+ its tagged reference images).
     *  The port hard-refuses (fail-closed) while a paid RefGenJob for that variant is still in flight,
     *  so a delete can't strand settled/settling paid work. Owner scope + not-found guard live INSIDE
     *  the deleteVariant action (requireOwner). */
    deleteVariant(variantId: string): Promise<{ ok: true } | { error: string }>;
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
  /** WHY this card rested, as a name from the closed `GenFailureReason` set (#827).
   *
   *  Required, like `status`, because it is part of the card's state rather than a caption: a
   *  merchant who asks Otto "why did that one fail?" a day later must get the SAME sentence the
   *  card shows, and Otto looks it up through the one whitelist in core. Almost every card is
   *  `unexplained`, which is the honest name for "this ending has no reason we can prove". */
  failureReason: GenFailureReason;
  /** Which paid press produced this card, and where in it this card sits (#603 T4). */
  genJobId: string | null;
  batchIndex: number | null;
  batchSize: number | null;
  /** The card this one's paid job was actually MADE FROM. Never a same-batch neighbour. */
  madeFromNodeId: string | null;
  url?: string | null;
};

/** A project media clip as skills see it (getEditorMedia) — structural re-declaration; the web
 *  return type must NOT be imported here (same fence rule as CanvasNodeView). */
export type EditorMediaClip = { id: string; src: string; kind: "image" | "video" | "audio"; seconds: number };

/** One Assets-library item + its page (loadMoreMedia) — structural re-declaration. */
export type MediaLibraryItem = {
  id: string;
  src: string;
  kind: "image" | "video";
  prompt: string;
  attached: boolean;
  shotLabel: string | null;
};
export type MediaLibraryPage = { items: MediaLibraryItem[]; nextCursor: string | null; hasMore: boolean };

/** One render job's status (getRenderJobs) — structural re-declaration. */
export type RenderJobView = {
  id: string;
  status: string;
  progress: number;
  error: string | null;
  createdAt: string;
  url: string | null;
};

/** One caption job's status (getCaptionJob) — structural re-declaration. */
export type CaptionJobView = { id: string; status: string; progress: number; error: string | null };

/** One transcript cue (getTranscript) — structural re-declaration of the core CaptionCue. */
export type TranscriptCue = { startMs: number; lengthMs: number; text: string };

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
