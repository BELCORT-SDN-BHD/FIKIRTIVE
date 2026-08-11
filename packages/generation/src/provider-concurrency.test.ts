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

describe("视频任务按整个任务占位,不是只占提交那一下", () => {
  it("并发视频任务数不超过闸门上限,且轮询期间位子仍被占着", async () => {
    __setProviderRequestGateForTests(new RequestGate(2));
    let submits = 0;
    let concurrentTasks = 0;
    let peakTasks = 0;
    const release: (() => void)[] = [];

    globalThis.fetch = (async (url: unknown) => {
      const href = String(url);
      if (href.endsWith("/contents/generations/tasks")) {
        submits++;
        concurrentTasks++;
        if (concurrentTasks > peakTasks) peakTasks = concurrentTasks;
        return { ok: true, status: 200, json: async () => ({ id: `task-${submits}` }) } as unknown as Response;
      }
      if (href.includes("/contents/generations/tasks/")) {
        // Stay "running" until this task is explicitly released — that is the window in which the
        // account slot must remain held.
        const finished = await new Promise<boolean>((resolve) => { release.push(() => resolve(true)); setTimeout(() => resolve(false), 1); });
        if (!finished) return { ok: true, status: 200, json: async () => ({ status: "running" }) } as unknown as Response;
        concurrentTasks--;
        return { ok: true, status: 200, json: async () => ({ status: "succeeded", content: { video_url: "https://cdn.test/v.mp4" } }) } as unknown as Response;
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) } as unknown as Response;
    }) as unknown as typeof fetch;

    const provider = new BytePlusProvider("ark-test-key");
    // 4 tasks over 2 slots = two rounds. The poll interval inside the provider is 5s, so this
    // suite is inherently a ~10s wall-clock test; the generous timeout below is for CI load,
    // not for a slow assertion.
    const tasks = Array.from({ length: 4 }, () =>
      provider.generateVideo({ prompt: "move", imageUrl: "", durationSeconds: 5, model: "seedance-2-mini" }));

    // Let the first batch submit and start polling, then let everything finish.
    await new Promise((r) => setTimeout(r, 60));
    expect(submits).toBeLessThanOrEqual(2); // only two tasks may exist at once
    for (const r of release.splice(0)) r();
    const flush = setInterval(() => { for (const r of release.splice(0)) r(); }, 5);
    await Promise.all(tasks);
    clearInterval(flush);

    expect(submits).toBe(4);
    expect(peakTasks).toBeLessThanOrEqual(2);
  }, 40_000);
});
