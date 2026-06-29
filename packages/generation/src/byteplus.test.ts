import { describe, it, expect, vi, afterEach } from "vitest";
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
    expect(out[0].ext).toBe("png");
    expect(Array.from(out[0].bytes)).toEqual([1, 2, 3]);
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
});
