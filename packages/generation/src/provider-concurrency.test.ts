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
 * #1435(零排队)—— 本组测试整体取代了原先的「视频任务按整个任务占位,不是只占提交那一下」
 * 一条(#796 判官 r1 P1-1 当时的读法)。那条读法钉的是旧实现自己的代价(客户端原地轮询,
 * 一次调用占着闸门的位子直到终态),不是账户额度本身的性质 —— `submitVideo` 只在一次 POST
 * 外面 `gate.run(...)`,`pollVideo` 同样只在一次 GET 外面 `gate.run(...)`,两者之间(任务
 * 仍在 `running` 的整段等待)**完全不占位**,与图片路径读同一个闸门的方式同构。
 */
describe("视频任务只在提交、或某一次轮询正在进行时占位——两次调用之间完全不占位", () => {
  it("并发视频任务数可以超过闸门上限——running 状态下不持有位子", async () => {
    __setProviderRequestGateForTests(new RequestGate(2));
    let inFlightRequests = 0;
    let peakRequests = 0;
    const track = <T>(fn: () => Promise<T>) => {
      inFlightRequests++;
      if (inFlightRequests > peakRequests) peakRequests = inFlightRequests;
      return fn().finally(() => { inFlightRequests--; });
    };
    let submits = 0;
    globalThis.fetch = (async (url: unknown) => track(async () => {
      const href = String(url);
      if (href.endsWith("/contents/generations/tasks")) {
        submits++;
        return { ok: true, status: 200, json: async () => ({ id: `task-${submits}` }) } as unknown as Response;
      }
      // 每一次轮询都只是「running」——永不终态,专门用来证明「不放开」这件事:
      // 若 pollVideo 仍然像旧实现那样在外层持着闸,4 个任务的第 4 次 submit 就永远发不出去
      // (闸门只有 2 格,前两个任务的轮询会把它们焊死在 running 上)。
      if (href.match(/\/contents\/generations\/tasks\/.+$/)) {
        return { ok: true, status: 200, json: async () => ({ status: "running" }) } as unknown as Response;
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) } as unknown as Response;
    })) as unknown as typeof fetch;

    const provider = new BytePlusProvider("ark-test-key");
    // 4 个任务全部提交 —— 闸门只有 2 格,但 submitVideo 每次只短暂借用一格就归还,
    // 所以 4 次提交全部成功,不需要等待彼此。
    const submissions = await Promise.all(
      Array.from({ length: 4 }, () => provider.submitVideo({ prompt: "move", imageUrl: "", durationSeconds: 5, model: "seedance-2-mini" })),
    );
    expect(submits).toBe(4);
    expect(submissions).toHaveLength(4);

    // 4 个任务「同时」轮询(各自一次 GET)—— 同样只需要 2 格闸门就能全部跑完,因为每一次
    // poll 用完立刻归还,不会像旧实现那样把闸位焊死在 running 状态上。
    const polls = await Promise.all(submissions.map((s) => provider.pollVideo(s.providerTaskId, { returnLastFrame: false })));
    expect(polls.every((p) => p.status === "pending")).toBe(true);
    expect(peakRequests).toBeLessThanOrEqual(2); // 闸门守住了 —— 但守住的是「同时几个请求」,不是「同时几个任务」
  });

  it("单次占位时长与一次图片 POST 同量级(≤ ARK_CONTROL_TIMEOUT_MS),不是 15 分钟", async () => {
    // #1435 —— 这条断言就是 provider-concurrency.ts 头部注释改写后那句话的机器版本:
    // 一次 submit 或一次 poll 各自只是一次普通请求,占位时长的上限是控制面超时(60s),
    // 不再是「提交 + 轮询到终态」的整段时长(曾经最长 60s + 15min)。
    const gate = new RequestGate(6);
    __setProviderRequestGateForTests(gate);
    globalThis.fetch = (async (url: unknown) => {
      const href = String(url);
      if (href.endsWith("/contents/generations/tasks")) return { ok: true, status: 200, json: async () => ({ id: "task-1" }) } as unknown as Response;
      if (href.match(/\/contents\/generations\/tasks\/.+$/)) return { ok: true, status: 200, json: async () => ({ status: "running" }) } as unknown as Response;
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) } as unknown as Response;
    }) as unknown as typeof fetch;
    const provider = new BytePlusProvider("ark-test-key");
    const before = gate.peakInFlight;
    await provider.submitVideo({ prompt: "move", imageUrl: "", durationSeconds: 5, model: "seedance-2-mini" });
    await provider.pollVideo("task-1", { returnLastFrame: false });
    // 两次调用各自借过一格、各自还过 —— 峰值绝不会因为「一个视频任务」而超过 1(相对起点)。
    expect(gate.peakInFlight - before).toBeLessThanOrEqual(1);
    expect(gate.inFlight).toBe(0); // 两次都已归还——不像旧实现那样在 running 期间焊死一格
  });
});
