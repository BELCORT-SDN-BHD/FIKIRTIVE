import { describe, it, expect, afterEach, vi } from "vitest";
import { EXECUTED_SPEC, GEN_IMAGE_ASPECTS, GEN_IMAGE_SIZES } from "@fikirtive/core";
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

  it("每一个菜单画幅都出对应宽高比的图,且与 GEN_IMAGE_SIZES 同比例", async () => {
    for (const aspect of GEN_IMAGE_ASPECTS) {
      const [img] = await new MockProvider().generate({
        prompt: "p", inputImageUrls: [], count: 1, model: "seedream", aspectRatio: aspect,
      });
      const got = pngSize(img!.bytes);
      const want = GEN_IMAGE_SIZES[aspect];
      expect(got.width / got.height, aspect).toBeCloseTo(want.width / want.height, 6);
      expect(got.width, `${aspect} 宽`).toBeGreaterThan(0);
      expect(got.height, `${aspect} 高`).toBeGreaterThan(0);
    }
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
