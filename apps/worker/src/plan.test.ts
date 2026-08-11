/**
 * plan.test.ts — #796 的路由表。
 *
 * `plan.concurrency` 是**唯一**决定「这个进程消费哪些队列」的东西:index.ts 的 `consume()`
 * 在表里查不到就直接不注册消费者。所以「等待型服务不会去跑 ffmpeg」「算力型服务不会去
 * 扣钱」这两件事,证据就在这张表里。
 */
import { describe, it, expect } from "vitest";
import {
  COMPUTE_QUEUES,
  PROVIDER_CONCURRENT_REQUESTS,
  WAIT_QUEUES,
  dbPoolFloorFor,
  dbPoolPlan,
  parseWorkerRole,
  providerBudgetLine,
  providerBudgetWarning,
  providerConcurrency,
  providerBudgetUsable,
  workerPlan,
} from "./plan.js";

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

describe("workerPlan — which service consumes what", () => {
  it("compute takes ffmpeg/whisper work only, and never a money queue", () => {
    const plan = workerPlan({ WORKER_ROLE: "compute" } as NodeJS.ProcessEnv);
    expect(Object.keys(plan.concurrency).sort()).toEqual([...COMPUTE_QUEUES].sort());
    for (const queue of WAIT_QUEUES) expect(plan.concurrency[queue]).toBeUndefined();
    // Supervision (reapers = refunds, publish scheduler) belongs to exactly one service.
    expect(plan.supervises).toBe(false);
  });

  it("wait takes the provider-await queues only, and never ffmpeg", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    expect(Object.keys(plan.concurrency).sort()).toEqual([...WAIT_QUEUES].sort());
    for (const queue of COMPUTE_QUEUES) expect(plan.concurrency[queue]).toBeUndefined();
    expect(plan.supervises).toBe(true);
  });

  it("all (the default) consumes every queue — today's single service, unchanged", () => {
    const plan = workerPlan({} as NodeJS.ProcessEnv);
    expect(plan.role).toBe("all");
    expect(Object.keys(plan.concurrency).sort()).toEqual([...COMPUTE_QUEUES, ...WAIT_QUEUES].sort());
    expect(plan.supervises).toBe(true);
  });

  it("compute queues stay at 1 — CPU work scales by replicas, not by in-process concurrency", () => {
    const plan = workerPlan({} as NodeJS.ProcessEnv);
    for (const queue of COMPUTE_QUEUES) expect(plan.concurrency[queue]).toBe(1);
  });

  it("wait queues default above 1 — that IS #760: B's short job no longer sits behind A's video", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    for (const queue of WAIT_QUEUES) expect(plan.concurrency[queue]).toBeGreaterThan(1);
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
});

describe("provider concurrency budget (arkcli 2026-08-08: concurrent_requests 10)", () => {
  it("ships inside the account budget with headroom", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    expect(providerConcurrency(plan)).toBeLessThanOrEqual(providerBudgetUsable());
    expect(providerBudgetUsable()).toBeLessThan(PROVIDER_CONCURRENT_REQUESTS);
    expect(providerBudgetWarning(plan)).toBeNull();
  });

  it("counts gen and refgen together — one account, two queues", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait", GEN_CONCURRENCY: "3", REFGEN_CONCURRENCY: "2" } as NodeJS.ProcessEnv);
    expect(providerConcurrency(plan)).toBe(5);
  });

  it("warns when one process alone exceeds the usable budget", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait", GEN_CONCURRENCY: "20" } as NodeJS.ProcessEnv);
    expect(providerBudgetWarning(plan)).toMatch(/above the usable budget/);
  });

  it("always prints the arithmetic, including the replica multiplier operators must apply", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    expect(providerBudgetLine(plan)).toContain("Keep replicas ×");
  });
});

describe("DB pool floor", () => {
  it("grows with concurrency: 2 connections per in-flight job + 4 for the timers", () => {
    expect(dbPoolFloorFor(0)).toBe(4);
    expect(dbPoolFloorFor(10)).toBe(24);
  });

  it("the wait role needs more than the packages/db default of 10", () => {
    // The point of recomputing the pool (#760 item 3): at concurrency N the old default
    // would make concurrent handlers queue on connections, and a money transaction can
    // end up waiting behind them.
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    expect(plan.dbPoolFloor).toBeGreaterThan(10);
  });

  it("unset DB_POOL_MAX ⇒ we set the floor", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    const decision = dbPoolPlan(plan, {} as NodeJS.ProcessEnv);
    expect(decision).toMatchObject({ action: "default", value: plan.dbPoolFloor });
  });

  it("an explicit value below the floor is WARNED about, never overridden", () => {
    // Only the operator knows the replica count; silently raising the per-process ceiling
    // could exhaust the database's own connection budget, which is worse than a small pool.
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    const decision = dbPoolPlan(plan, { DB_POOL_MAX: "4" } as NodeJS.ProcessEnv);
    expect(decision.action).toBe("warn");
  });

  it("an explicit value at or above the floor is left alone silently", () => {
    const plan = workerPlan({ WORKER_ROLE: "wait" } as NodeJS.ProcessEnv);
    const decision = dbPoolPlan(plan, { DB_POOL_MAX: String(plan.dbPoolFloor) } as NodeJS.ProcessEnv);
    expect(decision.action).toBe("keep");
  });
});
