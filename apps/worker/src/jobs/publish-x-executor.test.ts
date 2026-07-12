/**
 * Worker X-path (E4-14 touchpoint ③) — the SAME "未授权即拒发" contract as the web adapter
 * (registry.test), proven on the WORKER executor. executeX gates on the generic ChannelConnection
 * (canPublish DERIVED from granted scope, DEFAULT false; per-channel kill-switch publishPaused) and,
 * when authorized + text-only, drives the shared publishX. No product code touched; prisma / storage
 * / token-crypto mocked; global fetch stubbed so ZERO real X call escapes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const channelConnectionFindFirst = vi.fn();
  const scheduledPostMediaCount = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    channelConnection: { findFirst: channelConnectionFindFirst },
    scheduledPostMedia: { count: scheduledPostMediaCount },
  };
  return { prisma, channelConnectionFindFirst, scheduledPostMediaCount };
});
vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));
vi.mock("@fikirtive/token-crypto", () => ({ decryptToken: () => "x-token", signMediaToken: () => "sig" }));
vi.mock("../storage.js", () => ({ storage: { ffmpegInput: vi.fn(), put: vi.fn(), readStream: vi.fn() } }));

import { executeX } from "./publish.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const POST: any = { id: "p1", ownerId: "owner-1", channel: "x", metaTargetId: null, caption: "hello world", firstComment: null };
const fetchSpy = vi.fn();
const active = (over: Record<string, unknown> = {}) => ({ accessTokenEnc: "enc", scope: "tweet.write", status: "active", publishPaused: false, tokenExpiresAt: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchSpy);
  m.scheduledPostMediaCount.mockResolvedValue(0);
});

describe("executeX — worker X path fail-closed (契约3)", () => {
  it("no connection → authFailed, ZERO X calls", async () => {
    m.channelConnectionFindFirst.mockResolvedValue(null);
    const res = await executeX(POST);
    expect(res).toMatchObject({ authFailed: true, error: expect.stringMatching(/connect/i) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("scope without tweet.write → authFailed (canPublish-equiv DEFAULT false)", async () => {
    m.channelConnectionFindFirst.mockResolvedValue(active({ scope: "tweet.read users.read" }));
    const res = await executeX(POST);
    expect(res).toMatchObject({ authFailed: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("publishPaused=true → authFailed (per-channel kill-switch)", async () => {
    m.channelConnectionFindFirst.mockResolvedValue(active({ publishPaused: true }));
    const res = await executeX(POST);
    expect(res).toMatchObject({ authFailed: true, error: expect.stringMatching(/paused/i) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("expired token → authFailed, ZERO X calls", async () => {
    m.channelConnectionFindFirst.mockResolvedValue(active({ tokenExpiresAt: new Date(Date.now() - 1000) }));
    const res = await executeX(POST);
    expect(res).toMatchObject({ authFailed: true, error: expect.stringMatching(/expired|reconnect/i) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("media present → deterministic NEEDS_ATTENTION refusal (X media upload deferred), ZERO X calls", async () => {
    m.channelConnectionFindFirst.mockResolvedValue(active());
    m.scheduledPostMediaCount.mockResolvedValue(2);
    const res = await executeX(POST);
    expect(res).toMatchObject({ mediaContractRefused: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("authorized + text-only → drives the shared publishX (returns tweet id)", async () => {
    m.channelConnectionFindFirst.mockResolvedValue(active());
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data: { id: "tweet-1" } }) });
    const res = await executeX(POST);
    expect(res).toMatchObject({ externalId: "tweet-1" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toContain("/2/tweets");
    expect(init.headers.Authorization).toBe("Bearer x-token");
  });
});
