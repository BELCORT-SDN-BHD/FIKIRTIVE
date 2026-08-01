import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { EXECUTED_SPEC } from "@fikirtive/core";
import { BytePlusProvider, IMAGE_MODEL_MAP, VIDEO_MODEL_MAP } from "./byteplus.js";

describe("BytePlusProvider — wiring", () => {
  it("maps internal model ids to Ark ids", () => {
    expect(IMAGE_MODEL_MAP["seedream"]).toBe("seedream-5-0-260128");
    expect(VIDEO_MODEL_MAP["seedance-2-fast"]).toBe("dreamina-seedance-2-0-fast-260128");
  });
  it("has a stable provider name", () => {
    expect(new BytePlusProvider("ark-test").name).toBe("byteplus");
  });
});

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init?: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => handler(String(url), init)));
}
const jsonRes = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const bytesRes = () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

describe("generateVideo (Seedance, async)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("i2v: submits image_url+text content, polls to succeeded, downloads", async () => {
    let submitBody: any; let polls = 0;
    stubFetch((url, init) => {
      if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") {
        submitBody = JSON.parse(init.body); return jsonRes({ id: "cgt-1" });
      }
      if (url.includes("/contents/generations/tasks/cgt-1")) {
        polls++; return jsonRes(polls < 2 ? { status: "running" } : { status: "succeeded", content: { video_url: "https://tos/v.mp4" }, usage: { total_tokens: 108900 } });
      }
      return bytesRes(); // mp4 download
    });
    const promise = new BytePlusProvider("ark-test").generateVideo({ prompt: "roll", imageUrl: "https://r2/frame.png", durationSeconds: 5, model: "seedance-2-fast", resolution: "720p", aspectRatio: "16:9" });
    // Advance through each poll interval
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.ext).toBe("mp4");
    expect(submitBody.model).toBe("dreamina-seedance-2-0-fast-260128");
    expect(submitBody.content[0]).toEqual({ type: "image_url", image_url: { url: "https://r2/frame.png" } });
    expect(submitBody.content[1].text).toContain("--resolution 720p");
    expect(submitBody.content[1].text).toContain("--duration 5");
    expect(submitBody.content[1].text).toContain("--ratio 16:9");
  });
  it("t2v: text-only content when no source frame", async () => {
    let submitBody: any;
    stubFetch((url, init) => {
      if (url.endsWith("/contents/generations/tasks")) { submitBody = JSON.parse(init.body); return jsonRes({ id: "cgt-2" }); }
      if (url.includes("/tasks/cgt-2")) return jsonRes({ status: "succeeded", content: { video_url: "https://tos/v.mp4" } });
      return bytesRes();
    });
    const promise = new BytePlusProvider("ark-test").generateVideo({ prompt: "a city", imageUrl: "", durationSeconds: 5, model: "seedance-2-fast", resolution: "1080p" });
    await vi.runAllTimersAsync();
    await promise;
    expect(submitBody.content).toHaveLength(1);
    expect(submitBody.content[0].type).toBe("text");
  });
  it("a failed task throws chargedError", async () => {
    stubFetch((url) => url.includes("/tasks/") && !url.endsWith("tasks")
      ? jsonRes({ status: "failed", error: { message: "nsfw" } })
      : jsonRes({ id: "cgt-3" }));
    const promise = new BytePlusProvider("ark-test").generateVideo({ prompt: "x", imageUrl: "", durationSeconds: 5, model: "seedance-2-fast" });
    // Attach rejection handler before advancing timers to avoid unhandled rejection warning
    const assertion = expect(promise).rejects.toThrow(/generation provider.*failed/);
    await vi.runAllTimersAsync();
    await assertion;
  });
  it("keeps polling past the old 5-min cap (video can run longer) and still succeeds (F06)", async () => {
    // Return "running" for ~70 polls (~5.8 min at 5s) then succeed. The old 5-min TIMEOUT_MS
    // would have thrown a chargedError timeout (~poll 61) — refunding the user while BytePlus
    // still bills the completing task. The 15-min cap lets it finish.
    let polls = 0;
    stubFetch((url) => {
      if (url.endsWith("/contents/generations/tasks")) return jsonRes({ id: "cgt-slow" });
      if (url.includes("/tasks/cgt-slow")) { polls++; return jsonRes(polls < 70 ? { status: "running" } : { status: "succeeded", content: { video_url: "https://tos/v.mp4" } }); }
      return bytesRes();
    });
    const promise = new BytePlusProvider("ark-test").generateVideo({ prompt: "x", imageUrl: "", durationSeconds: 5, model: "seedance-2-fast" });
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.ext).toBe("mp4");
  });

  it("rejects an end frame (tailImageUrl) BEFORE any submit — no spend", async () => {
    const calls: string[] = [];
    stubFetch((url) => { calls.push(url); return jsonRes({ id: "should-not-happen" }); });
    await expect(new BytePlusProvider("ark-test").generateVideo({ prompt: "x", imageUrl: "https://r2/frame.png", tailImageUrl: "https://r2/end.png", durationSeconds: 5, model: "seedance-2-fast" }))
      .rejects.toThrow(/end frame/);
    expect(calls).toHaveLength(0); // pre-spend: never hit the API
  });
  it("generateVideo includes a reference_video content part when refVideoUrl is set", async () => {
    let submitBody: any;
    stubFetch((url, init) => {
      if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") {
        submitBody = JSON.parse(init.body); return jsonRes({ id: "cgt-4" });
      }
      if (url.includes("/tasks/cgt-4")) return jsonRes({ status: "succeeded", content: { video_url: "https://x/v.mp4" } });
      return bytesRes();
    });
    const promise = new BytePlusProvider("ark-test").generateVideo({ prompt: "move like this", imageUrl: "", refVideoUrl: "https://x/ref.mp4", durationSeconds: 5, model: "seedance-2-fast" });
    await vi.runAllTimersAsync();
    await promise;
    const parts = submitBody.content as Array<{ type: string; role?: string; video_url?: { url: string } }>;
    const vp = parts.find((c) => c.type === "video_url");
    expect(vp).toBeTruthy();
    expect(vp!.role).toBe("reference_video");
    expect(vp!.video_url!.url).toBe("https://x/ref.mp4");
  });
});

describe("generate (Seedream image, sync)", () => {
  it("posts the Ark images request and downloads each result", async () => {
    const calls: any[] = [];
    stubFetch((url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/images/generations")) return jsonRes({ data: [{ url: "https://tos/img1.png", size: "2048x2048" }], usage: { total_tokens: 16384 } });
      return bytesRes(); // the result download
    });
    const out = await new BytePlusProvider("ark-test").generate({ prompt: "an apple", inputImageUrls: [], count: 1, model: "seedream" });
    expect(out).toHaveLength(1);
    expect(out[0]!.ext).toBe("png");
    expect(Array.from(out[0]!.bytes)).toEqual([1, 2, 3]);
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe("seedream-5-0-260128");
    expect(body.size).toBe("2048x2048");
    expect(body.response_format).toBe("url");
  });
  it("uses ImageToImage (passes the input image) when a source frame is present", async () => {
    let body: any;
    stubFetch((url, init) => {
      if (url.endsWith("/images/generations")) { body = JSON.parse(init.body); return jsonRes({ data: [{ url: "https://tos/x.png" }] }); }
      return bytesRes();
    });
    await new BytePlusProvider("ark-test").generate({ prompt: "edit", inputImageUrls: ["https://r2/src.png"], count: 1, model: "seedream" });
    expect(body.image).toBe("https://r2/src.png"); // single ref → proven string form, unchanged
  });
  it("sends ALL reference images (multi-reference) as an array", async () => {
    let body: any;
    stubFetch((url, init) => {
      if (url.endsWith("/images/generations")) { body = JSON.parse(init.body); return jsonRes({ data: [{ url: "https://tos/x.png" }] }); }
      return bytesRes();
    });
    const refs = ["https://r2/product.png", "https://r2/logo.png", "https://r2/character.png"];
    await new BytePlusProvider("ark-test").generate({ prompt: "compose", inputImageUrls: refs, count: 1, model: "seedream" });
    // Ark Seedream's `image` field takes an array of refs — product + logo + character all condition.
    expect(body.image).toEqual(refs);
  });
  it("omits image entirely for pure text-to-image (no refs)", async () => {
    let body: any;
    stubFetch((url, init) => {
      if (url.endsWith("/images/generations")) { body = JSON.parse(init.body); return jsonRes({ data: [{ url: "https://tos/x.png" }] }); }
      return bytesRes();
    });
    await new BytePlusProvider("ark-test").generate({ prompt: "an apple", inputImageUrls: [], count: 1, model: "seedream" });
    expect("image" in body).toBe(false);
  });
  it("throws (no spend) for an unknown model", async () => {
    await expect(new BytePlusProvider("ark-test").generate({ prompt: "x", inputImageUrls: [], count: 1, model: "nope" as any }))
      .rejects.toThrow(/no image model/);
  });
  it("throws chargedError when a paid image fails to download (all-or-nothing)", async () => {
    stubFetch((url) => {
      if (url.endsWith("/images/generations")) return jsonRes({ data: [{ url: "https://tos/img1.png" }] });
      return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }; // the result download fails
    });
    await expect(new BytePlusProvider("ark-test").generate({ prompt: "x", inputImageUrls: [], count: 1, model: "seedream" }))
      .rejects.toThrow(/usable/);
  });

  it("sets watermark:false on the Ark image request (F40 — paying users must not get watermarked images)", async () => {
    let body: any;
    stubFetch((url, init) => {
      if (url.endsWith("/images/generations")) { body = JSON.parse(init.body); return jsonRes({ data: [{ url: "https://tos/x.png" }] }); }
      return bytesRes();
    });
    await new BytePlusProvider("ark-test").generate({ prompt: "x", inputImageUrls: [], count: 1, model: "seedream" });
    expect(body.watermark).toBe(false);
  });

  it("a PRE-charge POST failure (429, nothing billed) rejects PLAIN/retryable, not chargedError (F05)", async () => {
    stubFetch((url) => {
      if (url.endsWith("/images/generations")) return { ok: false, status: 429, text: async () => "rate limited" };
      return bytesRes();
    });
    let err: any;
    try {
      await new BytePlusProvider("ark-test").generate({ prompt: "x", inputImageUrls: [], count: 1, model: "seedream" });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect((err as any).charged).toBeFalsy(); // pre-charge → the worker may safely retry
    expect(err.message).toContain("429");
  });

  it("a shortfall where at least one image WAS billed still surfaces as chargedError (F05)", async () => {
    let n = 0;
    stubFetch((url) => {
      if (url.endsWith("/images/generations")) {
        n++;
        return n === 1 ? jsonRes({ data: [{ url: "https://tos/a.png" }] }) : { ok: false, status: 500, text: async () => "boom" };
      }
      return bytesRes();
    });
    let err: any;
    try {
      await new BytePlusProvider("ark-test").generate({ prompt: "x", inputImageUrls: [], count: 2, model: "seedream" });
    } catch (e) { err = e; }
    expect((err as any).charged).toBe(true); // one image billed → retrying would re-bill it
  });
});

// ---------------------------------------------------------------------------
// #580 复审 r2 P2 —— 卡面「说的」↔ 适配器「发的」lockstep(真闸)
//
// 上一版这道闸开在 packages/otto 的测试里,做法是把这个文件当字符串读进去、grep
// `size: "2048x2048"`。那只证明源码里有那几个字,不证明适配器真发了什么 —— 换个写法、
// 换个变量名就能骗过它,而卡面会继续按一份不成立的规格向商家收钱。
//
// 这里改成:stub 掉 fetch、调**真**适配器、把它真正发出去的 JSON **整体**断言一遍,
// 并逐字比对 `EXECUTED_SPEC`(住在 @fikirtive/core,卡面文案读的是同一份声明)。
// 请求体多一个字段、少一个字段、改一个值,这里都红;红了就必须同步改 EXECUTED_SPEC,
// 卡面于是自动开始说新话。
//
// **闸的范围**:只保障**现役**适配器 —— 图像 `BytePlusProvider.generate` 与视频
// `BytePlusProvider.generateVideo`。同包里的 MockProvider(离线 $0)与 FalProvider
// (legacy fallback)不在闸内:它们不是生产创作路径,卡面文案也不按它们派生。哪天换了
// 现役适配器,这一节必须跟着换到新适配器上,否则闸就空了。
// ---------------------------------------------------------------------------
describe("#580 卡面规格 ↔ 现役适配器请求体(lockstep)", () => {
  it("图像:整条请求体逐字段断言,尺寸与 EXECUTED_SPEC.image.outputSize 一致", async () => {
    let body: any;
    stubFetch((url, init) => {
      if (url.endsWith("/images/generations")) { body = JSON.parse(init.body); return jsonRes({ data: [{ url: "https://tos/x.png" }] }); }
      return bytesRes();
    });
    // 商家要的画幅不在 GenerationRequest 里 —— 它在 gen-from-card 那一层就被丢掉了,
    // 所以适配器根本无从发送。这正是 aspectHonoured=false 的依据。
    await new BytePlusProvider("ark-test").generate({
      prompt: "a poster", inputImageUrls: [], count: 1, model: "seedream",
    });
    const { width, height } = EXECUTED_SPEC.image.outputSize;
    expect(body).toEqual({
      model: "seedream-5-0-260128",
      prompt: "a poster",
      size: `${width}x${height}`,
      response_format: "url",
      watermark: false,
    });
    // 整体断言已经证明请求体里没有任何画幅字段 —— 卡面因此不得承诺画幅。
    expect(EXECUTED_SPEC.image.aspectHonoured).toBe(false);
  });

  it("视频:整条请求体逐字段断言 —— 时长/清晰度/画幅发得出去,声音发不出去", async () => {
    vi.useFakeTimers();
    try {
      let submitBody: any;
      stubFetch((url, init) => {
        if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") {
          submitBody = JSON.parse(init.body); return jsonRes({ id: "cgt-lockstep" });
        }
        if (url.includes("/tasks/cgt-lockstep")) return jsonRes({ status: "succeeded", content: { video_url: "https://tos/v.mp4" } });
        return bytesRes();
      });
      // audio:true 明确传进来 —— 如果适配器把它发出去了,下面的整体断言就红。
      const promise = new BytePlusProvider("ark-test").generateVideo({
        prompt: "a clip", imageUrl: "", durationSeconds: 5, model: "seedance-2-fast",
        resolution: "720p", aspectRatio: "16:9", audio: true,
      });
      await vi.runAllTimersAsync();
      await promise;
      expect(submitBody).toEqual({
        model: "dreamina-seedance-2-0-fast-260128",
        content: [{ type: "text", text: "a clip --resolution 720p --duration 5 --ratio 16:9" }],
      });
      // 上面这一条整体断言就是这三行的依据:三个控制项真的编进了发出去的文本,
      // 而 audio 一个字都没出现。
      expect(EXECUTED_SPEC.video.durationHonoured).toBe(true);
      expect(EXECUTED_SPEC.video.resolutionHonoured).toBe(true);
      expect(EXECUTED_SPEC.video.aspectHonoured).toBe(true);
      expect(EXECUTED_SPEC.video.audioHonoured).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
