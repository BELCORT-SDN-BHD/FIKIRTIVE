import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../meta-oauth", () => ({ META_GRAPH_VERSION: "v21.0" }));

import { metaGraphPost } from "../meta-graph";

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
