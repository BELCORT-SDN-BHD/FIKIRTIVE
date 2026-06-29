import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFetchOwnerPages,
  mockFetchOwnerAdObjects,
  mockFetchOwnerAdAccounts,
  mockFindFirst,
  mockCreate,
  mockNewId,
  mockGenerationFindFirst,
  mockAssetFindUnique,
} = vi.hoisted(() => ({
  mockFetchOwnerPages: vi.fn(),
  mockFetchOwnerAdObjects: vi.fn(),
  mockFetchOwnerAdAccounts: vi.fn(),
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockNewId: vi.fn(() => "card-build-1"),
  mockGenerationFindFirst: vi.fn(),
  mockAssetFindUnique: vi.fn(),
}));

vi.mock("../meta-pages", () => ({ fetchOwnerPages: mockFetchOwnerPages }));
vi.mock("../meta-objects", () => ({
  fetchOwnerAdObjects: mockFetchOwnerAdObjects,
  fetchOwnerAdAccounts: mockFetchOwnerAdAccounts,
}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    chatMessage: { findFirst: mockFindFirst, create: mockCreate },
    generation: { findFirst: mockGenerationFindFirst },
    asset: { findUnique: mockAssetFindUnique },
  },
  Prisma: { InputJsonObject: {} },
}));
vi.mock("@fikirtive/core", () => ({ newId: mockNewId }));

import { proposeAdBuildForOwner } from "../meta-build-propose";

const PAGES = [{ id: "page-1", name: "My Page" }];
const AD_ACCOUNTS = [{ id: "act_123", name: "Test Account", currency: "MYR" }];
const AD_OBJECTS = [
  {
    id: "adset-1",
    level: "adset",
    name: "Ad Set 1",
    status: "ACTIVE",
    dailyBudgetMinor: 2000,
    currency: "MYR",
    accountId: "act_123",
  },
];

const VALID_INPUT = {
  goal: "Drive traffic",
  reasoning: "Testing",
  mode: "create" as const,
  objective: "OUTCOME_TRAFFIC",
  pageId: "page-1",
  dailyBudgetMinor: 5000,
  creative: {
    assetId: "gen-abc",
    kind: "image" as const,
    message: "Check this out!",
    cta: "LEARN_MORE",
    link: "https://example.com",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFindFirst.mockResolvedValue(null); // no prior messages → seq starts at 1
  mockCreate.mockResolvedValue({});
  mockNewId.mockReturnValue("card-build-1");
  // default: one ad account available
  mockFetchOwnerAdAccounts.mockResolvedValue({ accounts: AD_ACCOUNTS });
  // default: asset found as image
  mockGenerationFindFirst.mockResolvedValue({ assetId: "asset-abc" });
  mockAssetFindUnique.mockResolvedValue({ id: "asset-abc", mime: "image/jpeg" });
});

describe("proposeAdBuildForOwner", () => {
  it("passes through notConnected when fetchOwnerPages returns it", async () => {
    mockFetchOwnerPages.mockResolvedValue({ notConnected: true });
    const res = await proposeAdBuildForOwner("org1", "thread1", VALID_INPUT);
    expect(res).toEqual({ notConnected: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("passes through needsReconnect when fetchOwnerPages returns it", async () => {
    mockFetchOwnerPages.mockResolvedValue({ needsReconnect: true });
    const res = await proposeAdBuildForOwner("org1", "thread1", VALID_INPUT);
    expect(res).toEqual({ needsReconnect: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("passes through needsPageScope when fetchOwnerPages returns it", async () => {
    mockFetchOwnerPages.mockResolvedValue({ needsPageScope: true });
    const res = await proposeAdBuildForOwner("org1", "thread1", VALID_INPUT);
    expect(res).toEqual({ needsPageScope: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns invalid when asset is not owned by this org (Generation not found)", async () => {
    mockFetchOwnerPages.mockResolvedValue({ pages: PAGES });
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: AD_OBJECTS });
    mockGenerationFindFirst.mockResolvedValue(null); // asset not found
    const res = await proposeAdBuildForOwner("org1", "thread1", VALID_INPUT);
    expect(res).toMatchObject({ invalid: expect.arrayContaining([expect.objectContaining({ field: "creative.assetId" })]) });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns invalid when objective is unsupported", async () => {
    mockFetchOwnerPages.mockResolvedValue({ pages: PAGES });
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: AD_OBJECTS });
    mockGenerationFindFirst.mockResolvedValue({ assetId: "asset-abc" });
    mockAssetFindUnique.mockResolvedValue({ id: "asset-abc", mime: "image/jpeg" });
    const res = await proposeAdBuildForOwner("org1", "thread1", {
      ...VALID_INPUT,
      objective: "OUTCOME_APP_PROMOTION",
    });
    expect(res).toMatchObject({ invalid: expect.arrayContaining([expect.objectContaining({ field: "objective" })]) });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns invalid when link is not a valid http URL", async () => {
    mockFetchOwnerPages.mockResolvedValue({ pages: PAGES });
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: AD_OBJECTS });
    mockGenerationFindFirst.mockResolvedValue({ assetId: "asset-abc" });
    mockAssetFindUnique.mockResolvedValue({ id: "asset-abc", mime: "image/jpeg" });
    const res = await proposeAdBuildForOwner("org1", "thread1", {
      ...VALID_INPUT,
      creative: { ...VALID_INPUT.creative, link: "not-a-url" },
    });
    expect(res).toMatchObject({ invalid: expect.arrayContaining([expect.objectContaining({ field: "creative.link" })]) });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("persists ONE BUILD_CARD with server-built payload and returns { cardId, autoBuilt:false }", async () => {
    mockFetchOwnerPages.mockResolvedValue({ pages: PAGES });
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: AD_OBJECTS });
    mockGenerationFindFirst.mockResolvedValue({ assetId: "asset-abc" });
    mockAssetFindUnique.mockResolvedValue({ id: "asset-abc", mime: "image/jpeg" });
    mockFindFirst.mockResolvedValue({ seq: 3 });

    const res = await proposeAdBuildForOwner("org1", "thread1", VALID_INPUT);
    expect(res).toEqual({ cardId: "card-build-1", autoBuilt: false });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.kind).toBe("BUILD_CARD");
    expect(data.role).toBe("AGENT");
    expect(data.seq).toBe(4);
    expect(data.threadId).toBe("thread1");
    expect(data.ownerId).toBe("org1");
    // payload should have server-built fields
    expect(data.payload.approval).toBeDefined();
    expect(data.payload.accountId).toBe("act_123");
    expect(data.payload.currency).toBe("MYR"); // sourced from the ad ACCOUNT
    expect(data.payload.objective).toBe("OUTCOME_TRAFFIC");
  });

  it("invalid when pageId is not in owner's pages and no defaultPageId match", async () => {
    mockFetchOwnerPages.mockResolvedValue({ pages: [{ id: "page-other", name: "Other Page" }] });
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: AD_OBJECTS });
    mockGenerationFindFirst.mockResolvedValue({ assetId: "asset-abc" });
    mockAssetFindUnique.mockResolvedValue({ id: "asset-abc", mime: "image/jpeg" });
    const res = await proposeAdBuildForOwner("org1", "thread1", { ...VALID_INPUT, pageId: "page-1" });
    expect(res).toMatchObject({ invalid: expect.arrayContaining([expect.objectContaining({ field: "pageId" })]) });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("invalid when budget is zero", async () => {
    mockFetchOwnerPages.mockResolvedValue({ pages: PAGES });
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: AD_OBJECTS });
    mockGenerationFindFirst.mockResolvedValue({ assetId: "asset-abc" });
    mockAssetFindUnique.mockResolvedValue({ id: "asset-abc", mime: "image/jpeg" });
    const res = await proposeAdBuildForOwner("org1", "thread1", { ...VALID_INPUT, dailyBudgetMinor: 0 });
    expect(res).toMatchObject({ invalid: expect.arrayContaining([expect.objectContaining({ field: "dailyBudgetMinor" })]) });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("invalid when into_existing but adsetId not found in owner's ad objects", async () => {
    mockFetchOwnerPages.mockResolvedValue({ pages: PAGES });
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: AD_OBJECTS });
    mockGenerationFindFirst.mockResolvedValue({ assetId: "asset-abc" });
    mockAssetFindUnique.mockResolvedValue({ id: "asset-abc", mime: "image/jpeg" });
    const res = await proposeAdBuildForOwner("org1", "thread1", {
      ...VALID_INPUT,
      mode: "into_existing",
      intoExisting: { adsetId: "adset-UNKNOWN" },
    });
    expect(res).toMatchObject({ invalid: expect.arrayContaining([expect.objectContaining({ field: "intoExisting.adsetId" })]) });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("into_existing succeeds when adsetId found in owner's ad objects", async () => {
    mockFetchOwnerPages.mockResolvedValue({ pages: PAGES });
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: AD_OBJECTS });
    mockGenerationFindFirst.mockResolvedValue({ assetId: "asset-abc" });
    mockAssetFindUnique.mockResolvedValue({ id: "asset-abc", mime: "image/jpeg" });

    const res = await proposeAdBuildForOwner("org1", "thread1", {
      ...VALID_INPUT,
      mode: "into_existing",
      intoExisting: { adsetId: "adset-1" },
    });
    expect(res).toEqual({ cardId: "card-build-1", autoBuilt: false });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("video asset resolves assetKind=video", async () => {
    mockFetchOwnerPages.mockResolvedValue({ pages: PAGES });
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: AD_OBJECTS });
    mockGenerationFindFirst.mockResolvedValue({ assetId: "asset-vid" });
    mockAssetFindUnique.mockResolvedValue({ id: "asset-vid", mime: "video/mp4" });

    const res = await proposeAdBuildForOwner("org1", "thread1", {
      ...VALID_INPUT,
      creative: { ...VALID_INPUT.creative, kind: "video" },
    });
    expect(res).toEqual({ cardId: "card-build-1", autoBuilt: false });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("create-from-scratch: owner has an ad account but ZERO ad objects → persists BUILD_CARD with real accountId", async () => {
    // The key regression test: a brand-new advertiser has an account but no campaigns/adsets/ads.
    // proposeAdBuildForOwner must still succeed and use the accountId from the account list.
    mockFetchOwnerPages.mockResolvedValue({ pages: PAGES });
    mockFetchOwnerAdAccounts.mockResolvedValue({ accounts: AD_ACCOUNTS }); // real account
    mockFetchOwnerAdObjects.mockResolvedValue({ objects: [] }); // zero ad objects
    mockGenerationFindFirst.mockResolvedValue({ assetId: "asset-abc" });
    mockAssetFindUnique.mockResolvedValue({ id: "asset-abc", mime: "image/jpeg" });

    const res = await proposeAdBuildForOwner("org1", "thread1", VALID_INPUT);
    expect(res).toEqual({ cardId: "card-build-1", autoBuilt: false });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.payload.accountId).toBe("act_123"); // from account list, not objects[0]
  });

  it("no ad account → returns invalid[accountId] and persists NO card", async () => {
    mockFetchOwnerPages.mockResolvedValue({ pages: PAGES });
    mockFetchOwnerAdAccounts.mockResolvedValue({ accounts: [] }); // no accounts
    // fetchOwnerAdObjects should not even be called (early return)
    const res = await proposeAdBuildForOwner("org1", "thread1", VALID_INPUT);
    expect(res).toMatchObject({
      invalid: expect.arrayContaining([expect.objectContaining({ field: "accountId" })]),
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockFetchOwnerAdObjects).not.toHaveBeenCalled();
  });
});
