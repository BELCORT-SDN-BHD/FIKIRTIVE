import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOwner, mockFindUnique, mockUpsert, mockUpdate, mockDeleteMany, mockFetch, mockIsImpersonating } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockFetch: vi.fn(),
  mockIsImpersonating: vi.fn(),
}));

vi.mock("../auth-guard", async () => ({ requireOwner: mockOwner, resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));
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
  mockIsImpersonating.mockResolvedValue(false);
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
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read"], user_id: "1784512" } })); // debug_token
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
  it("stores metaUserId from debug_token so the Meta data-deletion callback can match this connection", async () => {
    // 2026-07-04 对抗审查抓到的 blocker:此前 metaUserId 从不写入 → /api/meta/data-deletion
    // 的 where:{metaUserId} 永远匹配不到 → 合规回调形同虚设。user_id 已在 debug_token
    // 响应里(dj.data.user_id),零额外请求即可存。
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 }))
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read"], user_id: "1784512" } }));
    mockUpsert.mockResolvedValue({ id: "mc-1" });
    await completeMetaConnect("the-code", "https://app/api/meta/callback");
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.metaUserId).toBe("1784512");
    expect(call.update.metaUserId).toBe("1784512");
  });
  it("sets canWrite:true when Meta grants ads_management", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 }))
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read", "ads_management"], user_id: "1784512" } }));
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
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read"], user_id: "1784512" } }));
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
  it("blocks while impersonating before exchanging or writing tokens", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    const res = await completeMetaConnect("the-code", "https://app/api/meta/callback");
    expect(res).toEqual({ error: "Paused while impersonating a customer — exit impersonation to connect Meta." });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
  // #573 fail-closed. Until this ticket a failed debug_token still produced a stored
  // connection (scope:"", canWrite:false, metaUserId:null). That row was invisible to
  // /api/meta/data-deletion — it matches on metaUserId — so a merchant's Meta-side deletion
  // request would have been answered with a confirmation code while the encrypted token
  // stayed in our database. Now the connect fails instead, and nothing is written.
  it("#573: refuses to store the connection when debug_token fails (no un-deletable row)", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 }))
      .mockResolvedValueOnce(jsonRes({ error: { message: "invalid" } }, false)); // debug_token fails
    const res = await completeMetaConnect("the-code", "https://app/api/meta/callback");
    expect(res).toEqual({ error: "incomplete" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
  it("#573: refuses to store the connection when debug_token answers without a user_id", async () => {
    // The narrower half of the same guard: debug_token responded 200 with real scopes but no
    // user_id at all. Scopes alone are not enough — without the id the data-deletion callback
    // can never find this row, so the connect fails rather than storing it.
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 }))
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read", "ads_management"] } }));
    const res = await completeMetaConnect("the-code", "https://app/api/meta/callback");
    expect(res).toEqual({ error: "incomplete" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
  it("#573: accepts a numeric user_id (Meta returns it unquoted on some responses)", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 }))
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read"], user_id: 1784512 } }));
    mockUpsert.mockResolvedValue({ id: "mc-1" });
    const res = await completeMetaConnect("the-code", "https://app/api/meta/callback");
    expect(res).toEqual({ ok: true });
    expect(mockUpsert.mock.calls[0][0].create.metaUserId).toBe("1784512");
  });
  it("sets canManagePages:true when Meta grants pages_show_list", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 }))
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read", "ads_management", "pages_show_list", "business_management"], user_id: "1784512" } }));
    mockUpsert.mockResolvedValue({ id: "mc-1" });
    await completeMetaConnect("the-code", "https://app/api/meta/callback");
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.canManagePages).toBe(true);
    expect(call.create.defaultPageId).toBeNull();
  });
  it("sets canManagePages:false when Meta does not grant pages_show_list", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 }))
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read", "ads_management"], user_id: "1784512" } }));
    mockUpsert.mockResolvedValue({ id: "mc-1" });
    await completeMetaConnect("the-code", "https://app/api/meta/callback");
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.canManagePages).toBe(false);
    expect(call.create.defaultPageId).toBeNull();
  });
  it("L1: sets canPublish:true ONLY when Meta grants BOTH instagram_content_publish + pages_manage_posts", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 }))
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["pages_show_list", "instagram_content_publish", "pages_manage_posts"], user_id: "1784512" } }));
    mockUpsert.mockResolvedValue({ id: "mc-1" });
    await completeMetaConnect("the-code", "https://app/api/meta/callback");
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.canPublish).toBe(true);
    // additive default kill-switch is not set on connect (defaults false at the DB layer)
    expect(call.create.organicPublishPaused).toBeUndefined();
  });
  it("L1: canPublish stays false when only ONE post scope is granted (fail-closed until App Review)", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 }))
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read", "instagram_content_publish"], user_id: "1784512" } }));
    mockUpsert.mockResolvedValue({ id: "mc-1" });
    await completeMetaConnect("the-code", "https://app/api/meta/callback");
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.canPublish).toBe(false);
  });
  it("L1: canPublish is false for a legacy ads-only grant (zero behavior change for existing connections)", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes({ access_token: "short" }))
      .mockResolvedValueOnce(jsonRes({ access_token: "LONGTOKEN", expires_in: 5184000 }))
      .mockResolvedValueOnce(jsonRes({ data: { scopes: ["ads_read", "ads_management", "pages_show_list", "business_management"], user_id: "1784512" } }));
    mockUpsert.mockResolvedValue({ id: "mc-1" });
    await completeMetaConnect("the-code", "https://app/api/meta/callback");
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.canPublish).toBe(false);
  });
});

describe("getMetaConnection", () => {
  it("returns connected:false when there is no row", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await getMetaConnection()).toEqual({ connected: false });
  });
  it("returns owner-scoped canPublish with the account view and NEVER the token", async () => {
    // first findUnique: status+meta fields; second findUnique (inside getMyAdAccounts): full row with enc token
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique
      .mockResolvedValueOnce({ status: "active", adsAutonomy: "ASK", canWrite: true, adsWritesPaused: false, canManagePages: false, canPublish: true, defaultPageId: null })
      .mockResolvedValueOnce({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockResolvedValueOnce(jsonRes({ data: [{ account_id: "act_1", name: "Kaia Cafe", currency: "MYR", account_status: 1 }] }));
    const res = await getMetaConnection();
    expect(res).toEqual({
      connected: true,
      status: "active",
      adsAutonomy: "ASK",
      canWrite: true,
      adsWritesPaused: false,
      canManagePages: false,
      canPublish: true,
      defaultPageId: null,
      accounts: [{ id: "act_1", name: "Kaia Cafe", currency: "MYR", status: "1" }],
    });
    expect(JSON.stringify(res)).not.toContain("LONGTOKEN");
    expect(JSON.stringify(res)).not.toContain("accessTokenEnc");
    expect(mockFindUnique).toHaveBeenNthCalledWith(1, {
      where: { ownerId: "u1" },
      select: {
        status: true,
        adsAutonomy: true,
        canWrite: true,
        adsWritesPaused: true,
        canManagePages: true,
        canPublish: true,
        defaultPageId: true,
      },
    });
  });
  it("flags needsReconnect + marks expired on a Graph auth error", async () => {
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique
      .mockResolvedValueOnce({ status: "active", adsAutonomy: "ASK", canWrite: false, adsWritesPaused: false, canManagePages: false, defaultPageId: null })
      .mockResolvedValueOnce({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockResolvedValueOnce(jsonRes({ error: { message: "invalid token", code: 190 } }, false));
    mockUpdate.mockResolvedValue({});
    const res = await getMetaConnection();
    expect(res).toEqual({ connected: true, status: "expired", needsReconnect: true, adsAutonomy: "ASK", canWrite: false, adsWritesPaused: false, canManagePages: false, canPublish: false, defaultPageId: null });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: "u1" }, data: { status: "expired" } }));
  });
  it("F37: a transient Graph failure (network throw) reports transientError, NOT needsReconnect, and does NOT mark expired", async () => {
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique
      .mockResolvedValueOnce({ status: "active", adsAutonomy: "ASK", canWrite: true, adsWritesPaused: false, canManagePages: false, defaultPageId: null })
      .mockResolvedValueOnce({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed")); // network blip — no metaError at all
    const res = await getMetaConnection();
    expect(res).toEqual({
      connected: true,
      status: "active", // the REAL DB status — not a hardcoded "expired"
      transientError: true,
      adsAutonomy: "ASK",
      canWrite: true,
      adsWritesPaused: false,
      canManagePages: false,
      canPublish: false,
      defaultPageId: null,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("F37: a Meta rate-limit error (code 4) is transient, not a reconnect", async () => {
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique
      .mockResolvedValueOnce({ status: "active", adsAutonomy: "ASK", canWrite: false, adsWritesPaused: false, canManagePages: false, defaultPageId: null })
      .mockResolvedValueOnce({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockResolvedValueOnce(
      jsonRes({ error: { message: "Application request limit reached", type: "OAuthException", code: 4 } }, false),
    );
    const res = await getMetaConnection();
    expect(res).toMatchObject({ connected: true, status: "active", transientError: true });
    expect((res as { needsReconnect?: boolean }).needsReconnect).toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("F37: a Meta 5xx (code 2, transient) is transient, not a reconnect", async () => {
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique
      .mockResolvedValueOnce({ status: "active", adsAutonomy: "ASK", canWrite: false, adsWritesPaused: false, canManagePages: false, defaultPageId: null })
      .mockResolvedValueOnce({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockResolvedValueOnce(jsonRes({ error: { message: "An unexpected error has occurred", code: 2 } }, false));
    const res = await getMetaConnection();
    expect(res).toMatchObject({ connected: true, transientError: true });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns canManagePages + defaultPageId in the connection result", async () => {
    const { encryptToken } = await import("../token-encryption");
    mockFindUnique
      .mockResolvedValueOnce({ status: "active", adsAutonomy: "ASK", canWrite: true, adsWritesPaused: false, canManagePages: true, defaultPageId: "pg_1" })
      .mockResolvedValueOnce({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
    mockFetch.mockResolvedValueOnce(jsonRes({ data: [{ account_id: "act_1", name: "Kaia Cafe", currency: "MYR", account_status: 1 }] }));
    const res = await getMetaConnection();
    expect(res).toMatchObject({ connected: true, canManagePages: true, defaultPageId: "pg_1" });
  });
});

describe("disconnectMeta", () => {
  it("deletes only the caller's row", async () => {
    mockDeleteMany.mockResolvedValue({ count: 1 });
    expect(await disconnectMeta()).toEqual({ ok: true });
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { ownerId: "u1" } });
  });
  it("blocks while impersonating before deleting the customer's connection", async () => {
    mockIsImpersonating.mockResolvedValue(true);
    expect(await disconnectMeta()).toEqual({ error: "Paused while impersonating a customer — exit impersonation to disconnect Meta." });
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});
