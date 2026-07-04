import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../meta-oauth", () => ({ META_GRAPH_VERSION: "v21.0" }));

import {
  getAccountInsights,
  getAccountInsightsSeries,
  getAdCreative,
  getAdInsights,
  metaGraphGet,
  metaGraphGetAll,
  metaGraphPost,
  uploadAdImage,
  uploadAdVideo,
} from "../meta-graph";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("metaGraphGet fixture", () => {
  it("serves deterministic connected-account fixture data without network in non-production", async () => {
    vi.stubEnv("META_GRAPH_MOCK", "fixture");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const accounts = await metaGraphGet("qa-token", "me/adaccounts", { fields: "name,account_id" });
    const metrics = await getAccountInsights("qa-token", "act_qa_1", "last_30d");
    const series = await getAccountInsightsSeries("qa-token", "act_qa_1", "last_30d");
    const ads = await getAdInsights("qa-token", "act_qa_1", "last_30d");
    const creative = await getAdCreative("qa-token", "ad_qa_1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(accounts.data).toHaveLength(2);
    expect(accounts.data[0]).toMatchObject({ id: "act_qa_1", name: "Kaia Cafe QA Ads", currency: "MYR" });
    expect(metrics).toMatchObject({ spend: "48.75", impressions: "18342", purchaseRoas: "3.1" });
    expect(series.map((d) => d.date)).toEqual(["2026-06-28", "2026-06-29", "2026-06-30"]);
    expect(ads.map((ad) => ad.adId)).toEqual(["ad_qa_1", "ad_qa_2"]);
    expect(creative).toMatchObject({ title: "Iced Latte Launch" });
  });

  it("does not enable fixture mode in production", async () => {
    vi.stubEnv("META_GRAPH_MOCK", "fixture");
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "real-ish" }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const out = await metaGraphGet("tok", "me/adaccounts", { fields: "name" });

    expect(out).toEqual({ data: [{ id: "real-ish" }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed on an unknown fixture path instead of falling through to network", async () => {
    vi.stubEnv("META_GRAPH_MOCK", "fixture");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(metaGraphGet("qa-token", "missing_fixture_path", { fields: "id" }))
      .rejects.toThrow(/fixture missing path/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("metaGraphGetAll (F37 pagination)", () => {
  it("follows paging.next across pages and concatenates .data", async () => {
    const fetchMock = vi.fn()
      // page 1 (via metaGraphGet)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "a" }, { id: "b" }], paging: { next: "https://graph.facebook.com/next2" } }) })
      // page 2 (via direct fetch of paging.next)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "c" }], paging: { next: "https://graph.facebook.com/next3" } }) })
      // page 3 — no next → stop
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "d" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await metaGraphGetAll("tok", "act_1/campaigns", { fields: "name" });
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops at the page cap (no infinite loop)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "x" }], paging: { next: "https://graph.facebook.com/loop" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await metaGraphGetAll("tok", "act_1/ads", {}, 3);
    expect(fetchMock).toHaveBeenCalledTimes(3); // page 1 + 2 more, then cap
    expect(out).toHaveLength(3);
  });

  it("returns page-1 data (best-effort) when a later page errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "a" }], paging: { next: "https://graph.facebook.com/next2" } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: "rate limited" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await metaGraphGetAll("tok", "act_1/adsets", {});
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });
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

  it("throws with clear error when Meta response has no images key", async () => {
    const file = { bytes: Buffer.from("bytes"), filename: "img.jpg", contentType: "image/jpeg" };
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadAdImage("tok", "act_1", file))
      .rejects.toThrow("adimages: unexpected Meta response shape");
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

  it("throws with .metaError.code === 190 on Meta auth error", async () => {
    const file = { bytes: Buffer.from("bytes"), filename: "clip.mp4", contentType: "video/mp4" };
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { code: 190, message: "Invalid OAuth access token." } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadAdVideo("bad-tok", "act_1", file))
      .rejects.toMatchObject({ metaError: { code: 190 } });
  });
});
