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

import { verifySharePreview, sharePreviewTokenDigest } from "../share-preview";
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
