import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockFindUnique, mockUpsert, mockUpdate, mockDeleteMany, mockFetch } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("../auth-guard", () => ({ requireOwner: mockOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: { metaConnection: { findUnique: mockFindUnique, upsert: mockUpsert, update: mockUpdate, deleteMany: mockDeleteMany } },
}));
vi.mock("@fikirtive/core", () => ({ newId: () => "mc-1" }));
// Encrypt/decrypt are real (deterministic round-trip under a fixed key set below).

import { completeMetaConnect, getMetaConnection, disconnectMeta } from "../meta-actions";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
  process.env.BETTER_AUTH_SECRET = "s";
  process.env.META_APP_ID = "APPID";
  process.env.META_APP_SECRET = "APPSECRET";
  mockOwner.mockResolvedValue({ ownerId: "u1", email: "a@b.c" });
  vi.stubGlobal("fetch", mockFetch);
});

function jsonRes(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

describe("completeMetaConnect", () => {
  it("exchanges the code, encrypts the long-lived token, upserts owner-scoped", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))               // short-lived
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 })) // long-lived
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read"] } }));     // debug_token
    mockUpsert.mockResolvedValue({ id: "mc-1" });
    const res = await completeMetaConnect("the-code", "https://app/api/meta/callback");
    expect(res).toEqual({ ok: true });
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ ownerId: "u1" });
    // the stored token is ENCRYPTED, not the plaintext
    expect(call.create.accessTokenEnc).not.toContain("LONGTOKEN");
    expect(call.create.scope).toBe("ads_read");
    expect(call.create.status).toBe("active");
    expect(call.create.canWrite).toBe(false);
    expect(call.create.adsAutonomy).toBe("ASK");
  });
  it("sets canWrite:true when Meta grants ads_management", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 }))
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read", "ads_management"] } }));
    mockUpsert.mockResolvedValue({ id: "mc-1" });
    await completeMetaConnect("the-code", "https://app/api/meta/callback");
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.canWrite).toBe(true);
    expect(call.create.scope).toBe("ads_read,ads_management");
  });
  it("sets canWrite:false when Meta only grants ads_read", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 }))
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read"] } }));
    mockUpsert.mockResolvedValue({ id: "mc-1" });
    await completeMetaConnect("the-code", "https://app/api/meta/callback");
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.canWrite).toBe(false);
  });
  it("returns an error when the exchange fails", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes({ error: { message: "bad" } }, false));
    expect(await completeMetaConnect("x", "https://app/cb")).toEqual({ error: "exchange" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("getMetaConnection", () => {
  it("returns connected:false when there is no row", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await getMetaConnection()).toEqual({ connected: false });
  });
  it("returns accounts, adsAutonomy, canWrite, adsWritesPaused and NEVER the token", async () => {
    // first findUnique: status+meta fields; second findUnique (inside getMyAdAccounts): full row with enc token
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique
      .mockResolvedValueOnce({ status: "active", adsAutonomy: "ASK", canWrite: true, adsWritesPaused: false })
      .mockResolvedValueOnce({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockResolvedValueOnce(jsonRes({ data: [{ account_id: "act_1", name: "Kaia Cafe", currency: "MYR", account_status: 1 }] }));
    const res = await getMetaConnection();
    expect(res).toEqual({
      connected: true,
      status: "active",
      adsAutonomy: "ASK",
      canWrite: true,
      adsWritesPaused: false,
      accounts: [{ id: "act_1", name: "Kaia Cafe", currency: "MYR", status: "1" }],
    });
    expect(JSON.stringify(res)).not.toContain("LONGTOKEN");
    expect(JSON.stringify(res)).not.toContain("accessTokenEnc");
  });
  it("flags needsReconnect + marks expired on a Graph auth error", async () => {
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique
      .mockResolvedValueOnce({ status: "active", adsAutonomy: "ASK", canWrite: false, adsWritesPaused: false })
      .mockResolvedValueOnce({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockResolvedValueOnce(jsonRes({ error: { message: "invalid token", code: 190 } }, false));
    mockUpdate.mockResolvedValue({});
    const res = await getMetaConnection();
    expect(res).toEqual({ connected: true, status: "expired", needsReconnect: true });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: "u1" }, data: { status: "expired" } }));
  });
});

describe("disconnectMeta", () => {
  it("deletes only the caller's row", async () => {
    mockDeleteMany.mockResolvedValue({ count: 1 });
    expect(await disconnectMeta()).toEqual({ ok: true });
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { ownerId: "u1" } });
  });
});
