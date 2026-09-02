/**
 * Fikirtive worker — long-lived pg-boss consumer (eng review D6/D9).
 *
 *   Postgres (pgboss schema) ──▶ ingest queue ──▶ hash verify → ffprobe → thumbs
 *
 * pg-boss v12 rules honored here: explicit createQueue() before work(),
 * own `pgboss` schema (excluded from Prisma migrations), generous
 * expireInSeconds for multi-GB jobs, idempotent handlers (content-hash keys).
 *
 * #796 — ONE image, TWO services. `WORKER_ROLE` decides which queues this process
 * consumes (see ./plan.ts): `compute` = ffmpeg/whisper work, `wait` = provider awaits,
 * `all` (the default, and today's single service) = both. Every queue is still CREATED
 * by every role — creation is idempotent and shares one policy object with apps/web, so
 * boot order can never leave two definitions of the same queue.
 */
import * as Sentry from "@sentry/node";
import { PgBoss } from "pg-boss";
import { QUEUES } from "./queues.js";
import { connectionBudgetLine, dbPoolPlan, planSummary, providerBudgetLine, providerBudgetWarning, workerPlan } from "./plan.js";
import { handleIngest, redispatchLostIngest, type IngestJobData } from "./jobs/ingest.js";
import { handleRender } from "./jobs/render.js";
import { handleRefGen, reapStaleRefGenJobs } from "./jobs/refgen.js";
import { handleGen, reapStaleGenJobs } from "./jobs/gen.js";
import { backfillCanvasBoards } from "./jobs/canvas-backfill.js";
import { reapStaleLlmReservations } from "./jobs/llm-reservation-reaper.js";
import { reapExpiredAuthVerifications } from "./jobs/auth-verification-reaper.js";
import { handleCaption } from "./jobs/caption.js";
import { handleResearch, reapStaleResearchJobs } from "./jobs/research.js";
import { checkLedgerConservation } from "./jobs/ledger-conservation.js";
import { reconcileStripePayments } from "./jobs/stripe-reconcile.js";
import {
  handleUnderstand,
  reapStaleUnderstanding,
  reapStaleUnderstandingReservations,
  scanAssetsNeedingUnderstanding,
} from "./jobs/understand.js";
import { handlePublish, reapStalePublishAttempts, scanDuePublishPosts } from "./jobs/publish.js";
import { maybeRunNightlyBackup } from "./db-backup.js";
import { publishChainWarning } from "./publish-env-check.js";
import { assertWorkerEnv } from "./boot-env.js";
import { startHeartbeat } from "./heartbeat.js";
import {
  RENDER_DLQ,
  RENDER_QUEUE_POLICY,
  REFGEN_DLQ,
  REFGEN_QUEUE_POLICY,
  GEN_DLQ,
  GEN_QUEUE_POLICY,
  CAPTION_DLQ,
  CAPTION_QUEUE_POLICY,
  RESEARCH_QUEUE,
  RESEARCH_DLQ,
  RESEARCH_QUEUE_POLICY,
  PUBLISH_QUEUE,
  PUBLISH_DLQ,
  PUBLISH_QUEUE_POLICY,
  UNDERSTAND_QUEUE,
  UNDERSTAND_DLQ,
  UNDERSTAND_QUEUE_POLICY,
  assetUnderstandingEnabled,
  understandingDailyBudgetUsd,
  type RenderJobData,
  type RefGenJobData,
  type GenJobData,
  type CaptionJobData,
  type ResearchJobData,
  type PublishJobData,
  type UnderstandJobData,
} from "@fikirtive/core";
import { pruneRateLimitCounters } from "@fikirtive/db/rate-limit";
import { runAsSystem } from "@fikirtive/db/principal";

// #797 env contract, fail-FAST: a production worker whose required configuration is missing, or
// whose values are the wrong shape, exits here instead of running jobs that will fail in odd
// places later. Outside production it only warns. (The fail-SOFT publish-chain check below asks
// a different question and stays.)
assertWorkerEnv();

// Long-lived worker prefers the DIRECT url — a persistent process gains nothing
// from PgBouncer and the direct path avoids pooler quirks (audit P3).
const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED;
if (!connectionString) {
  console.error("[worker] DATABASE_URL is not set — exiting");
  process.exit(1);
}

// #796 — which queues this process consumes, and at what concurrency. Computed BEFORE
// anything touches Prisma: `dbPoolPlan` may set DB_POOL_MAX, and packages/db reads that
// env var when it lazily builds the client on FIRST PROPERTY ACCESS (the lazy Proxy in
// packages/db/src/index.ts). Importing @fikirtive/db above does not build anything, so
// this block still lands first. Keep it that way.
const plan = (() => {
  try {
    return workerPlan(process.env);
  } catch (err) {
    // An unrecognised WORKER_ROLE is a deploy typo, and every wrong guess is silent: guess
    // "all" and two services double-consume every queue; guess "compute" and generation stops
    // platform-wide with nothing in the logs. Exit loudly instead.
    console.error(`[worker] ${err instanceof Error ? err.message : err} — exiting`);
    process.exit(1);
  }
})();
console.log(`[worker] ${planSummary(plan)}`);
{
  const budget = providerBudgetLine(plan, process.env);
  if (budget) console.log(budget);
  const warning = providerBudgetWarning(plan, process.env);
  if (warning) console.warn(warning);
  // Only a role that RAISED concurrency touches the pools; `all` (unset WORKER_ROLE) leaves both
  // exactly where merge-base left them (判官 r1 P0).
  const pool = dbPoolPlan(plan, process.env);
  if (pool.action === "default") { process.env.DB_POOL_MAX = String(pool.value); console.log(pool.message); }
  else if (pool.action === "warn") console.warn(pool.message);
  console.log(connectionBudgetLine(plan, process.env));
}

// L1 publish-chain contract (spec §四), fail-SOFT: a half-configured chain (some secrets set, one
// missing) would silently fail every publish as an opaque NEEDS_ATTENTION, so surface it LOUDLY at
// boot — by variable NAME, never value. Never exits: the chain is inert until Meta App Review, so a
// fully-unset chain is the normal pre-launch state and must not take the whole worker down.
{
  const warning = publishChainWarning(process.env);
  if (warning) console.warn(warning);
}

// Minimal error monitoring (closed-beta P0). No-op unless SENTRY_DSN is set.
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0, environment: process.env.NODE_ENV });
}
// Non-fatal capture (e.g. pg-boss errors) — log + report, keep running.
const captureError = (err: unknown) => { if (process.env.SENTRY_DSN) Sentry.captureException(err); };
// Fatal capture: a worker in an unknown state should crash (Railway restarts it) — the
// SAME default Node behavior, but flushed to Sentry first. (Adding a handler otherwise
// suppresses Node's default crash-on-fatal, which would leave a wedged process running.)
const fatal = (label: string) => (err: unknown) => {
  console.error(`[worker] ${label}:`, err);
  if (!process.env.SENTRY_DSN) { process.exit(1); return; }
  Sentry.captureException(err);
  void Sentry.flush(2000).catch(() => {}).finally(() => process.exit(1));
};
process.on("unhandledRejection", fatal("unhandledRejection"));
process.on("uncaughtException", fatal("uncaughtException"));

// Report UNEXPECTED job errors (provider/store/parse failures that throw) to Sentry, then
// rethrow so pg-boss still owns retry/fail bookkeeping. Expected "return-style" terminal
// FAILEDs (deleted project/shot/entity, etc.) don't throw and correctly stay out of Sentry.
async function runHandler<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (err) { captureError(err); throw err; }
}

const boss = new PgBoss({
  connectionString,
  schema: "pgboss",
  // #796 判官 r1 P1-3 — pg-boss opens its OWN pg.Pool (default max 10), entirely separate from
  // Prisma's. At `localConcurrency: N` this process runs N independent pollers, each fetching,
  // completing and maintaining on its own clock, so the default sits right at the edge. Sized
  // only for a role that raised concurrency; `all` and `compute` keep pg-boss's own default so
  // an unset WORKER_ROLE changes no connection count at all.
  ...(plan.pgBossPoolMax === null ? {} : { max: plan.pgBossPoolMax }),
});

boss.on("error", (err) => { console.error("[worker] pg-boss error:", err); captureError(err); });

async function main(): Promise<void> {
  await boss.start();

  await boss.createQueue(`${QUEUES.ingest}.dlq`);
  await boss.createQueue(QUEUES.ingest, {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 60 * 30, // multi-GB download + ffprobe headroom
    deadLetter: `${QUEUES.ingest}.dlq`,
  });
  await boss.createQueue(RENDER_DLQ);
  await boss.createQueue(QUEUES.render, { ...RENDER_QUEUE_POLICY });
  await boss.createQueue(REFGEN_DLQ);
  await boss.createQueue(QUEUES.refgen, { ...REFGEN_QUEUE_POLICY });
  await boss.createQueue(GEN_DLQ);
  await boss.createQueue(QUEUES.gen, { ...GEN_QUEUE_POLICY });
  await boss.createQueue(CAPTION_DLQ);
  await boss.createQueue(QUEUES.caption, { ...CAPTION_QUEUE_POLICY });
  await boss.createQueue(RESEARCH_DLQ);
  await boss.createQueue(RESEARCH_QUEUE, { ...RESEARCH_QUEUE_POLICY });
  // L1 publish queue (Seam 6): SAME policy object as web (apps/web/lib/queue.ts) so boot order
  // can't split them. The consumer (boss.work) + scheduler + reaper land in the publish-worker
  // energize slice; for now the queue exists but nothing produces to it (fail-closed, inert).
  await boss.createQueue(PUBLISH_DLQ);
  await boss.createQueue(PUBLISH_QUEUE, { ...PUBLISH_QUEUE_POLICY });
  // #784 素材理解:队列的**唯一**生产者是下面 supervise 里的扫描器 —— 商家永远不点「分析」。
  await boss.createQueue(UNDERSTAND_DLQ);
  await boss.createQueue(UNDERSTAND_QUEUE, { ...UNDERSTAND_QUEUE_POLICY });

  /**
   * Register ONE queue's consumer — but only if this role owns the queue (#796). The plan is
   * the single source of that decision: a queue missing from `plan.concurrency` gets no
   * consumer in this process, which is exactly how `compute` never touches a money queue and
   * `wait` never touches ffmpeg.
   *
   * `localConcurrency: n` (pg-boss 12.18.2) spawns n INDEPENDENT pollers for the queue, each
   * fetching and finishing one job on its own clock. That is the shape #760 needs: merchant B's
   * 20-second image is fetched, run and completed by its own poller while merchant A's 15-minute
   * video is still in flight. (`batchSize: n` + Promise.all — the shape the ticket sketched —
   * would also run n at once, but pg-boss does not fetch the NEXT batch until the whole current
   * batch resolves, so one long video would still hold the queue closed behind it for 15 minutes.
   * Same goal, and this is the version without the head-of-line trap.)
   *
   * includeMetadata: retryCount drives the FAILED-vs-requeue status decision in every handler.
   */
  const consume = async <T>(queue: string, run: (data: T, retryCount: number) => Promise<void>): Promise<void> => {
    const concurrency = plan.concurrency[queue];
    if (!concurrency) return; // not this role's queue
    await boss.work<T>(
      queue,
      { batchSize: 1, includeMetadata: true, localConcurrency: concurrency },
      async ([job]) => {
        if (!job) return;
        console.log(`[worker] ${queue} job ${job.id} start (try ${job.retryCount + 1})`, job.data);
        await runHandler(() => run(job.data, job.retryCount));
        console.log(`[worker] ${queue} job ${job.id} done`);
      },
    );
  };

  await consume<IngestJobData>(QUEUES.ingest, (data) => handleIngest(data));
  await consume<RenderJobData>(QUEUES.render, handleRender);
  await consume<RefGenJobData>(QUEUES.refgen, handleRefGen);
  await consume<GenJobData>(QUEUES.gen, handleGen);
  // $0 caption job ($0 — whisper.cpp only, NEVER the paid provider): SEPARATE queue from render
  // so a slow transcribe never blocks a render.
  await consume<CaptionJobData>(QUEUES.caption, handleCaption);
  // Otto deep research (research S3, the MONEY CORE): bounded search→read→synthesize agent,
  // metered by ONE withLlmBudget. retryLimit:0 (RESEARCH_QUEUE_POLICY) + a status CAS in
  // handleResearch make any redelivery a no-op — a failed run does NOT auto-retry into the spend.
  await consume<ResearchJobData>(RESEARCH_QUEUE, handleResearch);
  // L1 organic publish (spec §四A). One due, approved ScheduledPost per job → drives the shared
  // adapter orchestration. Fail-closed by construction: the scheduler below only enqueues posts
  // whose connection can publish RIGHT NOW, and the handler re-checks + triple-locks idempotency.
  await consume<PublishJobData>(PUBLISH_QUEUE, handlePublish);
  // #784 素材理解三件套。**是一条钱路**(MONEY-A9,2026-09-01 起按上传时刻的快照价计费;
  // 旧的「不碰商家余额、理解是平台成本」已随规格 §7.3 废止)。它仍然允许正常重试 ——
  // 防重不靠 retryLimit:0,靠 AssetUnderstanding 上的唯一约束 + QUEUED→RUNNING 的 CAS,
  // 再加钱侧那套 `(orgId, refId)` 台账终态恢复协议(见 jobs/understand.ts 文件头)。
  //
  // 返回值 = 要立刻接着跑的那一行(caption 认出这张图是菜单之后建出来的 doc-extract 行)。
  // 在这里发,而不是等下一轮扫描 —— 差别是商家的十分钟。send 失败也不丢:行还是 QUEUED,
  // 扫描器的重投窗口照样兜住它。
  await consume<UnderstandJobData>(UNDERSTAND_QUEUE, async (data, retryCount) => {
    const followUp = await handleUnderstand(data, retryCount);
    if (!followUp) return;
    await boss.send(UNDERSTAND_QUEUE, { understandingId: followUp } satisfies UnderstandJobData, {
      singletonKey: `understand:${followUp}`,
    });
  });

  // Heartbeat: the status panel's "worker alive" signal (appendix A) + the durable
  // liveness row /api/health reads (2026-07-04 可观测性盲区修复). A failed write is
  // logged but never crashes the worker — health degrades to "stale", which is the signal.
  // #463: platform-level row (WorkerHeartbeat has no tenant), written under a named system identity.
  //
  // #796 判官 r1 P2-2: the row id is PER ROLE. Two split services sharing one `"worker"` row would
  // let either one die invisibly — the survivor keeps the row fresh and /api/health keeps saying
  // "up" while half the platform's work has stopped. `all` still writes `"worker"`, so the unsplit
  // deployment (and everything reading that row today) is untouched.
  //
  // #797: the same row now also carries this deploy's identity (commit sha + config fingerprint),
  // so admin can see when web and worker are NOT the same deploy — see ./heartbeat.ts.
  //
  // #797 judge r3 P2: the interval + boot beat live in startHeartbeat so they are actually TESTED.
  // Inline here they were not: deleting the row id from either call kept both existing suites green.
  startHeartbeat(plan);

  // Reaper: jobs the worker hung/crashed on (no redelivery → the on-claim stale path
  // never runs) would sit GENERATING forever, holding the credit reservation and spinning
  // the UI. Sweep every 5 min — fail-close + refund + post a terminal message.
  let reaping = false; // re-entrancy guard — a long sweep must not overlap the next tick
  // #463: the whole tick carries a named system identity; each sub-reaper re-enters with its own
  // reason for its scan and with the row's tenant for each write (two-phase).
  const reap = async () => {
    if (reaping) return;
    reaping = true;
    try {
      await runAsSystem("worker-reaper-tick", async () => {
        const n = await reapStaleGenJobs();
        if (n) console.log(`[worker] reaped ${n} stale gen job(s)`);
        // #601: the LAST step of a delivered job — writing its cards onto the board — is
        // best-effort, so a merchant who was charged can still be looking at a half-empty board
        // if that write fell over. This is the retry behind it: money-free, it only re-runs the
        // same idempotent card writer for jobs whose board is provably incomplete.
        const cn = await backfillCanvasBoards();
        if (cn) console.log(`[worker] finished ${cn} incomplete canvas board(s)`);
        const rn = await reapStaleRefGenJobs();
        if (rn) console.log(`[worker] reaped ${rn} stale refgen job(s)`);
        const ln = await reapStaleLlmReservations();
        if (ln) console.log(`[worker] reaped ${ln} leaked LLM reservation(s)`);
        // #678: expired sign-in / verification / reset tokens. Nothing consumes them once they
        // lapse, and nothing used to delete them either, so the table only ever grew.
        const vn = await reapExpiredAuthVerifications();
        if (vn) console.log(`[worker] reaped ${vn} expired auth verification row(s)`);
        // #795: the same shape one table over. The rate-limit counters hold one row per (door ×
        // counted party × live window), and the public doors let an anonymous caller choose how
        // many of those exist — so without a sweep the table grows by one row per address anyone
        // has ever probed and never gives one back. Rides this tick because it is exactly the
        // same job: delete what is provably finished. (Better Auth prunes its own table.)
        const rl = await pruneRateLimitCounters();
        if (rl) console.log(`[worker] pruned ${rl} expired rate-limit counter(s)`);
        // Research: a worker SIGKILL'd mid-run (retryLimit:0 → no redelivery) strands the card
        // "Researching…" forever. Credits are already recovered by reapStaleLlmReservations above;
        // this flips the stranded RUNNING job → FAILED + its card → failed (pure UX, $0).
        const sn = await reapStaleResearchJobs();
        if (sn) console.log(`[worker] reaped ${sn} stale research job(s)`);
        // L1 publish (spec §四F): reconcile dangling APPLYING attempts (worker crashed mid-publish) —
        // query Meta's truth first, then PUBLISHED vs NEEDS_ATTENTION, never a blind re-post.
        const pn = await reapStalePublishAttempts();
        if (pn) console.log(`[worker] reconciled ${pn} dangling publish attempt(s)`);
        // F41(c): recover uploads whose ingest dispatch was lost (finalize commits
        // rows before the send). singletonKey dedupes while a re-send is in flight.
        const ri = await redispatchLostIngest((assetId) =>
          boss.send(QUEUES.ingest, { assetId } satisfies IngestJobData, { singletonKey: `ingest-recover:${assetId}` }),
        );
        if (ri) console.log(`[worker] re-dispatched ${ri} lost ingest job(s)`);
        // #784: understanding rows a crashed worker left RUNNING. Pure UX — it just returns them
        // to QUEUED and the scanner below re-delivers. A file half-read should be finished, not
        // abandoned. (The money half is the next sweep, not this one.)
        const un = await reapStaleUnderstanding();
        if (un) console.log(`[worker] returned ${un} interrupted understanding row(s) to the queue`);
        // MONEY-A9: understanding is a PAID action since 2026-09-01, so this chain now leaks holds
        // the same way Otto's does — a death between reserve and settle. Its own reaper (not the
        // LLM one: that sweep's refund also retires an approval card, which this chain has none of)
        // refunds the hold and returns the row it belonged to.
        const ur = await reapStaleUnderstandingReservations();
        if (ur) console.log(`[worker] refunded ${ur} leaked understanding reservation(s)`);
      });
    } catch (e) {
      console.error("[worker] reaper error:", e);
      captureError(e);
    } finally {
      reaping = false;
    }
  };
  // Nightly DB backup (P0-1②) rides the same 5-min tick: fail-soft by contract
  // (never throws), own re-entrancy flag inside the module, and its trigger rule
  // (KL >= 03:00 + key-not-in-R2) makes every extra call a cheap no-op.
  // #463: intentionally NOT wrapped in a principal frame — db-backup.ts makes zero Prisma
  // calls (pg_dump → R2). Do not flag it as a missing system context.
  //
  // #796: supervision runs in ONE role, never both. Everything it sweeps is a wait-type money
  // row (gen/refgen/research/publish holds, LLM reservations) so it rides the wait service; the
  // compute service only heartbeats. Two services both reaping would not corrupt anything — every
  // reaper write is a conditional CAS — but it would double the scan load and split the logs, and
  // "which service refunded this merchant" should have one answer.
  if (plan.supervises) {
    setInterval(() => { void reap(); void maybeRunNightlyBackup(); }, 5 * 60_000);
    void reap(); // also sweep once on startup (clears anything stranded by a prior crash)
    void maybeRunNightlyBackup(); // startup check too — a worker restart must not skip a missed night
  }

  // L1 publish scheduler (spec §四A): IG has no native scheduling, so we poll for due, approved
  // posts and enqueue them. The scan is canPublish-gated → before App Review it returns nothing,
  // so this is an inert no-op in prod (zero behavior change). singletonKey dedupes an id whose
  // previous publish is still in flight; the handler's triple idempotency is the real guard.
  let scheduling = false;
  // #463: the due-post scan spans every authorized tenant by design — a named system identity,
  // never a tenant one. The enqueue below carries only ids; the consumer resolves the owner.
  const schedule = async () => {
    if (scheduling) return;
    scheduling = true;
    try {
      await runAsSystem("publish-scheduler", async () => {
        const due = await scanDuePublishPosts();
        for (const scheduledPostId of due) {
          await boss.send(PUBLISH_QUEUE, { scheduledPostId } satisfies PublishJobData, { singletonKey: `publish:${scheduledPostId}` });
        }
        if (due.length) console.log(`[worker] enqueued ${due.length} due publish job(s)`);
      });
    } catch (e) {
      console.error("[worker] publish scheduler error:", e);
      captureError(e);
    } finally {
      scheduling = false;
    }
  };
  if (plan.supervises) {
    setInterval(() => void schedule(), 60_000);
    void schedule(); // sweep due posts once on startup too
  }

  // 钱路 M1-b ①:Stripe ↔ 账本对账。商家的钱进了 Stripe 而我们库里一行痕迹都没有(webhook
  // 掉了、签名密钥换了、路由 502),此前没有任何东西在看 —— 2026-08-17 那笔 RM25 是靠人肉
  // 发现的。这个扫描只报警、绝不补账:补账走 Stripe 后台重投,让同一条 webhook 路径带着同一
  // 把幂等键跑一次,「一次付款一行账」才仍然由数据库唯一约束保证。
  //
  // 半小时一轮(不是 5 分钟):它要打外部 API,而窗口是 48 小时 —— 慢一点不会漏掉任何东西,
  // 却省掉一天几百次的无谓调用。和 reaper 一样只在 supervise 的那一个角色上跑,不然两个服务
  // 会把同一笔缺口报两遍。
  let reconciling = false;
  const reconcileStripe = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      const r = await reconcileStripePayments();
      if (r.skipped) console.log(`[worker] stripe reconcile skipped: ${r.skipped}`);
      // 名单读不到 ⇒ 窗口外的老缺口这一轮没人看。它不是「没跑成」,但也绝不是「一切正常」。
      else if (r.trailUnreadable)
        console.error(
          `[worker] stripe reconcile: the open-gap list was UNREADABLE this sweep — only the 48h Stripe window was checked ` +
            `(${r.unreconciled} gap(s) there, ${r.alerted} alert(s) sent)`,
        );
      else if (r.unreconciled || r.tracked || r.unverified)
        // 两轮确认制:首见的只是观察(延迟到账的付款长得一模一样),确认过的才是真缺口。
        // `tracked` 是已经滑出 48 小时扫描窗、靠观察行名单继续追踪的那些(MONEY-A12):
        // 它可以在 unreconciled=0 的一轮里非零 —— 缺口老了,但没有了结。
        console.error(
          `[worker] stripe reconcile: ${r.unreconciled} PAID session(s) with no ledger entry (of ${r.paid} paid in the last 48h) — ` +
            `${r.firstSeen} first sighting(s) recorded but NOT alerted, ${r.alerted} alert(s) sent, ` +
            `${r.tracked} older gap(s) still open outside the window, ${r.unverified} recorded but NOT judged (ledger unreadable), ` +
            `${r.closed} observation(s) closed`,
        );
      else console.log(`[worker] stripe reconcile: ${r.paid} paid session(s) in the last 48h, all present in the ledger`);
    } catch (e) {
      // reconcileStripePayments 自己就不抛;这里是最后一道,免得一次意外把 worker 带下去。
      console.error("[worker] stripe reconcile error:", e);
      captureError(e);
    } finally {
      reconciling = false;
    }
  };
  if (plan.supervises) {
    setInterval(() => void reconcileStripe(), 30 * 60_000);
    void reconcileStripe(); // 开机也跑一轮:停机期间掉的 webhook 正是这个扫描存在的理由
  }

  // 钱路守恒巡检(规格 §5 变更登记 2026-09-02 顾问复审⑥)。「余额 = 流水之和」这条不变量
  // 此前只活在注释和单测里 —— 两个都在开发机上。这一趟每天按 org 重算一次,漂移三通道报警。
  // **只报不补**,理由同上面那个哨兵:补账是人的决定,自动化它就是在钱路上开第二个权威。
  //
  // 一天一轮(不是半小时):守恒破了就一直破着,不会自愈也不会在半小时内变得更严重,而全表
  // 聚合每半小时跑一次是白花的数据库钱。同 reconcile 只在 supervise 的角色上跑 —— 两个服务
  // 都跑会把同一笔漂移报两遍。
  let conserving = false;
  const conserveLedger = async () => {
    if (conserving) return;
    conserving = true;
    try {
      const r = await checkLedgerConservation();
      if (r.skipped) console.error(`[worker] ledger conservation skipped: ${r.skipped} — nothing was checked this sweep`);
      else if (r.drifted)
        console.error(
          `[worker] ledger conservation: ${r.drifted} org(s) whose balance disagrees with their ledger ` +
            `(${r.alerted} alerted); ${r.shortfallRows} settle(s) clamped in the last 24h totalling ${r.shortfallInternal} internal`,
        );
      else
        console.log(
          `[worker] ledger conservation: every org's balance matches its ledger; ` +
            `${r.shortfallRows} settle(s) clamped in the last 24h totalling ${r.shortfallInternal} internal`,
        );
    } catch (e) {
      // checkLedgerConservation 自己就不抛;这里是最后一道,免得一次意外把 worker 带下去。
      console.error("[worker] ledger conservation error:", e);
      captureError(e);
    } finally {
      conserving = false;
    }
  };
  if (plan.supervises) {
    setInterval(() => void conserveLedger(), 24 * 60 * 60_000);
    void conserveLedger(); // 开机也跑一轮:一次坏部署造成的漂移不该等到明天才被看见
  }

  // #784 asset understanding — the ONLY producer on UNDERSTAND_QUEUE, and deliberately so:
  // the merchant never presses "Analyse". This scan finds files nobody has read yet, claims
  // each one by CREATING its AssetUnderstanding row (the (ownerId, assetId, kind) unique index
  // IS the claim, so two replicas scanning at once can't double-read), and enqueues the claims.
  // A send that fails leaves the row QUEUED; the next scan past the redispatch window re-sends it.
  //
  // Rides the same supervision flag as the publish scheduler: one service produces, or the same
  // file gets claimed twice as often as it needs to be.
  let understanding = false;
  const readNewFiles = async () => {
    if (understanding) return;
    understanding = true;
    try {
      // #463: the scan spans every authorized tenant by design — the function opens its own named
      // system identity, and each row write inside it re-enters with that row's tenant.
      const ids = await scanAssetsNeedingUnderstanding();
      for (const understandingId of ids) {
        await boss.send(UNDERSTAND_QUEUE, { understandingId } satisfies UnderstandJobData, {
          singletonKey: `understand:${understandingId}`,
        });
      }
      if (ids.length) console.log(`[worker] queued ${ids.length} file(s) for understanding`);
    } catch (e) {
      console.error("[worker] understanding scan error:", e);
      captureError(e);
    } finally {
      understanding = false;
    }
  };
  if (plan.supervises) {
    // The cost account, printed once at boot so nobody has to derive it from the code. It is a
    // PLATFORM number in real dollars — "what can this cost us in a day" is a platform question,
    // so a per-merchant row count was never an answer to it.
    console.log(
      `[worker] asset understanding — platform spend ALERT line $${understandingDailyBudgetUsd(process.env).toFixed(2)} per day ` +
        `(${assetUnderstandingEnabled(process.env) ? "switch ON" : "switch OFF — paused, nothing is discarded"}). ` +
        `Since 2026-09-02 that line only ALERTS (founderAlert, at most once a day) and never blocks: merchants are ` +
        `billed per understood file at the price locked when its row is created (MONEY-A9), so their own balance is ` +
        `the real ceiling. Only the switch pauses reading — and it pauses, it does not discard.`,
    );
    // The interval is installed either way: the switch is re-read on EVERY scan, so flipping it
    // off pauses the reading instead of destroying whatever arrives while it is off.
    setInterval(() => void readNewFiles(), 60_000);
    void readNewFiles(); // read anything that arrived while we were down
  }

  console.log(`[worker] started — ${planSummary(plan)}`);
}

// Graceful shutdown: finish in-flight work, then release pg connections.
// Re-entry guard: signals are often delivered twice (process-group kills, tsx watch).
let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${sig} — shutting down`);
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
      process.exit(0);
    } catch (err) {
      console.error("[worker] shutdown error:", err);
      process.exit(1);
    }
  });
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
