import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../meta-oauth", () => ({ META_GRAPH_VERSION: "v21.0" }));

import { metaGraphPost, uploadAdImage, uploadAdVideo } from "../meta-graph";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("metaGraphPost", () => {
  it("posts form body with bearer token and returns parsed JSON", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const r = await metaGraphPost("tok", "s1", { status: "PAUSED" });
    expect(r).toEqual({ success: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("graph.facebook.com");
    expect(url).toContain("/s1");
    expect(init.method).toBe("POST");
  });

  it("throws with .metaError.code === 190 on a Meta auth error response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: 190, message: "Invalid OAuth access token." } }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(metaGraphPost("bad-tok", "act_1/campaigns", { status: "ACTIVE" }))
      .rejects.toMatchObject({ metaError: { code: 190 } });
  });
});

describe("uploadAdImage", () => {
  it("posts multipart to adimages and returns the image_hash", async () => {
    const file = { bytes: Buffer.from("fake-image"), filename: "hero.jpg", contentType: "image/jpeg" };
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ images: { "hero.jpg": { hash: "abc123", url: "https://example.com/img" } } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const hash = await uploadAdImage("tok", "act_123", file);
    expect(hash).toBe("abc123");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("graph.facebook.com");
    expect(url).toContain("act_123/adimages");
    expect(init.method).toBe("POST");
    expect(init.headers?.Authorization).toBe("Bearer tok");
    expect(init.body).toBeInstanceOf(FormData);
    // Content-Type must NOT be set manually (let fetch set the multipart boundary)
    expect(init.headers?.["Content-Type"]).toBeUndefined();
  });

  it("throws with .metaError.code === 190 on Meta auth error", async () => {
    const file = { bytes: Buffer.from("bytes"), filename: "img.jpg", contentType: "image/jpeg" };
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { code: 190, message: "Invalid OAuth access token." } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadAdImage("bad-tok", "act_1", file))
      .rejects.toMatchObject({ metaError: { code: 190 } });
  });
});

describe("uploadAdVideo", () => {
  it("posts multipart to advideos and returns the video_id", async () => {
    const file = { bytes: Buffer.from("fake-video"), filename: "clip.mp4", contentType: "video/mp4" };
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "vid_999" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const videoId = await uploadAdVideo("tok", "act_123", file);
    expect(videoId).toBe("vid_999");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("act_123/advideos");
    expect(init.method).toBe("POST");
    expect(init.headers?.Authorization).toBe("Bearer tok");
    expect(init.body).toBeInstanceOf(FormData);
  });
});
