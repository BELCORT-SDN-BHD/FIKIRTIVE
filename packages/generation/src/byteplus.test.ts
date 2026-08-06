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
  // #661:引擎明确报告「没出片」的终态 ⇒ 官方不收费(定价页 2026-08-01:
  // "You are only charged for successfully generated videos. No fee is charged if
  // generation fails due to reasons such as content moderation.")。所以这两个终态
  // 必须是 PLAIN,不能带 charged —— 带了,worker 就会给一笔引擎没收的钱记 spentUsd。
  for (const status of ["failed", "cancelled", "canceled"] as const) {
    it(`a ${status} task is a PLAIN failure (engine says no video was produced ⇒ nothing billed) — #661`, async () => {
      stubFetch((url) => url.includes("/tasks/") && !url.endsWith("tasks")
        ? jsonRes({ status, error: { message: "nsfw" } })
        : jsonRes({ id: `cgt-${status}` }));
      const promise = new BytePlusProvider("ark-test").generateVideo({ prompt: "x", imageUrl: "", durationSeconds: 5, model: "seedance-2-fast" });
      let err: any;
      // Attach the rejection handler before advancing timers to avoid an unhandled rejection warning
      const assertion = promise.catch((e) => { err = e; });
      await vi.runAllTimersAsync();
      await assertion;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(new RegExp(`generation provider.*${status}`));
      expect(err.charged).toBeFalsy();
    });
  }
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
  // ── #661 反向钉板:「结果不明」的每一条路都必须**继续**按已扣上抛 ──────────────
  //
  // #661 只放开一件事:引擎**明确报告没出片**的终态(failed/cancelled/expired)。这道
  // 边界是 #657 定的,一字不许越 —— 只要我们不知道引擎那边到底出没出片(轮询读不到、
  // 15 分钟弃单、出片了但拿不下来),钱就可能已经花了,必须 chargedError 终结,
  // 绝不重投。下面五条把这条边界钉死:哪天有人「顺手」把它们也改成 PLAIN,这里红。
  describe("#661 边界:结果不明仍是 chargedError(不许过度修正)", () => {
    async function rejection(run: () => Promise<unknown>) {
      let err: any;
      const assertion = run().catch((e) => { err = e; });
      await vi.runAllTimersAsync();
      await assertion;
      return err;
    }
    const call = () => new BytePlusProvider("ark-test").generateVideo({ prompt: "x", imageUrl: "", durationSeconds: 5, model: "seedance-2-fast" });

    it("弃单超时(任务还在跑,引擎可能照样出片照样计费)", async () => {
      stubFetch((url) => url.includes("/tasks/") && !url.endsWith("tasks")
        ? jsonRes({ status: "running" })
        : jsonRes({ id: "cgt-slowforever" }));
      const err = await rejection(call);
      expect(err.message).toMatch(/timed out/);
      expect(err.charged).toBe(true);
    });
    it("轮询一直非 2xx 直到超时(读不到状态 ≠ 没出片)", async () => {
      stubFetch((url) => url.includes("/tasks/") && !url.endsWith("tasks")
        ? { ok: false, status: 503, text: async () => "upstream busy" }
        : jsonRes({ id: "cgt-503" }));
      const err = await rejection(call);
      expect(err.message).toMatch(/503 after timeout/);
      expect(err.charged).toBe(true);
    });
    it("轮询一直抛异常直到超时(网络断 ≠ 没出片)", async () => {
      stubFetch((url) => {
        if (url.includes("/tasks/") && !url.endsWith("tasks")) throw new Error("ECONNRESET");
        return jsonRes({ id: "cgt-reset" });
      });
      const err = await rejection(call);
      expect(err.message).toMatch(/polling failed after timeout/);
      expect(err.charged).toBe(true);
    });
    it("succeeded 但响应里没有视频 URL(出片了,只是我们读不到)", async () => {
      stubFetch((url) => url.includes("/tasks/") && !url.endsWith("tasks")
        ? jsonRes({ status: "succeeded", content: {} })
        : jsonRes({ id: "cgt-nourl" }));
      const err = await rejection(call);
      expect(err.message).toMatch(/no result URL/);
      expect(err.charged).toBe(true);
    });
    it("succeeded 但下载失败(片子已经出了、钱已经花了)", async () => {
      stubFetch((url) => {
        if (url.endsWith("/contents/generations/tasks")) return jsonRes({ id: "cgt-dl" });
        if (url.includes("/tasks/cgt-dl")) return jsonRes({ status: "succeeded", content: { video_url: "https://tos/v.mp4" } });
        return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) };
      });
      const err = await rejection(call);
      expect(err.message).toMatch(/download failed \(500\)/);
      expect(err.charged).toBe(true);
    });

    // 判官 r1 P1-1:上面那条只盖住「下载返回非 2xx」。片子已经出了之后,下载还有两种
    // **不返回任何状态码**的死法 —— 连接直接断(fetch 自己 reject)、以及连上了但读流中断
    // (arrayBuffer 抛)。这两种此前原样 PLAIN 逸出 ⇒ worker 重投 ⇒ 旧片已计费,再出一支
    // 再计一次费。钱已经花了这件事,和它是怎么死的无关。
    it("succeeded 后下载连接直接断(fetch 自己 reject,连状态码都没有)", async () => {
      stubFetch((url) => {
        if (url.endsWith("/contents/generations/tasks")) return jsonRes({ id: "cgt-neterr" });
        if (url.includes("/tasks/cgt-neterr")) return jsonRes({ status: "succeeded", content: { video_url: "https://tos/v.mp4" } });
        throw new TypeError("fetch failed: ECONNRESET");
      });
      const err = await rejection(call);
      expect(err.charged).toBe(true);
    });
    it("succeeded 后读流中断(arrayBuffer 抛,字节没拿全)", async () => {
      stubFetch((url) => {
        if (url.endsWith("/contents/generations/tasks")) return jsonRes({ id: "cgt-stream" });
        if (url.includes("/tasks/cgt-stream")) return jsonRes({ status: "succeeded", content: { video_url: "https://tos/v.mp4" } });
        return { ok: true, status: 200, arrayBuffer: async () => { throw new Error("stream aborted mid-body"); } };
      });
      const err = await rejection(call);
      expect(err.charged).toBe(true);
    });

    // 判官 r1 P1-2:submit 已经 2xx —— 引擎收单了。回执读不出来(JSON 损坏 / 没有 task id)
    // 不等于任务没建成;重投会再开一个任务、再计一次费。这是标准的「结果不明」,必须 charged。
    it("submit 2xx 但回执 JSON 损坏(收单了,只是回执读不出来)", async () => {
      stubFetch((url) => url.endsWith("/contents/generations/tasks")
        ? { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); }, text: async () => "{" }
        : jsonRes({ status: "running" }));
      const err = await rejection(call);
      expect(err.charged).toBe(true);
    });
    it("submit 2xx 但回执里没有 task id(同上:无法证明任务没建成)", async () => {
      stubFetch((url) => url.endsWith("/contents/generations/tasks")
        ? jsonRes({})
        : jsonRes({ status: "running" }));
      const err = await rejection(call);
      expect(err.message).toMatch(/no task id/);
      expect(err.charged).toBe(true);
    });
    // ── #672:submit 的另外两种死法,与上面两条同尺 ────────────────────────────
    //
    // 上面两条盖住的是「submit 已经 2xx、回执读不出来」。submit 还有两种**根本没拿到
    // 2xx** 的死法,此前双双按 PLAIN 逸出 ⇒ worker 重投 ⇒ 引擎那边可能已经有一个任务在
    // 跑,再建第二个,同一支片子计两次费:
    //   - fetch 自己抛:连响应都没拿到。请求可能已经到达引擎并建成了任务,只是回执丢在
    //     路上 —— 与「2xx 但回执读不出来」是同一件事的不同死法,证明不了任务没建成。
    //   - 5xx:网关超时 / 上游 500 可能发生在任务建成**之后**,同样证明不了没收单。
    // 家规:只有可证明引擎没花钱才许 PLAIN;结果不明一律 charged(终态,不重投)。
    it("#672 submit 的 fetch 自己抛(连响应都没拿到,证明不了任务没建成)", async () => {
      stubFetch((url) => {
        if (url.endsWith("/contents/generations/tasks")) throw new TypeError("fetch failed: ECONNRESET");
        return jsonRes({ status: "running" });
      });
      const err = await rejection(call);
      expect(err).toBeInstanceOf(Error);
      expect(err.charged).toBe(true);
    });
    it("#672 submit 5xx(网关超时/上游 500 可能落在收单之后)", async () => {
      stubFetch((url) => url.endsWith("/contents/generations/tasks")
        ? { ok: false, status: 500, text: async () => "internal error" }
        : jsonRes({ status: "running" }));
      const err = await rejection(call);
      expect(err.message).toContain("500");
      expect(err.charged).toBe(true);
    });
    it("#672 submit 503(网关侧同理,一并归入结果不明)", async () => {
      stubFetch((url) => url.endsWith("/contents/generations/tasks")
        ? { ok: false, status: 503, text: async () => "upstream busy" }
        : jsonRes({ status: "running" }));
      const err = await rejection(call);
      expect(err.charged).toBe(true);
    });
    // 反向(#672 拆窄):submit **4xx** = 引擎在收单前就拒了(限流 / 参数校验 / 鉴权)
    // = 可证明一分没花,必须留在 PLAIN(可重投)。
    //
    // 这条反向钉板是 #664 判官链定下的,原文写的是「submit 非 2xx 仍是 PLAIN」—— 当时
    // 防的是过度修正(别把预扣失败也算成已扣),但那个范围把 5xx 也框进了 PLAIN。5xx 与
    // fetch 抛证明不了引擎没收单,按家规属「结果不明」,#672 已把它们移到 charged 一侧
    // (见上面三条)。这里同步把反向保护拆窄为 4xx-only:保护还在,但只保护它真能证明的
    // 那一段。裁决出处:#672 票面。
    for (const status of [400, 401, 429] as const) {
      it(`#672 submit ${status}(4xx:收单前被拒,可证明没花钱)仍是 PLAIN`, async () => {
        stubFetch((url) => url.endsWith("/contents/generations/tasks")
          ? { ok: false, status, text: async () => "rejected before the engine took the order" }
          : jsonRes({ status: "running" }));
        const err = await rejection(call);
        expect(err.message).toContain(String(status));
        expect(err.charged).toBeFalsy();
      });
    }
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

  // #661 反向钉板(图像侧):POST 成功 ⇒ 已计费。之后**任何**死法都是「出了但我们没拿到」,
  // 不是「没出」—— 仍按已扣终结,绝不重投。判官 r1 P1-1:此前只有「无 URL」「下载非 2xx」
  // 两条盖住,json 解析异常 / 下载连接断 / 读流中断三种都原样 PLAIN 逸出,会被批级逻辑当成
  // 纯预扣失败重投、再计一次费。
  describe("#661 边界(图像侧):POST 成功之后的每一种死法都必须 charged", () => {
    async function generateOnce() {
      let err: any;
      try {
        await new BytePlusProvider("ark-test").generate({ prompt: "x", inputImageUrls: [], count: 1, model: "seedream" });
      } catch (e) { err = e; }
      return err;
    }
    it("响应里没有图片 URL(出了但读不到)", async () => {
      stubFetch((url) => url.endsWith("/images/generations") ? jsonRes({ data: [] }) : bytesRes());
      expect((await generateOnce()).charged).toBe(true);
    });
    it("回执 JSON 解析异常(已计费,回执读不出来)", async () => {
      stubFetch((url) => url.endsWith("/images/generations")
        ? { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); }, text: async () => "{" }
        : bytesRes());
      expect((await generateOnce()).charged).toBe(true);
    });
    it("结果下载连接直接断(fetch 自己 reject,连状态码都没有)", async () => {
      stubFetch((url) => {
        if (url.endsWith("/images/generations")) return jsonRes({ data: [{ url: "https://tos/img1.png" }] });
        throw new TypeError("fetch failed: ECONNRESET");
      });
      expect((await generateOnce()).charged).toBe(true);
    });
    it("结果读流中断(arrayBuffer 抛,字节没拿全)", async () => {
      stubFetch((url) => url.endsWith("/images/generations")
        ? jsonRes({ data: [{ url: "https://tos/img1.png" }] })
        : { ok: true, status: 200, arrayBuffer: async () => { throw new Error("stream aborted mid-body"); } });
      expect((await generateOnce()).charged).toBe(true);
    });
  });

  // ── #672 钉板(图像侧):付费 POST **本身**的每一种死法 ────────────────────────
  //
  // 上面那组盖的是「POST 已经 2xx 之后」。POST 自己没拿到 2xx 的三种形状此前一律按
  // PLAIN 逸出:/images/generations 是**同步计费端点**,一次 POST 就是一次计费事件,
  // 它的响应里直接带着成品图。所以:
  //   - fetch 自己抛(连响应都没拿到):请求可能已经到达引擎、模型已经跑完、只是回执丢
  //     在路上 —— 证明不了没花钱。
  //   - 5xx:网关超时 / 上游 500 可能发生在模型跑完**之后**,同样证明不了。
  //   - 4xx(限流 / 参数校验 / 鉴权):在跑模型**之前**就被拒的单,可证明一分没花 ——
  //     这是唯一能留在 PLAIN 的一段(反向钉板,见下)。
  // 家规:只有可证明引擎没花钱才许 PLAIN;已计费或结果不明一律 chargedError(终态)。
  describe("#672 图像付费 POST:结果不明按已扣终结,4xx 维持可重试", () => {
    async function generateOnce(count = 1) {
      let err: any;
      try {
        await new BytePlusProvider("ark-test").generate({ prompt: "x", inputImageUrls: [], count, model: "seedream" });
      } catch (e) { err = e; }
      return err;
    }
    it("POST 的 fetch 自己抛(连响应都没拿到,证明不了模型没跑)", async () => {
      stubFetch((url) => {
        if (url.endsWith("/images/generations")) throw new TypeError("fetch failed: ECONNRESET");
        return bytesRes();
      });
      const err = await generateOnce();
      expect(err).toBeInstanceOf(Error);
      expect(err.charged).toBe(true);
    });
    it("POST 500(上游错误可能落在模型跑完之后)", async () => {
      stubFetch((url) => url.endsWith("/images/generations")
        ? { ok: false, status: 500, text: async () => "internal error" }
        : bytesRes());
      const err = await generateOnce();
      expect(err.charged).toBe(true);
      // 单张一旦标为 charged,批级就按「不足额且已花钱」重新包装消息(F05 既有行为,
      // 本票未动);状态码仍留在 console.error 里。承重的是 charged 这一位。
      expect(err.message).toMatch(/usable images/);
    });
    it("POST 503(网关侧同理)", async () => {
      stubFetch((url) => url.endsWith("/images/generations")
        ? { ok: false, status: 503, text: async () => "upstream busy" }
        : bytesRes());
      expect((await generateOnce()).charged).toBe(true);
    });
    // 反向钉板:4xx 是收单前被拒,可证明没花钱 —— 拆窄后这一段的 PLAIN 语义一字不变。
    for (const status of [400, 401, 429] as const) {
      it(`POST ${status}(4xx:跑模型前被拒)仍是 PLAIN(可重投)`, async () => {
        stubFetch((url) => url.endsWith("/images/generations")
          ? { ok: false, status, text: async () => "rejected before the model ran" }
          : bytesRes());
        const err = await generateOnce();
        expect(err.message).toContain(String(status));
        expect(err.charged).toBeFalsy();
      });
    }

    // ── 批级(allSettled + anyCharged)后果,逐形状钉死 ───────────────────────
    // 每张图各发一次 POST;批级只有一个问题要答:**这一批能不能整体重投**。能重投的
    // 唯一条件是「每一条 rejection 都可证明没花钱」,即全部 4xx。
    it("P0:count 张全部 fetch 抛 ⇒ 批级 charged(绝不整批重投)", async () => {
      // 旧行为:三张全抛 ⇒ 三条 rejection 都没标记 ⇒ anyCharged=false ⇒ 整批 PLAIN ⇒
      // worker 重投 ⇒ 若这三次请求其实已经到达引擎,同一批图被计两次 COGS。
      stubFetch((url) => {
        if (url.endsWith("/images/generations")) throw new TypeError("fetch failed: ECONNRESET");
        return bytesRes();
      });
      const err = await generateOnce(3);
      expect(err.charged).toBe(true);
    });
    it("批级混合 4xx + 5xx ⇒ charged(fail closed:只要有一条证明不了,整批不许重投)", async () => {
      let n = 0;
      stubFetch((url) => {
        if (url.endsWith("/images/generations")) {
          n++;
          return n === 1
            ? { ok: false, status: 429, text: async () => "rate limited" }
            : { ok: false, status: 500, text: async () => "boom" };
        }
        return bytesRes();
      });
      const err = await generateOnce(2);
      expect(err.charged).toBe(true);
    });
    it("反向:批级全部 4xx ⇒ 仍是 PLAIN(整批可证明没花钱,重投不会双扣)", async () => {
      stubFetch((url) => url.endsWith("/images/generations")
        ? { ok: false, status: 429, text: async () => "rate limited" }
        : bytesRes());
      const err = await generateOnce(3);
      expect(err.message).toContain("429");
      expect(err.charged).toBeFalsy();
    });
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
