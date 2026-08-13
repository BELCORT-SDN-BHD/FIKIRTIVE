import { describe, it, expect, afterEach, vi } from "vitest";
import {
  EXECUTED_SPEC, GEN_IMAGE_ASPECTS, GEN_IMAGE_SIZES, GEN_VIDEO_MODELS, imageAspectHonoured,
  buildSpecChips, conditioningCap, videoElementReferencesHonoured, type GenVideoModel,
} from "@fikirtive/core";
import { createGenerationProvider, FalProvider, MockProvider } from "./index.js";

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

describe("#642 备用适配器的画幅事实(如实声明,不假装)", () => {
  it("EXECUTED_SPEC 明说备用适配器不携带画幅", () => {
    expect(EXECUTED_SPEC.image.fallbackAdapterAspectHonoured).toBe(false);
  });
  it("备用适配器的请求体里确实一个尺寸字段都没有 —— 声明与代码对得上", async () => {
    let body: any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (String(url).includes("fal.run")) {
        body = JSON.parse(init.body);
        return { ok: true, status: 200, json: async (): Promise<unknown> => ({ images: [{ url: "https://fal/x.png", content_type: "image/png" }] }), text: async (): Promise<string> => "" };
      }
      return { ok: true, status: 200, arrayBuffer: async (): Promise<ArrayBuffer> => new Uint8Array([1]).buffer, text: async (): Promise<string> => "" };
    }));
    try {
      await new FalProvider("fal-test").generate({
        prompt: "p", inputImageUrls: [], count: 1, model: "seedream", aspectRatio: "9:16",
      });
      expect(Object.keys(body).sort()).toEqual(["num_images", "prompt"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// #642 修复轮 r1 P2 —— 披露判据 ↔ 每个真适配器实际行为(跨包 lockstep)
//
// 卡面文案问的是 `imageAspectHonoured()`(@fikirtive/core)。那个函数按
// GENERATION_PROVIDER 分支给答案,但它**看不见**适配器的代码 —— 两边一旦漂移,卡面就会
// 替一条根本不发规格的路承诺形状。这里把每个 provider 真正发出去的东西拿出来对表:
// 声称兑现的,请求体/产出里必须真有那个形状;声称不兑现的,必须真的没有。
// ---------------------------------------------------------------------------
describe("#642 imageAspectHonoured() ↔ 适配器实际发出去的东西", () => {
  const PORTRAIT = "9:16";
  const want = GEN_IMAGE_SIZES[PORTRAIT];

  /** 真跑一次该 provider 的图片生成,回答「这一趟真的按 9:16 走了吗」。 */
  async function adapterReallyHonoursShape(providerName: string): Promise<boolean> {
    process.env.GENERATION_PROVIDER = providerName;
    if (providerName === "byteplus") process.env.BYTEPLUS_API_KEY = "ark-test";
    if (providerName === "fal") process.env.FAL_KEY = "fal-test";
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("/images/generations") || u.includes("fal.run")) {
        body = JSON.parse(init!.body!);
        return {
          ok: true, status: 200,
          json: async (): Promise<unknown> => u.includes("fal.run")
            ? { images: [{ url: "https://x/y.png", content_type: "image/png" }] }
            : { data: [{ url: "https://x/y.png" }] },
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
      if (providerName !== "byteplus" && providerName !== "fal") {
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

  it.each(["byteplus", "fal", "mock"])(
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
        delete process.env.FAL_KEY;
      }
    },
  );

  it("备用路被选中时,判据必须回 false(不许替不发规格的路承诺形状)", () => {
    const prev = process.env.GENERATION_PROVIDER;
    process.env.GENERATION_PROVIDER = "fal";
    try {
      expect(imageAspectHonoured()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.GENERATION_PROVIDER;
      else process.env.GENERATION_PROVIDER = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// #785 判官 r1 P1 —— 元素照的披露判据 ↔ 每个真适配器对元素照的实际处置(跨包 lockstep)
//
// 与上面那组画幅 lockstep 同一个病、同一把尺子。卡面此前问的是
// `EXECUTED_SPEC.video.elementReferencesHonoured`(**现役**适配器的静态事实),可这一单
// 由谁执行取决于 GENERATION_PROVIDER —— 备用路(fal)在付费之前就把带元素照的请求拒掉,
// 卡面却照旧承诺「Uses 3 of your reference photos」。判据现在是
// `videoElementReferencesHonoured()`,而且它同时喂**选片名额**(`conditioningCap`)——
// 「说几张」与「送几张」于是共用一个开关,不可能分家。
//
// 矩阵:两条真花钱的路 × 有 / 没有元素照。(mock 不入矩阵:它不花钱、不对商家交付,
// 每一格规格对它都同样不成立 —— 这里要挡的是两条真路之间的漂移。)
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
      // fal:同步端点,POST 本身就是计费事件
      if (u.includes("fal.run")) {
        body = JSON.parse(init!.body!);
        return { ok: true, status: 200, json: async (): Promise<unknown> => ({ video: { url: "https://x/v.mp4" } }), text: async (): Promise<string> => "" };
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
    if (name === "fal") process.env.FAL_KEY = "fal-test";
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.GENERATION_PROVIDER;
      else process.env.GENERATION_PROVIDER = prev;
      delete process.env.BYTEPLUS_API_KEY;
      delete process.env.FAL_KEY;
    }
  }

  it.each(["byteplus", "fal"])(
    "%s:带元素照时,卡面承诺、选片名额与适配器的实际处置三者一致",
    async (providerName) => {
      await withProvider(providerName, async () => {
        const claimed = videoElementReferencesHonoured();
        const sent = await sendPlan(PHOTOS);

        if (claimed) {
          // 承诺得起 ⇒ 这条路真的把每一张都编进了请求体。
          expect(sent.refused, `${providerName}: 披露说会用,适配器却拒了`).toBe(false);
          expect(sent.carried).toBe(PHOTOS.length);
        } else {
          // 承诺不起 ⇒ 这条路连送都送不出去(付费之前就拒)。
          expect(sent.refused, `${providerName}: 披露说用不了,适配器却收下了`).toBe(true);
          expect(sent.carried).toBe(0);
        }
        // 名额与卡面读的是同一个判据 —— 不许一边说三张、一边送零张。
        expect(conditioningCap({ kind: "video" }) > 0).toBe(claimed);
        const chips = buildSpecChips("video", VIDEO_PARAMS, false, false, { elementReferenceCount: 3 });
        expect(chips.some((c) => c.includes("reference photos"))).toBe(claimed);
      });
    },
  );

  it.each(["byteplus", "fal"])(
    "%s:没有元素照时,两条路都照常出片,卡面一个字都不说",
    async (providerName) => {
      await withProvider(providerName, async () => {
        const sent = await sendPlan([]);
        expect(sent.refused).toBe(false);
        expect(sent.carried).toBe(0);
        const chips = buildSpecChips("video", VIDEO_PARAMS, false, false, { elementReferenceCount: 0 });
        expect(chips.some((c) => c.includes("reference photos"))).toBe(false);
      });
    },
  );

  it("备用路被选中时,判据必须回 false(不许替一条拒收元素照的路承诺)", async () => {
    await withProvider("fal", async () => {
      expect(videoElementReferencesHonoured()).toBe(false);
      expect(conditioningCap({ kind: "video" })).toBe(0);
      // 图片侧的名额不受影响 —— 备用路的图片编辑照旧收参考图。
      expect(conditioningCap({ kind: "image" })).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// #647 T6 —— 假菜单的**第五处声明**就住在这个文件里(fal 视频接线表)
//
// gen.ts 的注释自述过一条纪律:「加一个模型 = 这里一条 + @fikirtive/generation 的
// VIDEO_CFG 一条」。删的时候同一条纪律必须反着走 —— 只删菜单不删接线,菜单外的 id
// 就还留着一条能真的把钱花出去的路。这里不看源码字符串,直接问适配器:给它一个下架
// 模型,它会不会去付费端点。
// ---------------------------------------------------------------------------
describe("#647 T6 fal 视频接线只剩真的那一格", () => {
  const RETIRED = [
    "kling", "veo3.1-lite", "ltx-2", "kling-2.6", "kling-3", "veo3.1-fast",
    "veo3.1", "pixverse-v6", "grok-imagine", "wan-2.5", "hailuo-02", "seedance-2",
    // #769:换 2.0 mini 之后 fast 也下架 —— 同一条纪律,它的接线必须一起消失。
    "seedance-2-fast",
  ] as const;

  it("下架模型在**付费 POST 之前**就被拒(接线表里没有它 = 花不出去这笔钱)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      for (const model of RETIRED) {
        await expect(
          new FalProvider("fal-test").generateVideo({
            prompt: "p", imageUrl: "", model: model as GenVideoModel, durationSeconds: 5,
          } as never),
        ).rejects.toThrow(/no video model mapping/u);
      }
      expect(fetchSpy, "下架模型竟然发出了付费请求").not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("在册的每一格都还接得上(删的是假的,没误伤真的)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("fal.run")) {
        return { ok: true, status: 200, json: async (): Promise<unknown> => ({ video: { url: "https://fal/x.mp4" } }), text: async (): Promise<string> => "" };
      }
      return { ok: true, status: 200, arrayBuffer: async (): Promise<ArrayBuffer> => new Uint8Array([1]).buffer, text: async (): Promise<string> => "" };
    }));
    try {
      for (const model of GEN_VIDEO_MODELS) {
        const out = await new FalProvider("fal-test").generateVideo({
          prompt: "p", imageUrl: "", model, durationSeconds: 5,
        } as never);
        expect(out.ext).toBe("mp4");
      }
      expect(calls.filter((u) => u.includes("fal.run")).length).toBe(GEN_VIDEO_MODELS.length);
      // #769:接的是 mini 自己那条 route(查过 fal 模型页),不是把 fast 的 route 改了个名。
      expect(calls.some((u) => u.includes("bytedance/seedance-2.0/mini/"))).toBe(true);
      expect(calls.some((u) => u.includes("/fast/"))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
