import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockFindUnique, mockUpdate, mockFetch } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: { metaConnection: { findUnique: mockFindUnique, update: mockUpdate } },
}));

import { getMetaInsights } from "../meta-actions";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  vi.stubGlobal("fetch", mockFetch);
});
function jsonRes(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

describe("getMetaInsights", () => {
  it("returns notConnected when there's no row", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await getMetaInsights()).toEqual({ notConnected: true });
  });

  it("maps account insights and never leaks the token", async () => {
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique.mockResolvedValue({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch
      // /me/adaccounts
      .mockResolvedValueOnce(jsonRes({ data: [{ account_id: "1", name: "Kaia Cafe", currency: "MYR", account_status: 1, id: "act_1" }] }))
      // act_1/insights
      .mockResolvedValueOnce(jsonRes({ data: [{ spend: "120.50", impressions: "64312", reach: "35316", frequency: "1.82", clicks: "1775", ctr: "2.76", cpc: "0.71", cpm: "19.56" }] }));
    const res = await getMetaInsights("last_30d");
    if (!("accounts" in res)) throw new Error("expected accounts");
    expect(res.accounts[0].name).toBe("Kaia Cafe");
    expect(res.accounts[0].metrics.impressions).toBe("64312");
    expect(res.accounts[0].metrics.purchaseRoas).toBeNull(); // absent → null
    expect(JSON.stringify(res)).not.toContain("LONGTOKEN");
    expect(JSON.stringify(res)).not.toContain("accessTokenEnc");
  });

  it("returns needsReconnect on a Graph auth error", async () => {
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique.mockResolvedValue({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockResolvedValueOnce(jsonRes({ error: { message: "invalid", code: 190 } }, false));
    mockUpdate.mockResolvedValue({});
    expect(await getMetaInsights("last_30d")).toEqual({ needsReconnect: true });
  });

  it("returns transientError (F37) on a non-auth Graph error — never a false reconnect", async () => {
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique.mockResolvedValue({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockResolvedValueOnce(jsonRes({ error: { message: "server error", code: 2 } }, false));
    expect(await getMetaInsights("last_30d")).toEqual({ transientError: true });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
