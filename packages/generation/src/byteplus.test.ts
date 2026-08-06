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
    // #646 T5: controls ride the STRICT top-level fields, and the prompt text is
    // the merchant's words only — no `--flag` suffix anywhere.
    expect(submitBody.content[1]).toEqual({ type: "text", text: "roll" });
    expect(submitBody.resolution).toBe("720p");
    expect(submitBody.duration).toBe(5);
    expect(submitBody.ratio).toBe("16:9");
    expect(JSON.stringify(submitBody)).not.toContain("--");
    // Seedance 2.0 rejects these three under strict validation — never send them.
    expect("seed" in submitBody).toBe(false);
    expect("camera_fixed" in submitBody).toBe(false);
    expect("frames" in submitBody).toBe(false);
  });
  it("#645 T4: adaptive 与新开的每一档都原样发给引擎 —— 卡面说的就是引擎收到的", async () => {
    // 「说的」与「做的」同源的那一步:卡面显示 Adaptive,引擎收到的就是 ratio:"adaptive",
    // 中间没有任何一处把它替换成某个具体比例。480p 与 4–15 秒同理。
    for (const [aspectRatio, resolution, durationSeconds] of [
      ["adaptive", "720p", 5],
      ["21:9", "480p", 15],
      ["3:4", "480p", 4],
      ["1:1", "720p", 12],
    ] as const) {
      let submitBody: any;
      stubFetch((url, init) => {
        if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") {
          submitBody = JSON.parse(init.body); return jsonRes({ id: "cgt-t4" });
        }
        if (url.includes("/contents/generations/tasks/cgt-t4")) {
          return jsonRes({ status: "succeeded", content: { video_url: "https://tos/v.mp4" }, usage: { total_tokens: 1 } });
        }
        return bytesRes();
      });
      const promise = new BytePlusProvider("ark-test").generateVideo({
        prompt: "roll", imageUrl: "https://r2/frame.png", durationSeconds, model: "seedance-2-fast", resolution, aspectRatio,
      });
      await vi.runAllTimersAsync();
      await promise;
      expect(submitBody.ratio, `${aspectRatio}`).toBe(aspectRatio);
      expect(submitBody.resolution, `${resolution}`).toBe(resolution);
      expect(submitBody.duration, `${durationSeconds}`).toBe(durationSeconds);
      // 严格顶层字段的纪律(#646 T5)在新档位上照旧成立。
      expect(JSON.stringify(submitBody)).not.toContain("--");
      expect("seed" in submitBody).toBe(false);
    }
  });

  it("t2v: text-only content when no source frame; no ratio field when the request has no shape", async () => {
    let submitBody: any;
    stubFetch((url, init) => {
      if (url.endsWith("/contents/generations/tasks")) { submitBody = JSON.parse(init.body); return jsonRes({ id: "cgt-2" }); }
      if (url.includes("/tasks/cgt-2")) return jsonRes({ status: "succeeded", content: { video_url: "https://tos/v.mp4" } });
      return bytesRes();
    });
    const promise = new BytePlusProvider("ark-test").generateVideo({ prompt: "a city", imageUrl: "", durationSeconds: 5, model: "seedance-2-fast" });
    await vi.runAllTimersAsync();
    await promise;
    expect(submitBody.content).toHaveLength(1);
    expect(submitBody.content[0].type).toBe("text");
    // no shape asked ⇒ the field is absent, the engine picks its own (adaptive).
    // Sending an empty/invented value under strict validation would 4xx the submit.
    expect("ratio" in submitBody).toBe(false);
    // no resolution asked ⇒ the engine default we price for (720p), sent explicitly.
    expect(submitBody.resolution).toBe("720p");
  });
  it("sound off: generate_audio:false rides the request (the toggle really reaches the engine)", async () => {
    let submitBody: any;
    stubFetch((url, init) => {
      if (url.endsWith("/contents/generations/tasks")) { submitBody = JSON.parse(init.body); return jsonRes({ id: "cgt-mute" }); }
      if (url.includes("/tasks/cgt-mute")) return jsonRes({ status: "succeeded", content: { video_url: "https://tos/v.mp4" } });
      return bytesRes();
    });
    const promise = new BytePlusProvider("ark-test").generateVideo({ prompt: "a city", imageUrl: "", durationSeconds: 5, model: "seedance-2-fast", audio: false });
    await vi.runAllTimersAsync();
    await promise;
    expect(submitBody.generate_audio).toBe(false);
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

  it("first+last frames: two image_url parts, roles spelled out (the engine requires both)", async () => {
    let submitBody: any;
    stubFetch((url, init) => {
      if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") {
        submitBody = JSON.parse(init.body); return jsonRes({ id: "cgt-tail" });
      }
      if (url.includes("/tasks/cgt-tail")) return jsonRes({ status: "succeeded", content: { video_url: "https://tos/v.mp4" } });
      return bytesRes();
    });
    const promise = new BytePlusProvider("ark-test").generateVideo({ prompt: "morph", imageUrl: "https://r2/frame.png", tailImageUrl: "https://r2/end.png", durationSeconds: 5, model: "seedance-2-fast" });
    await vi.runAllTimersAsync();
    await promise;
    // In first+last mode `role` is REQUIRED on both parts — a roleless pair is a
    // different (single-frame) scenario to the engine.
    expect(submitBody.content[0]).toEqual({ type: "image_url", image_url: { url: "https://r2/frame.png" }, role: "first_frame" });
    expect(submitBody.content[1]).toEqual({ type: "image_url", image_url: { url: "https://r2/end.png" }, role: "last_frame" });
    expect(submitBody.content[2]).toEqual({ type: "text", text: "morph" });
  });
  it("an end frame together with a reference video is refused BEFORE any submit — no spend", async () => {
    // first+last frames and reference-video are mutually exclusive scenarios; sending
    // both is a request the engine rejects, so refuse it while nothing is billed yet.
    const calls: string[] = [];
    stubFetch((url) => { calls.push(url); return jsonRes({ id: "should-not-happen" }); });
    let err: any;
    try {
      await new BytePlusProvider("ark-test").generateVideo({ prompt: "x", imageUrl: "https://r2/frame.png", tailImageUrl: "https://r2/end.png", refVideoUrl: "https://x/ref.mp4", durationSeconds: 5, model: "seedance-2-fast" });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/end frame/);
    expect(err.message).toMatch(/reference video/);
    expect(err.charged).toBeFalsy(); // pre-spend
    expect(calls).toHaveLength(0); // never hit the API
  });
  it("an end frame with no start frame is refused BEFORE any submit — never silently dropped", async () => {
    const calls: string[] = [];
    stubFetch((url) => { calls.push(url); return jsonRes({ id: "should-not-happen" }); });
    await expect(new BytePlusProvider("ark-test").generateVideo({ prompt: "x", imageUrl: "", tailImageUrl: "https://r2/end.png", durationSeconds: 5, model: "seedance-2-fast" }))
      .rejects.toThrow(/needs a start image/);
    expect(calls).toHaveLength(0); // pre-spend
  });
  it("an expired task is a PLAIN failure (terminated before any output ⇒ nothing billed, safe to retry)", async () => {
    stubFetch((url) => url.includes("/tasks/") && !url.endsWith("tasks")
      ? jsonRes({ status: "expired" })
      : jsonRes({ id: "cgt-exp" }));
    const promise = new BytePlusProvider("ark-test").generateVideo({ prompt: "x", imageUrl: "", durationSeconds: 5, model: "seedance-2-fast" });
    let err: any;
    const assertion = promise.catch((e) => { err = e; });
    await vi.runAllTimersAsync();
    await assertion;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/expired/);
    expect(err.charged).toBeFalsy();
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
  it("图像:不带画幅时整条请求体逐字段断言,尺寸 = 默认画幅(方图,与 #642 之前一致)", async () => {
    let body: any;
    stubFetch((url, init) => {
      if (url.endsWith("/images/generations")) { body = JSON.parse(init.body); return jsonRes({ data: [{ url: "https://tos/x.png" }] }); }
      return bytesRes();
    });
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
    expect(`${width}x${height}`).toBe("2048x2048"); // 既有方图行为逐字节不变
  });

  it("图像:**每一个**画幅都真的发出对应的确切 WxH —— 这是 aspectHonoured=true 的全部依据", async () => {
    for (const [aspect, size] of Object.entries(EXECUTED_SPEC.image.outputSizes)) {
      let body: any;
      stubFetch((url, init) => {
        if (url.endsWith("/images/generations")) { body = JSON.parse(init.body); return jsonRes({ data: [{ url: "https://tos/x.png" }] }); }
        return bytesRes();
      });
      await new BytePlusProvider("ark-test").generate({
        prompt: "a poster", inputImageUrls: [], count: 1, model: "seedream", aspectRatio: aspect,
      });
      // 整条请求体逐字段断言:画幅真的变成了发出去的 size,而且没有多出任何字段。
      expect(body, aspect).toEqual({
        model: "seedream-5-0-260128",
        prompt: "a poster",
        size: `${size.width}x${size.height}`,
        response_format: "url",
        watermark: false,
      });
      vi.unstubAllGlobals();
    }
    // 上面这一圈整体断言就是这一行的依据:八个画幅全都发得出去。
    expect(EXECUTED_SPEC.image.aspectHonoured).toBe(true);
  });

  it("图像:未知画幅诚实回落默认方图(纯函数,绝不把引擎收不下的值发出去)", async () => {
    let body: any;
    stubFetch((url, init) => {
      if (url.endsWith("/images/generations")) { body = JSON.parse(init.body); return jsonRes({ data: [{ url: "https://tos/x.png" }] }); }
      return bytesRes();
    });
    await new BytePlusProvider("ark-test").generate({
      prompt: "a poster", inputImageUrls: [], count: 1, model: "seedream", aspectRatio: "7:5",
    });
    expect(body.size).toBe("2048x2048");
  });

  it("视频:整条请求体逐字段断言 —— 时长/清晰度/画幅/声音四项都真的发得出去", async () => {
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
      const promise = new BytePlusProvider("ark-test").generateVideo({
        prompt: "a clip", imageUrl: "", durationSeconds: 5, model: "seedance-2-fast",
        resolution: "720p", aspectRatio: "16:9", audio: true,
      });
      await vi.runAllTimersAsync();
      await promise;
      expect(submitBody).toEqual({
        model: "dreamina-seedance-2-0-fast-260128",
        content: [{ type: "text", text: "a clip" }],
        resolution: "720p",
        duration: 5,
        ratio: "16:9",
        generate_audio: true,
        watermark: false,
        execution_expires_after: 3600,
      });
      // 上面这一条整体断言就是这四行的依据:四个控制项真的作为顶层字段发了出去。
      expect(EXECUTED_SPEC.video.durationHonoured).toBe(true);
      expect(EXECUTED_SPEC.video.resolutionHonoured).toBe(true);
      expect(EXECUTED_SPEC.video.aspectHonoured).toBe(true);
      expect(EXECUTED_SPEC.video.audioHonoured).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
