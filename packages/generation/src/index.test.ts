import { describe, it, expect, afterEach, vi } from "vitest";
import {
  EXECUTED_SPEC, GEN_IMAGE_ASPECTS, GEN_IMAGE_SIZES,
  imageAspectHonoured, imageCoherentSetHonoured, buildSpecChips, conditioningCap, videoElementReferencesHonoured,
  videoStartFrameHonoured, VIDEO_START_FRAME_CHIP,
  type GenVideoModel,
} from "@fikirtive/core";
import { createGenerationProvider, MockProvider } from "./index.js";

/** Read a PNG's IHDR width/height — the only way to prove the mock really produced
 *  the requested shape (rather than a table lookup asserting itself). */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("createGenerationProvider factory", () => {
  afterEach(() => {
    delete process.env.GENERATION_PROVIDER;
    delete process.env.BYTEPLUS_API_KEY;
  });

  it("GENERATION_PROVIDER=byteplus → BytePlusProvider", () => {
    process.env.GENERATION_PROVIDER = "byteplus";
    process.env.BYTEPLUS_API_KEY = "ark-x";
    expect(createGenerationProvider().name).toBe("byteplus");
  });

  it("byteplus without a key throws", () => {
    process.env.GENERATION_PROVIDER = "byteplus";
    delete process.env.BYTEPLUS_API_KEY;
    expect(() => createGenerationProvider()).toThrow(/BYTEPLUS_API_KEY/);
  });

  it("unset → mock", () => {
    expect(createGenerationProvider().name).toBe("mock");
  });
});

// ---------------------------------------------------------------------------
// #642 mock 供应商按请求画幅出图 —— 否则画幅回归在离线路径上根本测不出来
// (worker/web 的端到端测试全都跑 mock;固定 8×8 方图会把任何形状缺陷藏起来)
// ---------------------------------------------------------------------------
describe("MockProvider — 按请求画幅出图", () => {
  it("不带画幅 → 方图(宽高比 1:1)", async () => {
    const [img] = await new MockProvider().generate({ prompt: "p", inputImageUrls: [], count: 1, model: "seedream" });
    const { width, height } = pngSize(img!.bytes);
    expect(width / height).toBe(1);
  });

  it("每一个菜单画幅都出**精确**同比例的图(零容差,整数约分逐档比对)", async () => {
    const reduce = (a: number, b: number): [number, number] => {
      const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
      const g = gcd(a, b);
      return [a / g, b / g];
    };
    for (const aspect of GEN_IMAGE_ASPECTS) {
      const [img] = await new MockProvider().generate({
        prompt: "p", inputImageUrls: [], count: 1, model: "seedream", aspectRatio: aspect,
      });
      const got = pngSize(img!.bytes);
      const want = GEN_IMAGE_SIZES[aspect];
      // 离线出的图与真适配器会发的 WxH 精确同比例 —— 「差不多」在这里也不算数。
      expect(reduce(got.width, got.height), aspect).toEqual(reduce(want.width, want.height));
      expect(got.width, `${aspect} 宽`).toBeGreaterThan(0);
      expect(got.height, `${aspect} 高`).toBeGreaterThan(0);
    }
  });

  it("默认方图仍是 8×8 —— 与 #642 之前的 mock 逐字节一致(内容哈希不平白翻新)", async () => {
    const [img] = await new MockProvider().generate({ prompt: "p", inputImageUrls: [], count: 1, model: "seedream" });
    expect(pngSize(img!.bytes)).toEqual({ width: 8, height: 8 });
  });

  it("同一画幅下每张图的字节仍然互不相同(内容寻址不会塌成一张)", async () => {
    const out = await new MockProvider().generate({
      prompt: "p", inputImageUrls: [], count: 3, model: "seedream", aspectRatio: "9:16",
    });
    const hashes = new Set(out.map((o) => Buffer.from(o.bytes).toString("base64")));
    expect(hashes.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// #642 修复轮 r1 P2 —— 披露判据 ↔ 真适配器实际行为(跨包 lockstep)
//
// 卡面文案问的是 `imageAspectHonoured()`(@fikirtive/core)。ADR 0003
// (docs/adr/0003-single-provider-byteplus.md)之后 byteplus 是唯一的付费适配器,
// 这里把它真正发出去的请求体拿出来对表:声称兑现的,请求体里必须真有那个形状。
// ---------------------------------------------------------------------------
describe("#642 imageAspectHonoured() ↔ 适配器实际发出去的东西", () => {
  const PORTRAIT = "9:16";
  const want = GEN_IMAGE_SIZES[PORTRAIT];

  /** 真跑一次该 provider 的图片生成,回答「这一趟真的按 9:16 走了吗」。 */
  async function adapterReallyHonoursShape(providerName: string): Promise<boolean> {
    process.env.GENERATION_PROVIDER = providerName;
    if (providerName === "byteplus") process.env.BYTEPLUS_API_KEY = "ark-test";
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("/images/generations")) {
        body = JSON.parse(init!.body!);
        return {
          ok: true, status: 200,
          json: async (): Promise<unknown> => ({ data: [{ url: "https://x/y.png" }] }),
          text: async (): Promise<string> => "",
        };
      }
      return { ok: true, status: 200, arrayBuffer: async (): Promise<ArrayBuffer> => new Uint8Array([1]).buffer, text: async (): Promise<string> => "" };
    }));
    try {
      const out = await createGenerationProvider().generate({
        prompt: "p", inputImageUrls: [], count: 1, model: "seedream", aspectRatio: PORTRAIT,
      });
      // mock 不发网络请求 —— 它的「发出去的东西」就是那张图本身。
      if (providerName !== "byteplus") {
        const got = pngSize(out[0]!.bytes);
        return got.width * want.height === got.height * want.width;
      }
      // 网络适配器:请求体里有没有把这个形状真的编出去。
      return JSON.stringify(body ?? {}).includes(`${want.width}x${want.height}`)
        || JSON.stringify(body ?? {}).includes(`"width":${want.width}`);
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it.each(["byteplus", "mock"])(
    "%s:披露判据与这个适配器的实际行为逐字一致",
    async (providerName) => {
      const prev = process.env.GENERATION_PROVIDER;
      try {
        const actual = await adapterReallyHonoursShape(providerName);
        const claimed = imageAspectHonoured();
        expect(claimed, `${providerName}: 披露说 ${claimed},适配器实际 ${actual}`).toBe(actual);
      } finally {
        if (prev === undefined) delete process.env.GENERATION_PROVIDER;
        else process.env.GENERATION_PROVIDER = prev;
        delete process.env.BYTEPLUS_API_KEY;
      }
    },
  );
});

// ---------------------------------------------------------------------------
// #785 判官 r1 P1 —— 元素照的披露判据 ↔ 适配器对元素照的实际处置(跨包 lockstep)
//
// 与上面那组画幅 lockstep 同一个病、同一把尺子。判据是
// `videoElementReferencesHonoured()`,而且它同时喂**选片名额**(`conditioningCap`)——
// 「说几张」与「送几张」于是共用一个开关,不可能分家。
// ---------------------------------------------------------------------------
describe("#785 videoElementReferencesHonoured() ↔ 适配器对元素照的实际处置", () => {
  const PHOTOS = ["https://r2/product.png", "https://r2/face.png", "https://r2/logo.png"];
  const VIDEO_PARAMS = { aspectRatio: "16:9", resolution: "720p", durationSeconds: 5, audio: false, count: 1 };

  /** 真跑一次这一趟会跑的那个适配器,回答两件事:它拒了吗、它真把几张编进请求体了。 */
  async function sendPlan(refImageUrls: string[]): Promise<{ refused: boolean; carried: number }> {
    let body: unknown;
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      // byteplus:提交(POST)→ 轮询 → 下载
      if (u.includes("/contents/generations/tasks") && init?.method === "POST") {
        body = JSON.parse(init.body!);
        return { ok: true, status: 200, json: async (): Promise<unknown> => ({ id: "cgt-785" }), text: async (): Promise<string> => "" };
      }
      if (u.includes("/contents/generations/tasks/")) {
        return { ok: true, status: 200, json: async (): Promise<unknown> => ({ status: "succeeded", content: { video_url: "https://x/v.mp4" } }), text: async (): Promise<string> => "" };
      }
      return { ok: true, status: 200, arrayBuffer: async (): Promise<ArrayBuffer> => new Uint8Array([1]).buffer, text: async (): Promise<string> => "" };
    }));
    // 拒绝的那一格拒得很早(付费前),所以捕获必须**当场**挂上 —— 先 runAllTimersAsync
    // 再 await,那个 reject 会先变成一条 unhandled rejection。
    let refused = false;
    try {
      const promise = createGenerationProvider().generateVideo({
        prompt: "our product on a beach", imageUrl: "", durationSeconds: 5,
        model: "seedance-2-mini" as GenVideoModel,
        ...(refImageUrls.length ? { refImageUrls } : {}),
      }).catch(() => { refused = true; });
      await vi.runAllTimersAsync();
      await promise;
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
    if (refused) return { refused: true, carried: 0 }; // 这条路上元素照一张也上不了车
    const sent = JSON.stringify(body ?? {});
    return { refused: false, carried: PHOTOS.filter((u) => sent.includes(u)).length };
  }

  /** 这一格用的那个 provider 装上,跑完再原样放回。 */
  async function withProvider<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = process.env.GENERATION_PROVIDER;
    process.env.GENERATION_PROVIDER = name;
    if (name === "byteplus") process.env.BYTEPLUS_API_KEY = "ark-test";
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.GENERATION_PROVIDER;
      else process.env.GENERATION_PROVIDER = prev;
      delete process.env.BYTEPLUS_API_KEY;
    }
  }

  it("带元素照时,卡面承诺、选片名额与适配器的实际处置三者一致", async () => {
    await withProvider("byteplus", async () => {
      const claimed = videoElementReferencesHonoured();
      const sent = await sendPlan(PHOTOS);

      // 承诺得起 ⇒ 这条路真的把每一张都编进了请求体。
      expect(sent.refused, `披露说会用,适配器却拒了`).toBe(false);
      expect(sent.carried).toBe(PHOTOS.length);
      // 名额与卡面读的是同一个判据 —— 不许一边说三张、一边送零张。
      expect(conditioningCap({ kind: "video" }) > 0).toBe(claimed);
      const chips = buildSpecChips("video", VIDEO_PARAMS, false, false, { elementReferenceCount: 3 });
      expect(chips.some((c) => c.includes("reference photos"))).toBe(claimed);
    });
  });

  it("没有元素照时,照常出片,卡面一个字都不说", async () => {
    await withProvider("byteplus", async () => {
      const sent = await sendPlan([]);
      expect(sent.refused).toBe(false);
      expect(sent.carried).toBe(0);
      const chips = buildSpecChips("video", VIDEO_PARAMS, false, false, { elementReferenceCount: 0 });
      expect(chips.some((c) => c.includes("reference photos"))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // #979 —— 首帧那一格:卡面说「Starts from your image」,适配器就得真把那张图发出去。
  //
  // 这一格是 beta 录像 06:32 / 10:24 那对矛盾的正面修补:带首帧的片子里元素照一张都不上车,
  // 于是卡上唯一一句关于图片的话是「你那 2 张一张都不会用上」——字面为真,读起来却是
  // 「什么图都没用」,而对话里 Otto 同时说刚做好的那张会当首帧。现在卡面自己先把真会用上的
  // 那张说出来,所以这句承诺必须与适配器的实际请求体钉在一起。
  // -------------------------------------------------------------------------
  it("#979 首帧:卡面承诺与适配器真发出去的那张图一致", async () => {
    await withProvider("byteplus", async () => {
      const claimed = videoStartFrameHonoured();
      const chips = buildSpecChips("video", VIDEO_PARAMS, true, false, {
        elementReferenceCount: 0,
        hasStartFrame: true,
      });
      expect(chips.includes(VIDEO_START_FRAME_CHIP)).toBe(claimed);

      // 真跑一次带首帧的提交,证明那张图确实进了请求体。
      let body: unknown;
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        const u = String(url);
        if (u.includes("/contents/generations/tasks") && init?.method === "POST") {
          body = JSON.parse(init.body!);
          return { ok: true, status: 200, json: async (): Promise<unknown> => ({ id: "cgt-971" }), text: async (): Promise<string> => "" };
        }
        if (u.includes("/contents/generations/tasks/")) {
          return { ok: true, status: 200, json: async (): Promise<unknown> => ({ status: "succeeded", content: { video_url: "https://x/v.mp4" } }), text: async (): Promise<string> => "" };
        }
        return { ok: true, status: 200, arrayBuffer: async (): Promise<ArrayBuffer> => new Uint8Array([1]).buffer, text: async (): Promise<string> => "" };
      }));
      try {
        const promise = createGenerationProvider().generateVideo({
          prompt: "make her walk toward the camera", imageUrl: "https://r2/first.png",
          durationSeconds: 5, model: "seedance-2-mini" as GenVideoModel,
        });
        await vi.runAllTimersAsync();
        await promise;
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
      expect(JSON.stringify(body ?? {}), "卡面说从这张图起帧,请求体里却没有它").toContain("https://r2/first.png");
      // 首帧那一档元素照一张都不上车 —— 名额与卡面读的是同一个判据,不许一边说、一边送。
      expect(conditioningCap({ kind: "video", hasVideoStartFrame: true })).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// #777 —— 现役适配器把「一组连贯图」作为一次请求发出去,声明与行为两头对齐。
// ---------------------------------------------------------------------------
describe("#777 组图事实(如实声明)", () => {
  it("EXECUTED_SPEC 明说现役适配器做得到组图", () => {
    expect(EXECUTED_SPEC.image.coherentSetHonoured).toBe(true);
  });

  it("披露判据按真正会跑的那条路给答案(现役 true / 离线 true)", () => {
    expect(imageCoherentSetHonoured()).toBe(true);
  });

  it("离线 mock:组图与散图的字节不同 —— 两条路的产出不许撞成同一份内容", async () => {
    const set = await new MockProvider().generate({ prompt: "p", inputImageUrls: [], count: 2, model: "seedream", coherentSet: true });
    const spread = await new MockProvider().generate({ prompt: "p", inputImageUrls: [], count: 2, model: "seedream" });
    expect(set).toHaveLength(2);
    expect(Array.from(set[0]!.bytes)).not.toEqual(Array.from(spread[0]!.bytes));
  });
});
