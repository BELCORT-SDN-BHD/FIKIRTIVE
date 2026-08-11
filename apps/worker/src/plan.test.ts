/**
 * plan.test.ts — #796 的路由表。
 *
 * `plan.concurrency` 是**唯一**决定「这个进程消费哪些队列」的东西:index.ts 的 `consume()`
 * 在表里查不到就直接不注册消费者。所以「等待型服务不会去跑 ffmpeg」「算力型服务不会去
 * 扣钱」这两件事,证据就在这张表里。
 *
 * 判官 r1 P0 之后,这个文件还多了一份**回归基线**:不设 `WORKER_ROLE` 时,plan 必须与
 * merge-base 语义等价 —— 每条队列并发 1、两个连接池一个都不碰、supervision 照旧、
 * 心跳仍写 `"worker"` 那一行。抬并发是要人点头的动作,不是升级的副作用。
 */
import { describe, it, expect } from "vitest";
import {
  COMPUTE_QUEUES,
  LEGACY_QUEUE_CONCURRENCY,
  PGBOSS_POOL_DEFAULT,
  PRISMA_POOL_DEFAULT,
  PROVIDER_CONCURRENT_REQUESTS,
  WAIT_QUEUES,
  connectionBudgetLine,
  dbPoolFloorFor,
  dbPoolPlan,
  heartbeatIdFor,
  parseWorkerRole,
  pgBossPoolMaxFor,
  providerBudgetLine,
  providerBudgetWarning,
  providerBudgetUsable,
  touchesProvider,
  workerPlan,
} from "./plan.js";
import { PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT, PROVIDER_MAX_CONCURRENT_REQUESTS_ENV } from "@fikirtive/generation";

describe("parseWorkerRole", () => {
  it("unset ⇒ all — an existing single-service deploy keeps working with no env change", () => {
    expect(parseWorkerRole(undefined)).toBe("all");
    expect(parseWorkerRole("")).toBe("all");
    expect(parseWorkerRole("  ")).toBe("all");
  });

  it("throws on an unknown role rather than guessing", () => {
    // A typo'd role that silently fell back to "all" would double every queue's consumers
    // across two services; one that silently fell back to "compute" would stop generation
    // platform-wide with no error anywhere. Neither may be a guess.
    expect(() => parseWorkerRole("compute-heavy")).toThrow(/not a known role/);
    expect(() => parseWorkerRole("Wait")).toThrow(/not a known role/);
  });
});

/**
 * 判官 r1 P0 的回归基线。r1 的说法是「不设变量 = 今天的行为」,而当时的代码在 `all` 上
 * 直接开了新并发和新池默认值 —— 一次普通部署就会把等待型队列从 1 抬到 4/2/2/2、把 Prisma
 * 池从 10 抬到 30,而运维以为自己什么都没改。下面每一条都是 merge-base 的事实。
 */
describe("WORKER_ROLE 未设(all)必须与 merge-base 一字不差", () => {
  const plan = workerPlan({} as NodeJS.ProcessEnv);

  it("七条队列全在,每条并发都是 1(merge-base 的 batchSize:1)", () => {
    expect(plan.role).toBe("all");
    expect(Object.keys(plan.concurrency).sort()).toEqual([...COMPUTE_QUEUES, ...WAIT_QUEUES].sort());
    for (const [queue, n] of Object.entries(plan.concurrency)) {
      expect(`${queue}=${n}`).toBe(`${queue}=${LEGACY_QUEUE_CONCURRENCY}`);
    }
  });

  it("两个连接池一个都不碰", () => {
    expect(plan.raisesConcurrency).toBe(false);
    expect(plan.dbPoolFloor).toBeNull();   // Prisma:沿用 packages/db 的默认
    expect(plan.pgBossPoolMax).toBeNull(); // pg-boss:沿用它自己的默认
    expect(dbPoolPlan(plan, {} as NodeJS.ProcessEnv).action).toBe("keep");
  });

  it("supervision 照旧全开(merge-base 的清道夫/发布调度/夜间备份都在这一个进程里)", () => {
    expect(plan.supervises).toBe(true);
  });

  it('心跳仍写 "worker" —— /api/health 今天读的就是那一行', () => {
    expect(plan.heartbeatId).toBe("worker");
  });

  it("即使有人设了并发环境变量,未设 WORKER_ROLE 也不会被它抬起来", () => {
    // 抬并发是一个显式动作。GEN_CONCURRENCY 单独出现不足以构成那个动作。
    const withEnv = workerPlan({ GEN_CONCURRENCY: "8", REFGEN_CONCURRENCY: "6" } as NodeJS.ProcessEnv);
    expect(withEnv.concurrency.gen).toBe(LEGACY_QUEUE_CONCURRENCY);
    expect(withEnv.concurrency.refgen).toBe(LEGACY_QUEUE_CONCURRENCY);
    expect(withEnv.raisesConcurrency).toBe(false);
  });
});

describe("workerPlan — which service consumes what", () => {
  it("compute takes ffmpeg/whisper work only, and never a money queue", () => {
    const plan = workerPlan({ WORKER_ROLE: "compute" } as NodeJS.ProcessEnv);
    expect(Object.keys(plan.concurrency).sort()).toEqual([...COMPUTE_QUEUES].sort());
    for (const queue of WAIT_QUEUES) expect(plan.concurrency[queue]).toBeUndefined();
    // Supervision (reapers = refunds, publish scheduler) belongs to exactly one service.
    expect(plan.supervises).toBe(false);
    // CPU work stays at 1 → nothing was raised → no pool is touched here either.
    expect(plan.raisesConcurrency).toBe(false);
    expect(plan.dbPoolFloor).toBeNull();
    expect(plan.pgBossPoolMax).toBeNull();
  });

  it("wait takes the provider-await queues only, and never ffmpeg", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    expect(Object.keys(plan.concurrency).sort()).toEqual([...WAIT_QUEUES].sort());
    for (const queue of COMPUTE_QUEUES) expect(plan.concurrency[queue]).toBeUndefined();
    expect(plan.supervises).toBe(true);
  });

  it("compute queues stay at 1 — CPU work scales by replicas, not by in-process concurrency", () => {
    const plan = workerPlan({ WORKER_ROLE: "compute" } as NodeJS.ProcessEnv);
    for (const queue of COMPUTE_QUEUES) expect(plan.concurrency[queue]).toBe(1);
  });

  it("wait 才把并发抬上去 —— 那就是 #760:B 的短活不再排在 A 的长视频后面", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    for (const queue of WAIT_QUEUES) expect(plan.concurrency[queue]).toBeGreaterThan(1);
    expect(plan.raisesConcurrency).toBe(true);
  });

  it("wait concurrency is configurable per queue", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait", GEN_CONCURRENCY: "6" } as NodeJS.ProcessEnv);
    expect(plan.concurrency.gen).toBe(6);
  });

  it("a junk concurrency value falls back to the default, never to 0", () => {
    // 0 would mean "nobody consumes this queue" — a paid job would sit QUEUED until the
    // reaper refunded it. A typo must never be able to say that.
    for (const junk of ["0", "-2", "abc", "2.5", ""]) {
      const plan = workerPlan({ WORKER_ROLE: "wait", GEN_CONCURRENCY: junk } as NodeJS.ProcessEnv);
      expect(plan.concurrency.gen).toBeGreaterThanOrEqual(1);
    }
  });

  it("心跳按角色分行 —— 一班死了不会被另一班盖住(判官 P2-2)", () => {
    expect(heartbeatIdFor("all")).toBe("worker");
    expect(heartbeatIdFor("compute")).toBe("worker-compute");
    expect(heartbeatIdFor("wait")).toBe("worker-wait");
    expect(new Set([heartbeatIdFor("compute"), heartbeatIdFor("wait")]).size).toBe(2);
  });
});

/**
 * 判官 r1 P1-1:账户额度管的是**请求**,不是任务槽位。一个图片任务会为每张图各发一个付费
 * 请求,所以任何按槽位算出来的「预算」都是假账。真正的上限由 @fikirtive/generation 的
 * 进程内闸门按请求执行(证据在 packages/generation/src/provider-concurrency.test.ts,
 * 那里测的是真实 POST 的并发峰值),这里只负责把同一个数如实报出来。
 */
describe("供应商预算按请求口径报账(判官 P1-1)", () => {
  const waitPlan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);

  it("默认上限低于账户可用额度", () => {
    expect(PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT).toBeLessThanOrEqual(providerBudgetUsable());
    expect(providerBudgetUsable()).toBeLessThan(PROVIDER_CONCURRENT_REQUESTS);
    expect(providerBudgetWarning(waitPlan, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("报的是请求上限,而且明说槽位不构成上限", () => {
    const line = providerBudgetLine(waitPlan, {} as NodeJS.ProcessEnv)!;
    expect(line).toContain("provider REQUESTS");
    expect(line).toContain(String(PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT));
    expect(line).toMatch(/Job slots do NOT bound this/);
    expect(line).toContain("Keep replicas ×"); // 副本数的乘法仍然要人来做
  });

  it("上限调过头会警告", () => {
    const line = providerBudgetWarning(waitPlan, { [PROVIDER_MAX_CONCURRENT_REQUESTS_ENV]: "20" } as NodeJS.ProcessEnv);
    expect(line).toMatch(/above the usable budget/);
  });

  it("算力角色不打供应商,不报这行", () => {
    const plan = workerPlan({ WORKER_ROLE: "compute" } as NodeJS.ProcessEnv);
    expect(touchesProvider(plan)).toBe(false);
    expect(providerBudgetLine(plan, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(providerBudgetWarning(plan, {} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("连接预算:Prisma 与 pg-boss 两个池都要进账(判官 P1-3)", () => {
  it("Prisma 池下限随并发增长", () => {
    expect(dbPoolFloorFor(0)).toBe(4);
    expect(dbPoolFloorFor(10)).toBe(24);
  });

  it("pg-boss 自己那个池也随并发增长 —— 每个轮询器一条 + 维护余量", () => {
    expect(pgBossPoolMaxFor(10)).toBeGreaterThan(PGBOSS_POOL_DEFAULT);
  });

  it("wait 角色两个池都显式配置,而且都高于各自的默认", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    expect(plan.dbPoolFloor).toBeGreaterThan(PRISMA_POOL_DEFAULT);
    expect(plan.pgBossPoolMax).toBeGreaterThan(PGBOSS_POOL_DEFAULT);
  });

  it("明账把两个池加在一起报,并点名副本数与 web 也要算进去", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    const line = connectionBudgetLine(plan, {} as NodeJS.ProcessEnv);
    expect(line).toContain("prisma");
    expect(line).toContain("pg-boss");
    expect(line).toContain(String(plan.dbPoolFloor! + plan.pgBossPoolMax!));
    expect(line).toMatch(/max_connections/);
  });

  it("未抬并发的角色报的就是两边的默认值(与 merge-base 相同)", () => {
    const line = connectionBudgetLine(workerPlan({} as NodeJS.ProcessEnv), {} as NodeJS.ProcessEnv);
    expect(line).toContain(`prisma ${PRISMA_POOL_DEFAULT} + pg-boss ${PGBOSS_POOL_DEFAULT}`);
  });

  it("unset DB_POOL_MAX + 抬了并发 ⇒ 我们设下限", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    expect(dbPoolPlan(plan, {} as NodeJS.ProcessEnv)).toMatchObject({ action: "default", value: plan.dbPoolFloor });
  });

  it("显式设得比下限低 ⇒ 只警告,绝不覆盖", () => {
    // Only the operator knows the replica count; silently raising the per-process ceiling
    // could exhaust the database's own connection budget, which is worse than a small pool.
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    expect(dbPoolPlan(plan, { DB_POOL_MAX: "4" } as NodeJS.ProcessEnv).action).toBe("warn");
  });

  it("显式设得够大 ⇒ 一声不吭", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    expect(dbPoolPlan(plan, { DB_POOL_MAX: String(plan.dbPoolFloor) } as NodeJS.ProcessEnv).action).toBe("keep");
  });
});
