import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signMediaToken } from "@fikirtive/token-crypto";
import { prisma } from "@fikirtive/db";
import { MEDIA_PROXY_PER_CALLER_PER_10_MIN } from "@/lib/rate-limit-gates";

// The proxy streams real bytes (no session — Meta's servers call it). Mock storage only.
const mockGet = vi.fn();
vi.mock("@/lib/storage", () => ({
  storage: { get: (...a: unknown[]) => mockGet(...a) },
  mimeOf: () => "image/jpeg",
}));

const { GET } = await import("@/app/api/media/pub/[token]/route");

const SECRET = "media-secret-xyz";
const HASH = "a".repeat(64);
const KEY = `u/orgA/${HASH}.jpg`;

// #795 — the handler now reads the calling address for its rate-limit gate, so the stand-in
// request carries headers. One address per case keeps the (generous) gate out of the way of
// everything that is not about the gate.
function req(ip = "198.51.100.1"): NextRequest {
  return {
    url: "http://x/api/media/pub",
    headers: new Headers({ "x-forwarded-for": ip }),
  } as unknown as NextRequest;
}
const call = (token: string, ip?: string) => GET(req(ip), { params: Promise.resolve({ token }) });

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.MEDIA_PROXY_SECRET = SECRET;
  mockGet.mockResolvedValue(new Uint8Array([255, 216, 255])); // JPEG SOI-ish
  await prisma.rateLimitCounter.deleteMany({});
});

describe("/api/media/pub/[token] — signed media proxy (fail-closed)", () => {
  it("streams bytes for a valid, unexpired token", async () => {
    const token = signMediaToken("orgA", KEY, Date.now() + 60_000, SECRET);
    const res = await call(token);
    expect(res.status).toBe(200);
    // next/server is stubbed in web tests (lib/__tests__/__stubs__/next-server.ts): headers is the
    // plain object we passed, not a Headers instance — assert against it directly.
    const headers = res.headers as unknown as Record<string, string>;
    expect(headers["Content-Type"]).toBe("image/jpeg");
    expect(headers["Cache-Control"]).toContain("no-store");
    expect(mockGet).toHaveBeenCalledWith(KEY);
  });

  it("404s a forged/garbage token (never serves bytes)", async () => {
    const res = await call("garbage.sig");
    expect(res.status).toBe(404);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("404s an expired token", async () => {
    const token = signMediaToken("orgA", KEY, Date.now() - 1000, SECRET);
    const res = await call(token);
    expect(res.status).toBe(404);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("404s a token whose key is in ANOTHER owner's namespace (cross-tenant guard)", async () => {
    // key belongs to orgB but the token claims orgA → keyOwnerMatches fails → 404
    const token = signMediaToken("orgA", `u/orgB/${HASH}.jpg`, Date.now() + 60_000, SECRET);
    const res = await call(token);
    expect(res.status).toBe(404);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("404s a token signed with a DIFFERENT secret", async () => {
    const token = signMediaToken("orgA", KEY, Date.now() + 60_000, "attacker-secret");
    const res = await call(token);
    expect(res.status).toBe(404);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("fails closed (404) when MEDIA_PROXY_SECRET is unset", async () => {
    delete process.env.MEDIA_PROXY_SECRET;
    // even a token that WOULD verify under some secret can't verify against "" → 404
    const token = signMediaToken("orgA", KEY, Date.now() + 60_000, SECRET);
    const res = await call(token);
    expect(res.status).toBe(404);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("404s when the object is missing (storage throws)", async () => {
    mockGet.mockRejectedValue(new Error("empty object"));
    const token = signMediaToken("orgA", KEY, Date.now() + 60_000, SECRET);
    const res = await call(token);
    expect(res.status).toBe(404);
  });
});

/**
 * #795 —— 外链闸。这条路是公开的、无会话的:谁手上有一条有效签名 URL,就能用网络允许的最快
 * 速度一直拉。闸的位置比闸本身更要紧 —— 它必须排在 HMAC 校验**之后**,否则一个未授权的
 * GET 就变成了一次数据库写入,等于用一道闸开出一条更便宜的攻击路。
 */
describe("#795 —— 签名媒体代理的外链闸", () => {
  it("伪造的 token 一行计数都不产生 —— 闸排在密码学之后", async () => {
    const res = await call("garbage.sig", "198.51.100.77");
    expect(res.status).toBe(404);
    expect(await prisma.rateLimitCounter.count()).toBe(0);
  });

  it("验过身份的调用才计数,按出口地址", async () => {
    const token = signMediaToken("orgA", KEY, Date.now() + 60_000, SECRET);
    expect((await call(token, "198.51.100.78")).status).toBe(200);
    const rows = await prisma.rateLimitCounter.findMany({ select: { key: true, count: true } });
    expect(rows).toEqual([{ key: "media:198.51.100.78", count: 1 }]);
  });

  it("超过额度回 429(不是 404)—— 已经证明这条链接是他的,「太快了」才是诚实的答案", async () => {
    const ip = "198.51.100.79";
    // 直接把这个出口地址的计数顶到上限,免得为了一条断言真跑几百次。
    await prisma.rateLimitCounter.create({
      data: {
        key: `media:${ip}`,
        count: MEDIA_PROXY_PER_CALLER_PER_10_MIN,
        expiresAt: BigInt(Date.now() + 10 * 60_000),
      },
    });
    const token = signMediaToken("orgA", KEY, Date.now() + 60_000, SECRET);
    const res = await call(token, ip);
    expect(res.status).toBe(429);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
