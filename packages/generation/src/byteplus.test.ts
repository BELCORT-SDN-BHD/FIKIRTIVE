import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
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
    const assertion = expect(promise).rejects.toThrow(/byteplus video.*failed/);
    await vi.runAllTimersAsync();
    await assertion;
  });
  it("rejects an end frame (tailImageUrl) BEFORE any submit — no spend", async () => {
    const calls: string[] = [];
    stubFetch((url) => { calls.push(url); return jsonRes({ id: "should-not-happen" }); });
    await expect(new BytePlusProvider("ark-test").generateVideo({ prompt: "x", imageUrl: "https://r2/frame.png", tailImageUrl: "https://r2/end.png", durationSeconds: 5, model: "seedance-2-fast" }))
      .rejects.toThrow(/end frame/);
    expect(calls).toHaveLength(0); // pre-spend: never hit the API
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
    expect(body.image).toBe("https://r2/src.png");
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
});
