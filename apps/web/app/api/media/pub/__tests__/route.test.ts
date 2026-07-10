import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signMediaToken } from "@fikirtive/token-crypto";

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

function req(): NextRequest {
  return { url: "http://x/api/media/pub" } as unknown as NextRequest;
}
const call = (token: string) => GET(req(), { params: Promise.resolve({ token }) });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MEDIA_PROXY_SECRET = SECRET;
  mockGet.mockResolvedValue(new Uint8Array([255, 216, 255])); // JPEG SOI-ish
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
