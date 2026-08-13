/**
 * #776 生成回执 —— 引擎自报的真实计费量与它真正跑的那句提示词。
 *
 * ── 这个文件里的假响应是**契约**,不是想象 ────────────────────────────────────────
 * r1 的夹具自己发明了一个 `data[].revised_prompt`,再断言 `total_tokens` 就是计费量;
 * 两条都不成立,于是那组测试只证明了「代码会读测试自己造出来的形状」。这一版的每一份
 * 夹具都对着两处独立取证抄:
 *
 *   ① 本仓自己的**付费实测**留档(PR #92 / #97,Founder 批准的真实调用):
 *      `docs/superpowers/specs/2026-06-29-phase2-byteplus-migration-design.md:27,40`
 *        图  → { model, created, data:[{url,size}], usage:{output_tokens,total_tokens,generated_images} }
 *        视频 → { status, content:{video_url}, usage:{total_tokens}, resolution, ratio,
 *                duration, framespersecond, seed, generate_audio }
 *   ② 官方 SDK 的类型定义:`Image{Url,B64Json,Size}`(**没有** revised_prompt)、
 *      `GenerateImagesUsage{GeneratedImages,OutputTokens,TotalTokens}`、
 *      `GetContentGenerationTaskResponse{… RevisedPrompt *string …}`(**有**,顶层)。
 *
 * 于是本组钉死三件事:
 *   · 图片的计费量是 **`generated_images`(张)**;`total_tokens` 是像素换算(2048²=16,384),
 *     记成计费量会让毛利对账差四个数量级 —— 这一列存在的全部理由就是让毛利可反查;
 *   · 视频的计费量是 **`total_tokens`**(5s/720p 实测 108,900),且只有视频响应带
 *     `revised_prompt`;
 *   · 读回执这条路**永远不许**把一单已经成功的付费生成推翻成失败 —— 图片路径上 `res.ok`
 *     之后每一次抛出都会被翻成 chargedError 并终态失败,一个记账字段读崩了就赔掉一单钱,
 *     是这次改动唯一能引入的新花钱风险。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { BytePlusProvider, readImageReceipt, readVideoReceipt } from "./byteplus.js";

afterEach(() => vi.unstubAllGlobals());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stubFetch(handler: (url: string, init?: any) => any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => handler(String(url), init)));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonRes = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const bytesRes = () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

/** 官方图片响应,一张 2048² —— 逐字段照抄实测留档。 */
const imageResponse = (url: string, generatedImages = 1) => ({
  model: "seedream-5-0-260128",
  created: 1_780_000_000,
  data: [{ url, size: "2048x2048" }],
  usage: { output_tokens: 16_384, total_tokens: 16_384, generated_images: generatedImages },
});

/** 官方视频任务响应(轮询到 succeeded 的那一份),5s/720p。 */
const videoTaskResponse = (revisedPrompt?: string) => ({
  id: "cgt-20260812000000-abcde",
  model: "dreamina-seedance-2-0-mini-260615",
  status: "succeeded",
  content: { video_url: "https://tos/v.mp4" },
  usage: { total_tokens: 108_900 },
  resolution: "720p",
  ratio: "16:9",
  duration: 5,
  framespersecond: 24,
  seed: 42,
  generate_audio: true,
  ...(revisedPrompt !== undefined ? { revised_prompt: revisedPrompt } : {}),
});

describe("#776 图片回执:计费量按**张**", () => {
  it("引擎报 generated_images=1 ⇒ billedUnits=1(而不是 16,384 个像素 token)", async () => {
    stubFetch((url) => (url.endsWith("/images/generations") ? jsonRes(imageResponse("https://tos/img1.png")) : bytesRes()));
    const out = await new BytePlusProvider("ark-test").generate({ prompt: "an apple", inputImageUrls: [], count: 1, model: "seedream" });
    // 同一份响应里 total_tokens=16,384 就躺在旁边。读错这一个字段,毛利对账差 16,384 倍。
    expect(out[0]!.receipt).toEqual({ billedUnits: 1 });
  });

  it("图片响应里没有 revised_prompt,所以提示词如实**未知**(不去 data[i] 上捞替身)", async () => {
    stubFetch((url) => (url.endsWith("/images/generations") ? jsonRes(imageResponse("https://tos/img1.png")) : bytesRes()));
    const out = await new BytePlusProvider("ark-test").generate({ prompt: "an apple", inputImageUrls: [], count: 1, model: "seedream" });
    expect(out[0]!.receipt!.finalPrompt).toBeUndefined();
  });

  it("整份 usage 缺席 ⇒ 回执缺席 = 未知,图照样交付", async () => {
    stubFetch((url) => (url.endsWith("/images/generations") ? jsonRes({ model: "seedream-5-0-260128", created: 1, data: [{ url: "https://tos/img1.png", size: "2048x2048" }] }) : bytesRes()));
    const out = await new BytePlusProvider("ark-test").generate({ prompt: "an apple", inputImageUrls: [], count: 1, model: "seedream" });
    expect(out).toHaveLength(1);
    expect(out[0]!.receipt).toBeUndefined();
  });

  it("每张图带自己那份回执 —— count 张 = count 次付费调用,不共享一个数", async () => {
    let n = 0;
    stubFetch((url) => {
      if (url.endsWith("/images/generations")) { n++; return jsonRes(imageResponse(`https://tos/img${n}.png`)); }
      return bytesRes();
    });
    const out = await new BytePlusProvider("ark-test").generate({ prompt: "an apple", inputImageUrls: [], count: 2, model: "seedream" });
    expect(out.map((o) => o.receipt)).toEqual([{ billedUnits: 1 }, { billedUnits: 1 }]);
  });

  it("回执字段是垃圾也只是没读到 —— 一单已经付过钱的生成绝不因此变成失败", async () => {
    stubFetch((url) => {
      // 0 / 负数 / 小数:都不是引擎在报数,一律当没读到,而不是抛出去。
      if (url.endsWith("/images/generations")) return jsonRes({ data: [{ url: "https://tos/img1.png", size: "2048x2048" }], usage: { generated_images: -1, total_tokens: 16_384 } });
      return bytesRes();
    });
    const out = await new BytePlusProvider("ark-test").generate({ prompt: "an apple", inputImageUrls: [], count: 1, model: "seedream" });
    expect(out).toHaveLength(1); // 交付照旧
    expect(out[0]!.receipt).toBeUndefined(); // 但不编数
  });
});

describe("#776 视频回执:计费量按 **token**,提示词是真实字段", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const runVideo = async () => {
    const promise = new BytePlusProvider("ark-test").generateVideo({ prompt: "roll", imageUrl: "", durationSeconds: 5, model: "seedance-2-mini" });
    await vi.runAllTimersAsync();
    return promise;
  };

  it("从成功那一次 poll 上读走 total_tokens 与顶层 revised_prompt", async () => {
    stubFetch((url, init) => {
      if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") return jsonRes({ id: "cgt-r1" });
      if (url.includes("/tasks/cgt-r1")) return jsonRes(videoTaskResponse("slow push-in on the product, warm light"));
      return bytesRes();
    });
    expect((await runVideo()).receipt).toEqual({ finalPrompt: "slow push-in on the product, warm light", billedUnits: 108_900 });
  });

  it("引擎没报提示词(字段可空)⇒ 只有计费量", async () => {
    stubFetch((url, init) => {
      if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") return jsonRes({ id: "cgt-r1" });
      if (url.includes("/tasks/cgt-r1")) return jsonRes(videoTaskResponse());
      return bytesRes();
    });
    expect((await runVideo()).receipt).toEqual({ billedUnits: 108_900 });
  });

  it("整份 usage 缺席 ⇒ 回执缺席,片子照样交付", async () => {
    stubFetch((url, init) => {
      if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") return jsonRes({ id: "cgt-r1" });
      if (url.includes("/tasks/cgt-r1")) return jsonRes({ id: "cgt-r1", status: "succeeded", content: { video_url: "https://tos/v.mp4" } });
      return bytesRes();
    });
    const out = await runVideo();
    expect(out.ext).toBe("mp4");
    expect(out.receipt).toBeUndefined();
  });
});

describe("#776 两个读函数本身:永不抛,永不编", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["字符串", "not an object"],
    ["数字", 42],
    ["usage 不是对象", { usage: "nope" }],
    ["generated_images 是字符串", { usage: { generated_images: "1" } }],
    ["generated_images 是 0", { usage: { generated_images: 0 } }],
    ["generated_images 是小数", { usage: { generated_images: 1.5 } }],
    ["generated_images 是 NaN", { usage: { generated_images: Number.NaN } }],
    ["generated_images 是 Infinity", { usage: { generated_images: Number.POSITIVE_INFINITY } }],
    // 图片响应即使**带**了 total_tokens,那也不是计费量 —— 一个人的像素数不是另一个人的账单。
    ["只有 total_tokens(图片里那不是计费量)", { usage: { total_tokens: 16_384 } }],
  ])("图片:%s ⇒ undefined,不抛", (_label, payload) => {
    expect(() => readImageReceipt(payload)).not.toThrow();
    expect(readImageReceipt(payload)).toBeUndefined();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["字符串", "not an object"],
    ["usage 不是对象", { usage: "nope" }],
    ["total_tokens 是字符串", { usage: { total_tokens: "108900" } }],
    ["total_tokens 是 0", { usage: { total_tokens: 0 } }],
    ["revised_prompt 不是字符串", { revised_prompt: { not: "a string" } }],
    ["revised_prompt 全是空白(空串不是一个答案)", { revised_prompt: "   " }],
  ])("视频:%s ⇒ undefined,不抛", (_label, payload) => {
    expect(() => readVideoReceipt(payload)).not.toThrow();
    expect(readVideoReceipt(payload)).toBeUndefined();
  });

  it("取值本身抛异常也只是没读到(getter 炸了不许炸掉一单生成)", () => {
    const hostile = { get usage(): unknown { throw new Error("boom"); } };
    expect(() => readImageReceipt(hostile)).not.toThrow();
    expect(readImageReceipt(hostile)).toBeUndefined();
    expect(() => readVideoReceipt(hostile)).not.toThrow();
    expect(readVideoReceipt(hostile)).toBeUndefined();
  });

  it("超长提示词被截断,而不是被丢掉 —— 半句真话仍是真话", () => {
    const r = readVideoReceipt({ usage: { total_tokens: 1 }, revised_prompt: "x".repeat(9_000) });
    expect(r!.finalPrompt!.length).toBe(4_000);
    expect(r!.finalPrompt!.startsWith("xxxx")).toBe(true);
  });
});
