/**
 * health — /api/health 的纯逻辑(2026-07-04 盲区修复:监控服务的探测点)。
 * worker 心跳每 60s 一次;5 分钟无心跳 = stale(容忍部署重启窗口),无记录 = unknown。
 */
import { describe, it, expect } from "vitest";
import { bestEffort, singleFlight, workerStatus, workersHealth, WORKER_STALE_MS } from "../health";

describe("workerStatus", () => {
  const now = new Date("2026-07-04T12:00:00Z");

  it("unknown when no heartbeat row exists (fresh deploy, worker never started)", () => {
    expect(workerStatus(null, now)).toBe("unknown");
  });

  it("up when the heartbeat is fresh", () => {
    expect(workerStatus(new Date(now.getTime() - 60_000), now)).toBe("up");
  });

  it("up exactly at the stale boundary minus 1ms; stale at/after the boundary", () => {
    expect(workerStatus(new Date(now.getTime() - (WORKER_STALE_MS - 1)), now)).toBe("up");
    expect(workerStatus(new Date(now.getTime() - WORKER_STALE_MS), now)).toBe("stale");
    expect(workerStatus(new Date(now.getTime() - WORKER_STALE_MS * 10), now)).toBe("stale");
  });

  it("a clock-skewed FUTURE heartbeat still reads up (never false-alarm on skew)", () => {
    expect(workerStatus(new Date(now.getTime() + 60_000), now)).toBe("up");
  });
});

/** #796 判官 r1 P2-2 —— 拆成算力/等待两班之后,每班一行心跳。 */
describe("workersHealth", () => {
  const now = new Date("2026-08-11T12:00:00Z");
  const fresh = new Date(now.getTime() - 60_000);
  const old = new Date(now.getTime() - WORKER_STALE_MS - 1);

  it("没有任何一行 → unknown,而且不假装有班在跑", () => {
    expect(workersHealth([], now)).toEqual({ worker: "unknown", workers: {} });
  });

  it("逐班报活 —— 一班死了另一班盖不住它", () => {
    const out = workersHealth([{ id: "worker-compute", at: old }, { id: "worker-wait", at: fresh }], now);
    expect(out.workers).toEqual({ "worker-compute": "stale", "worker-wait": "up" });
  });

  it("顶层字段含义不变:至少一班活着就是 up", () => {
    // 取「最差」会在从 all 切到拆分之后永远报 stale(旧的 "worker" 行再没人写),
    // 那是一个纯粹的假警报。按班告警归 #793,数据在 workers 里已经摆好了。
    expect(workersHealth([{ id: "worker", at: old }, { id: "worker-wait", at: fresh }], now).worker).toBe("up");
    expect(workersHealth([{ id: "worker", at: old }], now).worker).toBe("stale");
  });
});

/**
 * #796 判官 r2 P1-2 —— 存活探针不许依赖下游。
 *
 * 从前 `/api/health` 直接 await 一次数据库查询,库不可达就回 503;而平台的**重启**探针
 * 指的正是这里。于是「数据库故障」会变成「重启还活着的 Web」,每一轮重启又跑三次迁移
 * 重试 —— 正好复活本票要消灭的那个重启循环。失败与挂住必须是同一个结果:不知道,但我活着。
 */
describe("bestEffort(存活探针的顺带读取)", () => {
  it("成功就返回值", async () => {
    await expect(bestEffort(async () => [1, 2, 3], 50)).resolves.toEqual([1, 2, 3]);
  });

  it("下游抛错 → null,**不抛**", async () => {
    await expect(bestEffort(async () => { throw new Error("db down"); }, 50)).resolves.toBeNull();
  });

  it("同步抛错也接得住(连接构造阶段就炸的形状)", async () => {
    await expect(bestEffort(() => { throw new Error("no DATABASE_URL"); }, 50)).resolves.toBeNull();
  });

  it("下游挂住 → 到点返回 null,不把探针一起拖住", async () => {
    const started = Date.now();
    // 永不 settle:池子耗尽 / 连接卡在 TCP 超时里就是这个形状
    await expect(bestEffort(() => new Promise(() => {}), 30)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("超时之后落单的拒绝被吞掉,不会变成 unhandledRejection", async () => {
    const seen: unknown[] = [];
    const onRejection = (e: unknown) => seen.push(e);
    process.on("unhandledRejection", onRejection);
    try {
      await bestEffort(() => new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 10)), 1);
      await new Promise((r) => setTimeout(r, 40));
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    expect(seen).toEqual([]);
  });
});

/**
 * #796 判官 r3 P2-1 —— 超时只是放弃等待,底层查询还挂着占一条连接。
 *
 * 判官造的形状:库持续挂住时,100 次探针 = 100 个永不结束的任务,一个「只读一行心跳」的
 * 端点反而把连接池压垮,顺手拖垮真正要用库的请求。single-flight 让这 100 次共享 1 次查询。
 */
describe("singleFlight(在途查询只许有一个)", () => {
  it("100 次并发调用只发起 1 次底层查询", async () => {
    let started = 0;
    const shared = singleFlight(async () => {
      started++;
      await new Promise((r) => setTimeout(r, 20));
      return "ok";
    });
    const results = await Promise.all(Array.from({ length: 100 }, () => shared()));
    expect(started).toBe(1);
    expect(results.every((r) => r === "ok")).toBe(true);
  });

  it("库挂住时也只积一个未结束的任务,不是一次探针一个", async () => {
    let started = 0;
    const shared = singleFlight(() => { started++; return new Promise<string>(() => {}); }); // 永不 settle
    // 100 次「探针」,每次都放弃等待(bestEffort 的行为)
    for (let i = 0; i < 100; i++) await bestEffort(shared, 1);
    expect(started).toBe(1); // ← 判官那个形状:此前会是 100
  });

  it("一趟结束之后,下一次调用会重新发起 —— 库恢复后不需要任何额外动作", async () => {
    let started = 0;
    const shared = singleFlight(async () => { started++; return started; });
    await shared();
    await shared();
    expect(started).toBe(2);
  });

  it("失败也算一趟结束:下一次会重试,而且不留下 unhandledRejection", async () => {
    const seen: unknown[] = [];
    const onRejection = (e: unknown) => seen.push(e);
    process.on("unhandledRejection", onRejection);
    try {
      let started = 0;
      const shared = singleFlight(async () => { started++; throw new Error(`boom ${started}`); });
      await expect(bestEffort(shared, 50)).resolves.toBeNull();
      await expect(bestEffort(shared, 50)).resolves.toBeNull();
      expect(started).toBe(2);
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    expect(seen).toEqual([]);
  });

  it("并发的调用者拿到的是同一个 promise(共享,不是各跑各的)", () => {
    const shared = singleFlight(() => new Promise<void>(() => {}));
    expect(shared()).toBe(shared());
  });
});
