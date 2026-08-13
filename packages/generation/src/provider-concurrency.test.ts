/**
 * provider-concurrency.test.ts — #796 判官 r1 P1-1。
 *
 * 判词点破的是一个**假账**:r1 按「同时跑几个 job」对账户额度,而额度管的是「同时发几个请求」。
 * 所以这个文件测的是**真实 POST 的并发峰值**,不是任何一条算式。
 *
 * 最坏情况按判词给的形状复现:一个 wait 副本的 gen 4 个 job(每个 count=4)+ refgen 2 个 job
 * (每个 count=6)= 4×4 + 2×6 = **28 个付费请求**同时想出门。账户额度 10。
 * 断言:同时在途的请求峰值不超过闸门上限,而且 28 个请求一个不少地都发出去了(闸门是排队,
 * 不是丢弃 —— 丢一个请求就是丢一张商家已经付过预扣的图)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BytePlusProvider } from "./byteplus.js";
import {
  RequestGate,
  providerRequestGate,
  providerRequestLimit,
  PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT,
  PROVIDER_MAX_CONCURRENT_REQUESTS_ENV,
  __setProviderRequestGateForTests,
} from "./provider-concurrency.js";

/** 计数用的假 fetch:记录同时在途的请求数与峰值。 */
function makeCountingFetch(opts: { latencyMs?: number } = {}) {
  const state = { inFlight: 0, peak: 0, total: 0 };
  const fetchMock = vi.fn(async (url: unknown) => {
    const href = String(url);
    // 结果下载不是对生成 API 的调用,不该计入额度 —— 只数 ark 的生成请求。
    const counts = href.includes("/images/generations") || href.includes("/contents/generations/tasks");
    if (counts) {
      state.inFlight++;
      state.total++;
      if (state.inFlight > state.peak) state.peak = state.inFlight;
    }
    await new Promise((r) => setTimeout(r, opts.latencyMs ?? 15));
    if (counts) state.inFlight--;
    if (href.includes("/images/generations")) {
      return { ok: true, status: 200, json: async () => ({ data: [{ url: "https://cdn.test/out.png" }] }) } as unknown as Response;
    }
    // result download
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) } as unknown as Response;
  });
  return { state, fetchMock };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  __setProviderRequestGateForTests(undefined);
  delete process.env[PROVIDER_MAX_CONCURRENT_REQUESTS_ENV];
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  __setProviderRequestGateForTests(undefined);
  delete process.env[PROVIDER_MAX_CONCURRENT_REQUESTS_ENV];
});

describe("RequestGate", () => {
  it("从不让在途请求超过上限,而且一个等待者都不丢", async () => {
    const gate = new RequestGate(3);
    let done = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        gate.run(async () => {
          await new Promise((r) => setTimeout(r, 5));
          done++;
        }),
      ),
    );
    expect(gate.peakInFlight).toBeLessThanOrEqual(3);
    expect(done).toBe(20); // 排队,不是丢弃
    expect(gate.inFlight).toBe(0); // 每个位子都归还了
  });

  it("被包住的函数抛错也要归还位子(否则闸门会慢慢锁死自己)", async () => {
    const gate = new RequestGate(1);
    await expect(gate.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(gate.inFlight).toBe(0);
    await expect(gate.run(async () => "ok")).resolves.toBe("ok");
  });

  it("上限最低是 1 —— 0 会把闸门变成一堵永不打开的墙", () => {
    expect(new RequestGate(0).limit).toBe(1);
    expect(new RequestGate(-5).limit).toBe(1);
  });
});

/**
 * #796 判官 r2 P1-1 —— 交接窗口。
 *
 * r2 的实现在「归还 → 唤醒等待者」之间留了一条缝:归还先把计数减掉,被唤醒者要等下一轮
 * microtask 才加回来,同一轮里插进来的新请求就会占走那个空位,于是两个人各持一半、计数
 * 变成 limit+1。判官给的最小复现是 {limit:6, inFlight:7, peak:7}。
 *
 * r2 原有的 20/28 那两组全是「开头一次性入队」的形状 —— 所有请求在同一时刻到齐,之后只出
 * 不进,缝根本不会被踩到。所以下面补的是**持续流**:边释放边有新请求进来。
 */
describe("交接窗口:释放之后不许有人插队(判官 r2 P1-1)", () => {
  it("判官的最小复现形状:同步连续释放 + 同一轮里新请求插队,计数不得越过上限", async () => {
    const gate = new RequestGate(6);
    // 占满 6 个位子
    const held = [];
    for (let i = 0; i < 6; i++) held.push(await gate.acquire());
    expect(gate.inFlight).toBe(6);

    // 6 个等待者排队
    const waiters = Array.from({ length: 6 }, () => gate.acquire());
    expect(gate.inFlight).toBe(6);

    // 同一轮里:先同步释放全部 6 个,再立刻发起 6 个全新请求(就是那条缝)
    for (const release of held) release();
    const latecomers = Array.from({ length: 6 }, () => gate.acquire());

    // 让所有 microtask 跑完
    await Promise.resolve();
    await Promise.resolve();

    expect(gate.inFlight).toBeLessThanOrEqual(6);
    expect(gate.peakInFlight).toBeLessThanOrEqual(6);

    // 而且插队者确实还在排队 —— 位子归先到的等待者
    const grantedWaiters = await Promise.all(waiters);
    expect(grantedWaiters).toHaveLength(6);
    for (const release of grantedWaiters) release();
    for (const release of await Promise.all(latecomers)) release();
    expect(gate.inFlight).toBe(0);
  });

  it("持续流:每次归还紧跟着一个新到达(缝最容易被踩到的形状),全程峰值不越上限", async () => {
    // 关键是**紧邻**:每个任务一完成就在同一轮 microtask 里投放下一个,于是「归还」与
    // 「新请求到达」永远贴在一起 —— 正是判官说的那条缝。任务体只 await microtask,不用
    // 定时器,免得两件事被推到不同的宏任务里而错开。
    const gate = new RequestGate(4);
    let live = 0;      // 外部观测,不采信闸门自己的记账
    let peak = 0;
    let started = 0;
    let completed = 0;
    const TOTAL = 300;

    const spawn = (): Promise<void> => {
      if (started >= TOTAL) return Promise.resolve();
      started++;
      return gate
        .run(async () => {
          live++;
          if (live > peak) peak = live;
          await Promise.resolve();
          await Promise.resolve();
          live--;
        })
        .then(() => { completed++; return spawn(); });
    };

    await Promise.all(Array.from({ length: 9 }, () => spawn())); // 9 > limit 4 ⇒ 队列始终非空
    expect(completed).toBe(TOTAL); // 一个都没丢
    expect(peak).toBeLessThanOrEqual(4);
    expect(gate.peakInFlight).toBeLessThanOrEqual(4);
    expect(gate.inFlight).toBe(0);
  });

  it("持续流(定时器版):到达与完成互相穿插,峰值仍不越上限", async () => {
    const gate = new RequestGate(4);
    let live = 0;
    let peak = 0;
    let completed = 0;

    const task = (delayMs: number) =>
      gate.run(async () => {
        live++;
        if (live > peak) peak = live;
        await new Promise((r) => setTimeout(r, delayMs));
        live--;
        completed++;
      });

    const running: Promise<void>[] = [];
    for (let wave = 0; wave < 12; wave++) {
      for (let i = 0; i < 5; i++) running.push(task((wave + i) % 4));
      await new Promise((r) => setTimeout(r, 1));
    }
    await Promise.all(running);

    expect(completed).toBe(60);
    expect(peak).toBeLessThanOrEqual(4);
    expect(gate.inFlight).toBe(0);
  });

  it("上限 1 的极端形状:任何时刻都只有一个人在里面", async () => {
    const gate = new RequestGate(1);
    let live = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 30 }, () =>
        gate.run(async () => {
          live++;
          if (live > peak) peak = live;
          await new Promise((r) => setTimeout(r, 1));
          live--;
        }),
      ),
    );
    expect(peak).toBe(1);
    expect(gate.inFlight).toBe(0);
  });

  it("等待者排在插队者前面 —— 先来先得,不会有人被无限期饿死", async () => {
    const gate = new RequestGate(1);
    const order: string[] = [];
    const first = await gate.acquire();
    const second = gate.run(async () => { order.push("second"); });
    // 在 second 还在排队时又来一个
    const third = gate.run(async () => { order.push("third"); });
    first();
    await Promise.all([second, third]);
    expect(order).toEqual(["second", "third"]);
  });
});

describe("providerRequestLimit", () => {
  it("默认给足余量,低于账户额度 10", () => {
    expect(providerRequestLimit({} as NodeJS.ProcessEnv)).toBe(PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT);
    expect(PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT).toBeLessThan(10);
  });

  it("可配置;垃圾值退回默认而绝不退到 0", () => {
    expect(providerRequestLimit({ [PROVIDER_MAX_CONCURRENT_REQUESTS_ENV]: "8" } as NodeJS.ProcessEnv)).toBe(8);
    for (const junk of ["0", "-1", "abc", "2.5", ""]) {
      expect(providerRequestLimit({ [PROVIDER_MAX_CONCURRENT_REQUESTS_ENV]: junk } as NodeJS.ProcessEnv))
        .toBe(PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT);
    }
  });
});

describe("真实 POST 并发峰值(判官 P1-1 的最坏形状)", () => {
  it("gen 4 job×4 张 + refgen 2 job×6 张 = 28 个付费请求,峰值仍不过闸门上限", async () => {
    const { state, fetchMock } = makeCountingFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const provider = new BytePlusProvider("ark-test-key");

    // 同一个进程里的 gen 与 refgen —— 它们打的是同一个账户,所以必须共用同一个闸门。
    const genJobs = Array.from({ length: 4 }, () =>
      provider.generate({ prompt: "shop front", inputImageUrls: [], count: 4, model: "seedream" }));
    const refgenJobs = Array.from({ length: 2 }, () =>
      provider.generate({ prompt: "character sheet", inputImageUrls: [], count: 6, model: "seedream" }));

    const results = await Promise.all([...genJobs, ...refgenJobs]);

    expect(state.total).toBe(28);              // 28 个请求一个不少地发出去了
    expect(state.peak).toBeLessThanOrEqual(providerRequestGate().limit); // 但从没同时超过上限
    expect(state.peak).toBeLessThanOrEqual(PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT);
    expect(state.peak).toBeLessThan(10);       // 账户额度
    expect(results.flat()).toHaveLength(28);   // 每张图都拿回来了
  });

  it("按 job 槽位算出来的那个数(6)根本挡不住 —— 没有闸门时峰值就是 28", async () => {
    // The counter-example the judge's P1-1 is about: with the gate wide open, "gen 4 + refgen 2 = 6"
    // is not a ceiling on anything. Kept as a test so nobody re-derives the budget from job slots.
    __setProviderRequestGateForTests(new RequestGate(1_000));
    const { state, fetchMock } = makeCountingFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const provider = new BytePlusProvider("ark-test-key");

    await Promise.all([
      ...Array.from({ length: 4 }, () => provider.generate({ prompt: "p", inputImageUrls: [], count: 4, model: "seedream" })),
      ...Array.from({ length: 2 }, () => provider.generate({ prompt: "p", inputImageUrls: [], count: 6, model: "seedream" })),
    ]);

    expect(state.peak).toBe(28);
    expect(state.peak).toBeGreaterThan(6);
  });

  it("闸门是进程内单例 —— gen 与 refgen 拿到的是同一个", () => {
    expect(providerRequestGate()).toBe(providerRequestGate());
  });
});

/**
 * 供应商的视频轮询间隔是**真的 5 秒**(byteplus.ts 的 `#videoTask` 里那个 `setTimeout(5_000)`),
 * 而且整段轮询都跑在闸门的位子里。所以这一组用**假时钟**跑:时间由测试身体一格一格推,
 * 每推 5000ms 就等于给每个在途任务发一轮轮询。
 *
 * 这么写不只是为了快。老写法让「任务什么时候完成」取决于一场比赛 —— 假 fetch 里一个 1ms
 * 的定时器和测试身体里一个 5ms 的 flush 抢先,谁先到谁说了算,于是每一轮 5 秒都是一次掷硬币,
 * 尾巴长到能顶穿 40 秒超时。现在假 fetch 只**同步查表**:测试身体放行了就 succeeded,没放行
 * 就 running。没有比赛,也就没有偶发。
 */
describe("视频任务按整个任务占位,不是只占提交那一下", () => {
  // 假时钟只属于这一组。本文件其余用例全靠真定时器过日子,漏出去就是一片挂起。
  afterEach(() => { vi.useRealTimers(); });

  it("并发视频任务数不超过闸门上限,且轮询期间位子仍被占着", async () => {
    vi.useFakeTimers();
    __setProviderRequestGateForTests(new RequestGate(2));
    let submits = 0;
    let concurrentTasks = 0;
    let peakTasks = 0;
    /** 测试身体显式放行的任务 id —— 假 fetch 只读这张表,自己一个定时器都不起。 */
    const released = new Set<string>();

    globalThis.fetch = (async (url: unknown) => {
      const href = String(url);
      if (href.endsWith("/contents/generations/tasks")) {
        submits++;
        concurrentTasks++;
        if (concurrentTasks > peakTasks) peakTasks = concurrentTasks;
        return { ok: true, status: 200, json: async () => ({ id: `task-${submits}` }) } as unknown as Response;
      }
      const polled = href.match(/\/contents\/generations\/tasks\/(.+)$/);
      if (polled) {
        // 没被放行就一直报 running —— 那正是位子必须一直被占着的那段窗口。
        if (!released.has(polled[1]!)) {
          return { ok: true, status: 200, json: async () => ({ status: "running" }) } as unknown as Response;
        }
        concurrentTasks--;
        return { ok: true, status: 200, json: async () => ({ status: "succeeded", content: { video_url: "https://cdn.test/v.mp4" } }) } as unknown as Response;
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) } as unknown as Response;
    }) as unknown as typeof fetch;

    const provider = new BytePlusProvider("ark-test-key");
    const tasks = Array.from({ length: 4 }, () =>
      provider.generateVideo({ prompt: "move", imageUrl: "", durationSeconds: 5, model: "seedance-2-mini" }));
    // 先把汇总处理器挂上:万一中途某条断言先炸,这 4 个 promise 也不会变成没人接的拒绝。
    const settled = Promise.allSettled(tasks);

    // 起跑:闸门 2 个位子,所以同一时刻只可能存在 2 个任务。
    await vi.advanceTimersByTimeAsync(0);
    expect(submits).toBe(2);
    expect(concurrentTasks).toBe(2);

    // 整整两轮轮询过去,前两个任务都没被放行 —— 它们报 running,位子照旧被占着,
    // 于是第 3、4 个任务一个也提交不出去。这就是本用例真正要证的那句话:
    // 位子是按**整个任务**占的,不是只占提交那一下。
    await vi.advanceTimersByTimeAsync(5_000);
    expect(submits).toBe(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(submits).toBe(2);
    expect(concurrentTasks).toBe(2);
    expect(peakTasks).toBe(2);

    // 放行前两个:下一轮轮询它们读到 succeeded,下载完、归还位子,3、4 才轮得上。
    released.add("task-1");
    released.add("task-2");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(submits).toBe(4);
    expect(concurrentTasks).toBe(2); // 位子上换成了 3、4

    // 放行后两个收尾。全程假时间 20 秒,离 15 分钟的轮询死线远得很。
    released.add("task-3");
    released.add("task-4");
    await vi.advanceTimersByTimeAsync(5_000);

    const outcomes = await settled;
    expect(outcomes.map((o) => (o.status === "fulfilled" ? "ok" : String((o as PromiseRejectedResult).reason))))
      .toEqual(["ok", "ok", "ok", "ok"]);
    expect(submits).toBe(4);
    expect(peakTasks).toBeLessThanOrEqual(2);
    expect(concurrentTasks).toBe(0); // 位子全归还了
  });
});
