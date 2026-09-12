/**
 * B0-28 — verifySharePreview two-layer authority tests (NODE-275 收口2).
 *
 * verify = HMAC valid (transport) ∧ row live (authority). Every failure mode returns null — the
 * seat-less read route's fail-closed 404. The row is what makes a link revocable and auditable;
 * the HMAC alone must never grant access.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRowFindFirst } = vi.hoisted(() => ({ mockRowFindFirst: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@fikirtive/db", () => ({
  prisma: { sharePreviewToken: { findFirst: mockRowFindFirst } },
}));

import { verifySharePreview, sharePreviewTokenDigest, isSharePreviewRowLive } from "../share-preview";
import { signSharePreviewToken } from "@fikirtive/token-crypto";

const SECRET = "share-secret-verify";
const NOW = 1_800_000_000_000;
const EXP = NOW + 3600_000;

function mint(owner = "org_1", post = "post_9"): string {
  return signSharePreviewToken(owner, post, EXP, SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SHARE_PREVIEW_SECRET = SECRET;
  mockRowFindFirst.mockResolvedValue({ id: "row-1" }); // default: row live
});

describe("verifySharePreview — two-layer (HMAC ∧ row live)", () => {
  it("grants access when the HMAC verifies AND the mint row is live — lookup pins digest + attested owner/post", async () => {
    const token = mint();
    const res = await verifySharePreview(token, NOW);
    expect(res).toEqual({ ownerId: "org_1", postId: "post_9", exp: EXP, rowId: "row-1" });
    const where = mockRowFindFirst.mock.calls[0][0].where;
    expect(where.tokenDigest).toBe(sharePreviewTokenDigest(token));
    expect(where.ownerId).toBe("org_1"); // HMAC-attested, not caller-supplied
    expect(where.scheduledPostId).toBe("post_9");
    expect(where.revokedAt).toBeNull(); // only unrevoked rows
    expect(where.expiresAt).toEqual({ gt: new Date(NOW) }); // server-side expiry re-check
  });

  it("HMAC alone NEVER grants access: a valid token whose row is gone/revoked/expired → null (404)", async () => {
    mockRowFindFirst.mockResolvedValueOnce(null); // revoked / missing / expired all land here
    expect(await verifySharePreview(mint(), NOW)).toBeNull();
  });

  it("a tampered token dies at the transport layer with ZERO db reads", async () => {
    const token = mint();
    expect(await verifySharePreview(token.slice(0, -2) + "zz", NOW)).toBeNull();
    expect(mockRowFindFirst).not.toHaveBeenCalled();
  });

  it("an expired token dies at the transport layer with ZERO db reads", async () => {
    expect(await verifySharePreview(mint(), EXP + 1)).toBeNull();
    expect(mockRowFindFirst).not.toHaveBeenCalled();
  });

  it("fails closed when SHARE_PREVIEW_SECRET is unset (no HMAC → null, zero db reads)", async () => {
    delete process.env.SHARE_PREVIEW_SECRET;
    expect(await verifySharePreview(mint(), NOW)).toBeNull();
    expect(mockRowFindFirst).not.toHaveBeenCalled();
  });
});

/**
 * SHARE-A7(docs/specs/share-preview.md 已冻结 · v1)—— 媒体代理路由用它问「这个 share 行现在
 * 还活着吗」,与 `verifySharePreview` 查的是同一张表,但只按 row id 一个键(路由手上没有
 * ownerId/postId 这两个 claim,它只从媒体 token 里拿到一个 shareRowId)。
 */
describe("isSharePreviewRowLive", () => {
  it("SHARE-A7 —— 行存在、未撤销、未过期 → true", async () => {
    mockRowFindFirst.mockResolvedValueOnce({ id: "row-1" });
    expect(await isSharePreviewRowLive("row-1", NOW)).toBe(true);
    const where = mockRowFindFirst.mock.calls[0][0].where;
    expect(where).toEqual({ id: "row-1", revokedAt: null, expiresAt: { gt: new Date(NOW) } });
  });

  it("SHARE-A7 —— 行被撤销（或已过期、或压根不存在）→ false，商家点 Revoke 之后立刻生效", async () => {
    mockRowFindFirst.mockResolvedValueOnce(null); // revoked / expired / missing all land here
    expect(await isSharePreviewRowLive("row-1", NOW)).toBe(false);
  });
});
