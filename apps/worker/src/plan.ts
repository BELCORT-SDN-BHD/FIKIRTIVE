/**
 * #796 / #760 — 一个 worker 进程,两种角色。
 *
 * 以前:一个 Railway 服务跑全部七条队列,每条 `batchSize: 1`,全平台同时只生成一件。
 * 商家 A 的 15 分钟视频会把商家 B 的图片排在后面(#760)。
 *
 * 现在:同一份代码、同一个镜像,按 `WORKER_ROLE` 分成两种服务:
 *
 *   - `compute`(算力型):ingest / render / caption —— ffmpeg、ffprobe、whisper,吃 CPU 和内存。
 *     **进程内并发恒为 1**:这类活儿的扩容手段是加副本(每个副本一份 CPU 配额),
 *     不是在一个容器里塞更多 ffmpeg。720p 天花板就是这么被顶住的 —— 拆出去之后,
 *     算力服务可以单独调大容器,而不必把等待型服务一起养胖。
 *   - `wait`(等待型):gen / refgen / research / publish —— 绝大部分时间在 await 供应商,
 *     CPU 基本闲着。这类活儿在**一个进程内**并发 N 就够,不必加副本。
 *   - `all`(默认):两者都跑。**这是不设 `WORKER_ROLE` 时的行为**,所以现有单服务部署
 *     升上来之后不改任何环境变量也照常工作 —— 拆分是一次运维动作,不是一次代码切换。
 *
 * 并发只加在等待型队列上,原因见上;算力型固定 1。
 */
import {
  INGEST_QUEUE,
  RENDER_QUEUE,
  CAPTION_QUEUE,
  GEN_QUEUE,
  REFGEN_QUEUE,
  RESEARCH_QUEUE,
  PUBLISH_QUEUE,
} from "@fikirtive/core";

export const WORKER_ROLES = ["compute", "wait", "all"] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

/** CPU 型队列:ffmpeg / ffprobe / whisper。靠副本扩容,进程内恒为 1。 */
export const COMPUTE_QUEUES = [INGEST_QUEUE, RENDER_QUEUE, CAPTION_QUEUE] as const;
/** 等待型队列:绝大部分时间 await 外部供应商。靠进程内并发扩容。 */
export const WAIT_QUEUES = [GEN_QUEUE, REFGEN_QUEUE, RESEARCH_QUEUE, PUBLISH_QUEUE] as const;

/**
 * 供应商官方并发额度(2026-08-08 arkcli 实测:三个视频模型都是
 * `concurrent_requests: 10` / `create_task_rpm: 600`)。这是**整个账户**的额度,
 * 不是每进程的 —— gen 和 refgen 都打同一个账户,所以两条队列的并发要一起算。
 */
export const PROVIDER_CONCURRENT_REQUESTS = 10;
/** 留给重试、Otto 顺手发起的调用和突发的余量:实际可用 = 10 − 2 = 8。 */
export const PROVIDER_CONCURRENCY_HEADROOM = 2;
/** 打同一个供应商账户的队列 —— 预算要按它们的**和**来算。 */
export const PROVIDER_QUEUES = [GEN_QUEUE, REFGEN_QUEUE] as const;

/**
 * 等待型队列的默认并发。
 *
 * gen 4 + refgen 2 = 6,落在可用额度 8 以内并留了余量;research / publish 打的是别家
 * (LLM、Meta),各 2 是「一个商家的慢活不挡下一个商家」的最小值。全部可用环境变量覆盖
 * (#760 要求「建议可配置」),但改之前先读 `providerBudgetLine()` 打在启动日志里的那行算术。
 */
const WAIT_DEFAULTS: Record<string, number> = {
  [GEN_QUEUE]: 4,
  [REFGEN_QUEUE]: 2,
  [RESEARCH_QUEUE]: 2,
  [PUBLISH_QUEUE]: 2,
};

const CONCURRENCY_ENV: Record<string, string> = {
  [GEN_QUEUE]: "GEN_CONCURRENCY",
  [REFGEN_QUEUE]: "REFGEN_CONCURRENCY",
  [RESEARCH_QUEUE]: "RESEARCH_CONCURRENCY",
  [PUBLISH_QUEUE]: "PUBLISH_CONCURRENCY",
};

export type WorkerPlan = {
  role: WorkerRole;
  /** 这个角色要消费的队列 → 进程内并发。**不在表里的队列这个角色一概不消费。** */
  concurrency: Readonly<Record<string, number>>;
  /** 清道夫、发布调度器、夜间备份是否在这个角色里跑(只跑在一处,不能两个服务都跑一遍)。 */
  supervises: boolean;
  /** 这个角色的并发假设下,Prisma 连接池至少要多大(见 dbPoolPlan)。 */
  dbPoolFloor: number;
};

/** 未设 ⇒ `all`(保持既有单服务行为);设了但不认识 ⇒ 抛。**不猜**:猜错等于半个平台悄悄不干活。 */
export function parseWorkerRole(raw: string | undefined): WorkerRole {
  const value = (raw ?? "").trim();
  if (value === "") return "all";
  const found = WORKER_ROLES.find((r) => r === value);
  if (!found) {
    throw new Error(
      `WORKER_ROLE="${value}" is not a known role — expected one of ${WORKER_ROLES.join(" | ")} (unset = all)`,
    );
  }
  return found;
}

/** 正整数环境变量;缺省或非法 ⇒ 默认值。非法值只降级到默认,不静默变 0(0 = 这条队列没人消费)。 */
function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return n;
}

/**
 * 连接池下限:每条并发在途的活儿按 2 条连接算(一条跑普通查询、一条跑它自己的事务),
 * 再加 4 条给心跳、清道夫、发布调度器和备份这些定时器。
 *
 * 为什么必须算:等待型服务并发到 10 之后,如果连接池还停在默认 10,一个握着事务连接的
 * handler 去要第二条连接时会排在池子后面 —— 池子被别的 handler 占满时那就是死等。
 * 钱路上的事务尤其不能这样卡住。
 */
export function dbPoolFloorFor(totalConcurrency: number): number {
  return totalConcurrency * 2 + 4;
}

export function workerPlan(env: NodeJS.ProcessEnv = process.env): WorkerPlan {
  const role = parseWorkerRole(env.WORKER_ROLE);
  const concurrency: Record<string, number> = {};
  if (role === "compute" || role === "all") {
    // 固定 1:ffmpeg/whisper 是 CPU 型,进程内并发只会互相抢 CPU。扩容 = 加副本。
    for (const queue of COMPUTE_QUEUES) concurrency[queue] = 1;
  }
  if (role === "wait" || role === "all") {
    for (const queue of WAIT_QUEUES) {
      concurrency[queue] = positiveInt(env[CONCURRENCY_ENV[queue]!], WAIT_DEFAULTS[queue]!);
    }
  }
  const total = Object.values(concurrency).reduce((a, b) => a + b, 0);
  return {
    role,
    concurrency,
    // 清道夫扫的全是等待型队列的钱路行(gen/refgen/research/publish 的预扣与退款),
    // 发布调度器喂的也是等待型队列 —— 跟着 wait 走。compute 角色只跑心跳。
    supervises: role === "wait" || role === "all",
    dbPoolFloor: dbPoolFloorFor(total),
  };
}

/** 这个进程一次最多向供应商账户发起多少个并发请求。 */
export function providerConcurrency(plan: WorkerPlan): number {
  return PROVIDER_QUEUES.reduce((sum, queue) => sum + (plan.concurrency[queue] ?? 0), 0);
}

export function providerBudgetUsable(): number {
  return PROVIDER_CONCURRENT_REQUESTS - PROVIDER_CONCURRENCY_HEADROOM;
}

/**
 * 启动日志里那行算术。**无条件打印**,不做成「超了才警告」:额度是按账户算的,
 * 而副本数只有 Railway 知道 —— 沉默的检查会在多副本时骗人,一行明账不会。
 */
export function providerBudgetLine(plan: WorkerPlan): string {
  const per = providerConcurrency(plan);
  return (
    `[worker] provider concurrency: ${PROVIDER_QUEUES.map((q) => `${q} ${plan.concurrency[q] ?? 0}`).join(" + ")}` +
    ` = ${per} per replica; account budget ${PROVIDER_CONCURRENT_REQUESTS}` +
    ` (usable ${providerBudgetUsable()} after headroom ${PROVIDER_CONCURRENCY_HEADROOM}).` +
    ` Keep replicas × ${per} ≤ ${providerBudgetUsable()}.`
  );
}

/** 单个进程自己就已经超出可用额度 —— 这个不用知道副本数也能确定,所以这条才做成警告。 */
export function providerBudgetWarning(plan: WorkerPlan): string | null {
  const per = providerConcurrency(plan);
  if (per <= providerBudgetUsable()) return null;
  return (
    `[worker] WARNING: this process alone asks the provider for ${per} concurrent requests, ` +
    `above the usable budget ${providerBudgetUsable()} of ${PROVIDER_CONCURRENT_REQUESTS}. ` +
    `Lower GEN_CONCURRENCY / REFGEN_CONCURRENCY — over-budget requests come back as 429s, ` +
    `which merchants see as failed generations.`
  );
}

export type DbPoolPlan =
  /** 没人显式设过 ⇒ 我们按并发把默认值顶上去(要 set)。 */
  | { action: "default"; value: number; message: string }
  /** 运维显式设过但低于下限 ⇒ **不覆盖**(硬顶死数据库比池子小更糟),只大声说。 */
  | { action: "warn"; message: string }
  /** 够用 ⇒ 什么都不做。 */
  | { action: "keep" };

/**
 * `DB_POOL_MAX` 只在**没被显式设过**时由我们按并发定默认值。
 *
 * 为什么不覆盖显式值:那个数是按「副本数 × 每进程上限 ≤ 数据库预算」算出来的,
 * 只有运维知道副本数。我们替他调大,可能把整个数据库的连接顶爆 —— 那比池子偏小严重得多。
 */
export function dbPoolPlan(plan: WorkerPlan, env: NodeJS.ProcessEnv = process.env): DbPoolPlan {
  const raw = (env.DB_POOL_MAX ?? "").trim();
  if (raw === "") {
    return {
      action: "default",
      value: plan.dbPoolFloor,
      message: `[worker] DB_POOL_MAX unset — defaulting to ${plan.dbPoolFloor} for role "${plan.role}" (2 per concurrent job + 4 for timers)`,
    };
  }
  const current = Number(raw);
  if (Number.isFinite(current) && current >= plan.dbPoolFloor) return { action: "keep" };
  return {
    action: "warn",
    message:
      `[worker] WARNING: DB_POOL_MAX=${raw} is below the floor ${plan.dbPoolFloor} for role "${plan.role}" ` +
      `at this concurrency. Leaving your value alone (only you know the replica count), but concurrent jobs ` +
      `will queue on connections and a money transaction can sit behind them.`,
  };
}

/** 启动日志:这个服务到底在消费什么。别人排查「为什么我的任务没人干」时第一眼看的就是这行。 */
export function planSummary(plan: WorkerPlan): string {
  const queues = Object.entries(plan.concurrency)
    .map(([queue, n]) => `${queue}×${n}`)
    .join(", ");
  return `[worker] role=${plan.role} — consuming ${queues || "(nothing)"}; supervision(reapers, publish scheduler, nightly backup)=${plan.supervises ? "on" : "off"}`;
}
