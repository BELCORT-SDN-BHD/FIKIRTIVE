/**
 * handleResearch — the Otto deep-research worker (research S3 · Task 2, the MONEY CORE).
 *
 * The user approves a RESEARCH_CARD → approveResearch creates a ResearchJob (status QUEUED, $0)
 * and enqueues { jobId } on RESEARCH_QUEUE. This handler runs the bounded research agent and is
 * the ONLY place in the whole research block where real credits are spent.
 *
 * ── MONEY-SAFETY invariants (an adversarial review audits each) ─────────────────────────────
 *  1. Credits are touched ONLY through `withLlmBudget` — this file NEVER calls reserveCredits /
 *     settleCredits / refundReservation directly. withLlmBudget reserves the turn budget up front,
 *     settles the ACTUAL token cost, and refunds the difference (or the whole reservation on a
 *     pre-spend throw). The refId is `research:<cardId>` — the SAME key approveResearch used for
 *     the ResearchJob idempotencyKey, so the CreditLedger reserve:/settle: idempotency makes the
 *     SPEND once-EVER across any redelivery.
 *  2. No double-reserve on pg-boss retry: a status CAS (QUEUED→RUNNING via updateMany) makes this
 *     handler a NO-OP on any redelivery/duplicate (count===0 → return before any spend). The queue
 *     is also retryLimit:0, so a failed run never auto-retries. Belt + suspenders.
 *  3. The run has TWO costs, both settled by the same wrapper, neither charged inside the agent:
 *     LLM tokens, and the SEARCH fee (钱路 M1-c — Founder 2026-07-03's 3× ruling; `readSource` is
 *     still genuinely free). The search leg rides `extraHoldInternal` / `extraSettleInternal`:
 *     hold = this tier's maxSearches × the rate, settle = `ctx.searchesUsed` × the rate. Truncation
 *     (MaxTurnsExceeded) settles ACTUAL usage of BOTH legs, never over-charges.
 *  4. A failure BEFORE spend (e.g. insufficient balance) charges $0 — withLlmBudget refunds.
 *  5. No provider key is ever logged or placed in an error message (adapters scrub keys already).
 *
 * All reads are owner-scoped off ResearchJob.ownerId.
 */
import { prisma } from "@fikirtive/db";
import { runAsSystem, runAsTenant } from "@fikirtive/db/principal";
import {
  RESEARCH_TIERS,
  researchTierSearchBudgetInternal,
  researchAgent,
  withLlmBudget,
  ottoModelRuntime,
  run,
  MaxTurnsExceededError,
  mapOttoUsage,
  type ResearchContext,
} from "@fikirtive/otto";
import {
  newId,
  tavilySearch,
  braveSearch,
  searchWithFallback,
  RESEARCH_QUEUE,
  searchChargeInternal,
} from "@fikirtive/core";
import { fetchAndExtract } from "@fikirtive/core/server";
import { sanitizeError } from "../redact.js";

/** Chars per page when slicing a page's clean text (mirrors web-page-cache PAGE_CHARS). */
const PAGE_CHARS = 4000;

/**
 * A worker-side page reader: core fetchAndExtract (SSRF-guarded, HTML-stripped) + page-slice.
 * FREE (no spend, no owner scope — public pages). Caching is deliberately NOT done here: the
 * web-side WebPageCache keys on a hash of a normalized URL (apps/web/lib/web-page-cache.ts), which
 * the worker can't import — duplicating that normalization risks a subtle key mismatch, and the
 * brief marks caching an optional optimization ("else fetch fresh"). Fresh fetch is correct.
 *
 * NOTE: fetchAndExtract caps its returned text; the slice below simply pages within that cap.
 */
async function readPageWorker(
  url: string,
  page = 1,
): Promise<{ url: string; title: string; page: number; totalPages: number; text: string }> {
  const fetched = await fetchAndExtract(url); // throws on SSRF/network/non-200 (the tool try/catches)
  const fullText = fetched.text;
  const totalPages = Math.max(1, Math.ceil(fullText.length / PAGE_CHARS));
  const start = (page - 1) * PAGE_CHARS;
  const text = page >= 1 && page <= totalPages ? fullText.slice(start, start + PAGE_CHARS) : "";
  return { url: fetched.url, title: fetched.title ?? "", page, totalPages, text };
}

/** Build the search port from env keys — SAME sourcing as buildOttoContext (web).
 *  The port itself moves no credits; the fee is settled by the wrapper off `ctx.searchesUsed`. */
function buildSearch(): ResearchContext["search"] {
  const k1 = process.env.TAVILY_API_KEY;
  const k2 = process.env.BRAVE_SEARCH_API_KEY;
  const primary = k1 ? tavilySearch(k1) : k2 ? braveSearch(k2) : undefined;
  const fb = k1 && k2 ? braveSearch(k2) : undefined;
  if (!primary) {
    // No key configured → a search that returns nothing (the agent still writes from what it has).
    return async () => [];
  }
  const fn = searchWithFallback(primary, fb);
  return (q: string) => fn(q);
}

/** Extract the agent's final message text = the report synthesis (same pattern as otto-resume). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(r: any): string {
  if (r?.finalOutput != null) return String(r.finalOutput);
  return (Array.isArray(r?.newItems) ? (r.newItems as any[]) : [])
    .filter((it: any) => it.type === "message_output_item")
    .map((it: any) => {
      const content: any[] = it?.rawItem?.content ?? [];
      return content
        .filter((c: any) => c.type === "output_text")
        .map((c: any) => c.text ?? "")
        .join("");
    })
    .join("");
}

type ResearchCardPayloadShape = {
  researchId?: string;
  topic?: string;
  goal?: string;
  tier?: keyof typeof RESEARCH_TIERS;
  questions?: string[];
  estimatedCredits?: number;
  status?: string;
  [k: string]: unknown;
};

/**
 * Flip a RESEARCH_CARD payload → failed, owner-scoped. RMW re-reads the payload so every OTHER
 * field is byte-preserved; only status + a brief error move. NO credit calls. Shared by the inline
 * failure path (failResearch) and the stale-job reaper (reapStaleResearchJobs).
 */
async function failResearchCard(cardId: string, ownerId: string, errorText: string): Promise<void> {
  const fresh = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "RESEARCH_CARD" },
    select: { payload: true },
  });
  if (!fresh) return;
  const cur = (fresh.payload ?? {}) as ResearchCardPayloadShape;
  await prisma.chatMessage.updateMany({
    where: { id: cardId, ownerId, kind: "RESEARCH_CARD" },
    data: { payload: { ...cur, status: "failed", error: errorText } as unknown as object },
  });
}

/**
 * Mark the card + job FAILED, owner-scoped. NO credit calls here — withLlmBudget already
 * settled/refunded internally.
 */
async function failResearch(
  job: { id: string; ownerId: string; cardId: string },
  errorText: string,
): Promise<void> {
  await failResearchCard(job.cardId, job.ownerId, errorText);
  await prisma.researchJob.updateMany({
    where: { id: job.id, ownerId: job.ownerId },
    data: { status: "FAILED", error: errorText },
  });
}

export async function handleResearch(data: { jobId: string }, _retryCount: number): Promise<void> {
  // (a) Load the ResearchJob (owner-scope everything downstream off job.ownerId).
  const job = await prisma.researchJob.findUnique({ where: { id: data.jobId } });
  if (!job) {
    console.warn(`[research] job ${data.jobId} not found — nothing to do`);
    return;
  }

  // #463: the payload carries only the job id — the tenant is knowable only after the row
  // load above. The CAS claim, the LLM budget reservation and every write below run scoped
  // to this job's owner.
  await runAsTenant(job.ownerId, async () => {
    // (b) RETRY-IDEMPOTENCY (money-critical): CAS status QUEUED→RUNNING. On any redelivery/duplicate
    // the row is no longer QUEUED → count===0 → return BEFORE any spend. Primary double-reserve guard.
    const { count } = await prisma.researchJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { status: "RUNNING" },
    });
    if (count === 0) {
      console.log(`[research] job ${job.id}: not QUEUED (already handled/redelivery) — no-op`);
      return;
    }

    // (c) Load the RESEARCH_CARD (owner + thread scoped) + parse tier → caps.
    const card = await prisma.chatMessage.findFirst({
      where: { id: job.cardId, ownerId: job.ownerId, kind: "RESEARCH_CARD" },
      select: { payload: true },
    });
    const payload = (card?.payload ?? {}) as ResearchCardPayloadShape;
    const tierKey = (payload.tier && payload.tier in RESEARCH_TIERS ? payload.tier : job.tier) as keyof typeof RESEARCH_TIERS;
    const tier = RESEARCH_TIERS[tierKey] ?? RESEARCH_TIERS.standard;
    const topic = payload.topic ?? "";

    // (d) Build the small, mutable ResearchContext. readPage is free; search is CHARGED — its
    // counter (searchesUsed) is what the settle below bills against. Counters also cap use.
    const ctx: ResearchContext = {
      search: buildSearch(),
      readPage: (url: string, page?: number) => readPageWorker(url, page),
      sourcesRead: [],
      maxSearches: tier.maxSearches,
      maxPages: tier.maxPages,
      searchesUsed: 0,
      pagesUsed: 0,
    };

    // Compose the agent's task from the card plan.
    const goalLine = payload.goal ? `\nGoal: ${payload.goal}` : "";
    const questionsLine =
      payload.questions && payload.questions.length > 0
        ? `\nSub-questions to investigate:\n${payload.questions.map((q) => `- ${q}`).join("\n")}`
        : "";
    const researchInput = `Research this topic and write a thorough, well-organized report.\n\nTopic: ${topic}${goalLine}${questionsLine}`;

    // (e) THE SPEND — the sole credit path. Copies the otto-resume shape EXACTLY. withLlmBudget
    // reserves turnBudgetInternal(maxSteps) up front, runs, settles ACTUAL token cost, refunds the
    // rest. On MaxTurnsExceeded (graceful truncation) usageOnError feeds actual usage → settle actual.
    const refId = `research:${job.cardId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any;
    try {
      result = await withLlmBudget(
        {
          orgId: job.ownerId,
          refId,
          model: ottoModelRuntime.billableModelId,
          paid: true,
          maxSteps: tier.maxSteps,
          // 钱路 M1-c(裁决 9b):搜索按 Founder 2026-07-03 裁的 3× 收费。此前 searchSources
          // 被标成 FREE —— 而「free」的真正含义是**没人计价**:每一次深研都在替商家买搜索,
          // 账上一分没记。现在它是这次收费的第二条腿:
          //   hold   = 这一档的 maxSearches × 单次费率(worst case,与卡面预估同源)
          //   settle = 实际搜了几次 × 单次费率(ctx.searchesUsed,跑完才知道)
          // 跑失败(withLlmBudget 全额退款)那条路不收 —— 一轮没成的深研不向商家收钱。
          extraHoldInternal: researchTierSearchBudgetInternal(tier.maxSearches),
          extraSettleInternal: () => searchChargeInternal(ctx.searchesUsed),
          usageOnError: (e) =>
            e instanceof MaxTurnsExceededError && (e as { state?: { usage?: unknown } }).state?.usage
              ? mapOttoUsage((e as { state: { usage: Parameters<typeof mapOttoUsage>[0] } }).state.usage)
              : null,
        },
        async () => {
          const run_ = await run(researchAgent, researchInput, { context: ctx, maxTurns: tier.maxSteps });
          return { result: run_, usage: mapOttoUsage(run_.state.usage) };
        },
      );
    } catch (e) {
      // withLlmBudget threw (insufficient balance / provider / max-turns w/o usable state / etc.).
      // Credits already refunded/settled INSIDE withLlmBudget — we do NOT touch credits here.
      // PERSISTED error surfaces in the RESEARCH_CARD/ResearchJob and is rendered to the user/admin —
      // strip any URL a fetch/network error from researchWeb may carry (mirrors gen.ts/refgen.ts/
      // render.ts/caption.ts/publish.ts, the other 5 jobs that sanitize before persisting).
      const errorText =
        e instanceof MaxTurnsExceededError
          ? "The research hit its step budget before finishing."
          : sanitizeError(e);
      console.warn(`[research] job ${job.id}: withLlmBudget threw — marking failed:`, errorText);
      await failResearch(job, errorText);
      return;
    }

    // (f) SUCCESS: the agent's final message text IS the report synthesis.
    const synthesis = extractText(result);

    // Write a RESEARCH_REPORT ChatMessage (seq+1, owner/thread from the job), mirroring appendCoworkResult.
    try {
      const last = await prisma.chatMessage.findFirst({
        where: { threadId: job.threadId, ownerId: job.ownerId },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      await prisma.chatMessage.create({
        data: {
          id: newId(),
          threadId: job.threadId,
          ownerId: job.ownerId,
          role: "AGENT",
          kind: "RESEARCH_REPORT",
          seq: (last?.seq ?? 0) + 1,
          text: topic ? `Research report: ${topic}` : "Research report",
          payload: {
            topic,
            synthesis,
            sources: ctx.sourcesRead,
          } as unknown as object,
        },
      });
    } catch (e) {
      // Best-effort: a report-write hiccup must not flip the job back / re-spend. Log + continue to
      // mark the card/job done (the spend already settled; the run succeeded).
      console.warn(`[research] job ${job.id}: RESEARCH_REPORT write failed (non-fatal):`, e instanceof Error ? e.message : e);
    }

    // Card → "done" (RMW: re-read payload, byte-preserve other fields, flip only status).
    const freshCard = await prisma.chatMessage.findFirst({
      where: { id: job.cardId, ownerId: job.ownerId, kind: "RESEARCH_CARD" },
      select: { payload: true },
    });
    if (freshCard) {
      const cur = (freshCard.payload ?? {}) as ResearchCardPayloadShape;
      await prisma.chatMessage.updateMany({
        where: { id: job.cardId, ownerId: job.ownerId, kind: "RESEARCH_CARD" },
        data: { payload: { ...cur, status: "done" } as unknown as object },
      });
    }

    // Job → DONE (owner-scoped). actualCredits is omitted — the authoritative settle lives in the
    // CreditLedger via withLlmBudget; we do NOT re-derive a spend figure outside the wrapper.
    await prisma.researchJob.updateMany({
      where: { id: job.id, ownerId: job.ownerId },
      data: { status: "DONE" },
    });
    console.log(`[research] job ${job.id}: DONE (${ctx.searchesUsed} searches, ${ctx.pagesUsed} reads, ${ctx.sourcesRead.length} sources)`);
  });
}

// A research run holds NO "started" timestamp on the job row — handleResearch's QUEUED→RUNNING CAS
// only moves `status`, and it never touches the row again until the terminal DONE/FAILED flip, so
// `updatedAt` is stable at the RUNNING-transition time for the whole run. 60 min is comfortably
// longer than any real research run (bounded by tier.maxSteps) and MATCHES the reservation reaper's
// LLM_RESERVATION_STALE_MS — the two reapers agree on what "the worker crashed" means, so the money
// reaper (which refunds the leaked `research:<cardId>` RESERVE) and this card reaper key off the
// same stranded rows.
const RESEARCH_STALE_MS = 1000 * 60 * 60;
const RESEARCH_INTERRUPTED = "research was interrupted — please try again";
const RESEARCH_NOT_STARTED = "research could not be started — please try again";

/** Does pg-boss still hold a deliverable message for this QUEUED research job? A queued job with
 * a live message should be left for the worker. A queued row with no live message past the stale
 * window means approve crashed/lost the send before handleResearch could ever spend. Fails safe:
 * if pg-boss state can't be read, assume the message may exist and skip this sweep. */
async function hasLiveResearchMessage(jobId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM pgboss.job
      WHERE name = ${RESEARCH_QUEUE} AND state IN ('created', 'retry', 'active')
        AND data->>'jobId' = ${jobId}
      LIMIT 1`;
    return rows.length > 0;
  } catch (e) {
    console.warn(`[research] pg-boss liveness check failed for ${jobId}; skipping reap this sweep:`, e instanceof Error ? e.message : e);
    return true;
  }
}

/**
 * Reaper for research cards stranded "Researching…" forever. RESEARCH_QUEUE is retryLimit:0, so a
 * worker SIGKILL'd mid-run (e.g. every Railway deploy) after the QUEUED→RUNNING CAS is never
 * redelivered — handleResearch never resumes to flip the ResearchJob RUNNING→FAILED nor the card
 * running→failed. The user's CREDITS are already recovered by reapStaleLlmReservations (the
 * `research:<cardId>` RESERVE has no SETTLE/REFUND finalizer → refunded there), so this is a PURE
 * UX sweep and a $0 change — it makes NO credit calls (a refund here would double-refund).
 *
 * Mirrors reapStaleRefGenJobs: a status-guarded conditional updateMany is the at-most-once claim. A
 * run that legitimately just finished flips RUNNING→DONE out from under us → count===0 → we skip, so
 * a completed job is never clobbered and a card is never falsely marked failed. It also fail-closes
 * stale QUEUED rows only when pg-boss has no live message for them, covering approve crashes between
 * the DB commit and queue send. All reads/writes are owner-scoped. Returns how many stranded research
 * jobs it swept.
 */
export async function reapStaleResearchJobs(): Promise<number> {
  return runAsSystem("research-reaper", async () => {
    const cutoff = new Date(Date.now() - RESEARCH_STALE_MS);
    const stuck = await prisma.researchJob.findMany({
      where: { status: "RUNNING", updatedAt: { lt: cutoff } },
      select: { id: true, ownerId: true, cardId: true },
    });
    let reaped = 0;
    for (const job of stuck) {
      // #463 per-row phase: the scan above is cross-tenant, these two writes are not.
      // The `await` MUST be INSIDE the async callback. A bare `prisma.x.op()` returns a lazy
      // PrismaPromise: `store.run` would hand it back and pop the frame before an outer `await`
      // dispatched it, so the query would run in the enclosing (tenant-less) frame.
      const { count } = await runAsTenant(job.ownerId, async () => {
        return await prisma.researchJob.updateMany({
          where: { id: job.id, ownerId: job.ownerId, status: "RUNNING", updatedAt: { lt: cutoff } },
          data: { status: "FAILED", error: RESEARCH_INTERRUPTED },
        });
      });
      if (count === 0) continue; // lost the claim (finished / concurrent sweep) — leave it alone
      await runAsTenant(job.ownerId, () => failResearchCard(job.cardId, job.ownerId, RESEARCH_INTERRUPTED));
      reaped++;
    }

    const queued = await prisma.researchJob.findMany({
      where: { status: "QUEUED", createdAt: { lt: cutoff } },
      select: { id: true, ownerId: true, cardId: true },
    });
    for (const job of queued) {
      if (await hasLiveResearchMessage(job.id)) continue;
      // #463 per-row phase (the pg-boss liveness check above is platform state, not tenant data).
      const { count } = await runAsTenant(job.ownerId, async () => {
        return await prisma.researchJob.updateMany({
          where: { id: job.id, ownerId: job.ownerId, status: "QUEUED", createdAt: { lt: cutoff } },
          data: { status: "FAILED", error: RESEARCH_NOT_STARTED },
        });
      });
      if (count === 0) continue;
      await runAsTenant(job.ownerId, () => failResearchCard(job.cardId, job.ownerId, RESEARCH_NOT_STARTED));
      reaped++;
    }
    return reaped;
  });
}
