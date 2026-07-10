import { describe, it, expect, vi, beforeEach } from "vitest";

// The adapters' publish() now runs the REAL fail-closed authorization gate (spec §一.4): it reads
// the owner's MetaConnection and refuses (returns { error }, never throws, never calls Meta) when
// publishing isn't authorized. Mock the DB so we can exercise each refusal branch; a global fetch
// spy proves no Meta HTTP call escapes when unauthorized.
const { mockFindUnique } = vi.hoisted(() => ({ mockFindUnique: vi.fn() }));
vi.mock("@fikirtive/db", () => ({ prisma: { metaConnection: { findUnique: mockFindUnique } } }));
const fetchSpy = vi.fn();

import { listChannels, getChannel } from "../registry";

const POST = { caption: "x", mediaUrls: ["https://x/a.jpg"], postType: "feed-image" as const };
const TARGET = { id: "target-1", name: "Target" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
  vi.stubGlobal("fetch", fetchSpy);
});

describe("channelRegistry", () => {
  it("registers instagram and facebook", () => {
    const ids = listChannels().map((c) => c.id).sort();
    expect(ids).toEqual(["facebook", "instagram"]);
  });
  it("instagram declares its capabilities (carousel<=10, rate limit 25)", () => {
    const ig = getChannel("instagram")!;
    expect(ig.capabilities.maxMediaCount).toBe(10);
    expect(ig.capabilities.rateLimitPer24h).toBe(25);
    expect(ig.capabilities.postTypes).toContain("carousel");
    expect(ig.capabilities.supportsFirstComment).toBe(true);
    expect(ig.capabilities.supportsNativeSchedule).toBe(false);
  });
  it("getChannel returns undefined for an unknown id", () => {
    expect(getChannel("tiktok")).toBeUndefined();
  });
  it("facebook declares its capabilities", () => {
    const fb = getChannel("facebook")!;
    expect(fb.capabilities.maxMediaCount).toBe(1);
    expect(fb.capabilities.supportsNativeSchedule).toBe(true);
    expect(fb.capabilities.supportsFirstComment).toBe(false);
  });
});

// Contract (spec §一.4 / §八): the notImpl throw is UPGRADED, not abolished — publish() now
// refuses (returns { error }, never throws, never touches Meta) whenever it isn't authorized.
describe("organic publish adapters fail closed (App-Review-gated)", () => {
  const activeConn = {
    accessTokenEnc: "enc", canPublish: true, organicPublishPaused: false, status: "active",
    tokenExpiresAt: new Date(Date.now() + 3_600_000),
  };

  for (const id of ["instagram", "facebook"]) {
    it(`${id}: refuses (no throw, no Meta call) when there is NO connection`, async () => {
      mockFindUnique.mockResolvedValue(null);
      const res = await getChannel(id)!.publish("owner-1", TARGET, POST);
      expect(res).toEqual({ error: expect.stringMatching(/connect/i) });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it(`${id}: refuses when canPublish=false (App Review not passed — the primary gate)`, async () => {
      mockFindUnique.mockResolvedValue({ ...activeConn, canPublish: false });
      const res = await getChannel(id)!.publish("owner-1", TARGET, POST);
      expect(res).toMatchObject({ error: expect.any(String) });
      expect("externalId" in res).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it(`${id}: refuses when organicPublishPaused=true (kill-switch)`, async () => {
      mockFindUnique.mockResolvedValue({ ...activeConn, organicPublishPaused: true });
      const res = await getChannel(id)!.publish("owner-1", TARGET, POST);
      expect(res).toMatchObject({ error: expect.stringMatching(/paused/i) });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it(`${id}: refuses when the token is expired`, async () => {
      mockFindUnique.mockResolvedValue({ ...activeConn, tokenExpiresAt: new Date(Date.now() - 1000) });
      const res = await getChannel(id)!.publish("owner-1", TARGET, POST);
      expect(res).toMatchObject({ error: expect.stringMatching(/expired|reconnect/i) });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }
});
