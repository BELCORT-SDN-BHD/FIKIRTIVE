import { it, expect, vi, beforeEach } from "vitest";

const { mockFindUnique, mockUpdate, mockListCampaigns, mockListAdSets, mockListAds, mockMetaGraphGet } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockListCampaigns: vi.fn(),
  mockListAdSets: vi.fn(),
  mockListAds: vi.fn(),
  mockMetaGraphGet: vi.fn(),
}));

vi.mock("../meta-graph", () => ({
  metaGraphGet: mockMetaGraphGet,
  listCampaigns: mockListCampaigns,
  listAdSets: mockListAdSets,
  listAds: mockListAds,
}));
vi.mock("../token-encryption", () => ({ decryptToken: () => "tok" }));
vi.mock("@fikirtive/db", () => ({
  prisma: { metaConnection: { findUnique: mockFindUnique, update: mockUpdate } },
}));

import { fetchOwnerAdObjects } from "../meta-objects";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: me/adaccounts returns one account
  mockMetaGraphGet.mockResolvedValue({ data: [{ id: "act_1", account_id: "1", name: "Test Acct", currency: "USD" }] });
  mockUpdate.mockResolvedValue({});
});

it("returns notConnected when no MetaConnection", async () => {
  mockFindUnique.mockResolvedValue(null);
  expect(await fetchOwnerAdObjects("org1")).toEqual({ notConnected: true });
});

it("maps adsets with budget + schedule", async () => {
  mockFindUnique.mockResolvedValue({ accessTokenEnc: "e" });
  mockListCampaigns.mockResolvedValue([{ id: "c1", name: "C", effective_status: "ACTIVE", account_id: "act_1", currency: "USD" }]);
  mockListAdSets.mockResolvedValue([{ id: "s1", name: "S", effective_status: "PAUSED", daily_budget: "2000", start_time: "t", account_id: "act_1", currency: "USD" }]);
  mockListAds.mockResolvedValue([]);
  const res = await fetchOwnerAdObjects("org1");
  expect("objects" in res && res.objects.find(o => o.level === "adset")).toMatchObject({
    id: "s1", status: "PAUSED", dailyBudgetMinor: 2000, currency: "USD",
  });
});

// ── FIX B: currency comes from the ACCOUNT (me/adaccounts), not the node ──
// Meta does NOT return `currency` on campaign/adset/ad nodes — in production it's "".
// fetchOwnerAdObjects must source currency from the owner's ad account.
it("inherits each object's currency from its AD ACCOUNT, not the node", async () => {
  mockFindUnique.mockResolvedValue({ accessTokenEnc: "e" });
  // The account is MYR. The node mocks deliberately carry NO currency (real Meta behaviour).
  mockMetaGraphGet.mockResolvedValue({ data: [{ id: "act_1", account_id: "1", name: "Acct", currency: "MYR" }] });
  mockListCampaigns.mockResolvedValue([{ id: "c1", name: "C", effective_status: "ACTIVE", account_id: "act_1" }]);
  mockListAdSets.mockResolvedValue([{ id: "s1", name: "S", effective_status: "PAUSED", daily_budget: "2000", account_id: "act_1" }]);
  mockListAds.mockResolvedValue([{ id: "a1", name: "A", effective_status: "ACTIVE", account_id: "act_1" }]);

  const res = await fetchOwnerAdObjects("org1");
  expect("objects" in res).toBe(true);
  if (!("objects" in res)) return;
  for (const o of res.objects) {
    expect(o.currency).toBe("MYR"); // sourced from the account, never the node
  }
});

it("falls back to the request account id's currency when the node omits account_id", async () => {
  mockFindUnique.mockResolvedValue({ accessTokenEnc: "e" });
  mockMetaGraphGet.mockResolvedValue({ data: [{ id: "act_9", account_id: "9", name: "Acct", currency: "GBP" }] });
  // node has no account_id field at all
  mockListCampaigns.mockResolvedValue([{ id: "c1", name: "C", effective_status: "ACTIVE" }]);
  mockListAdSets.mockResolvedValue([]);
  mockListAds.mockResolvedValue([]);

  const res = await fetchOwnerAdObjects("org1");
  expect("objects" in res && res.objects[0].currency).toBe("GBP");
});

it("returns needsReconnect on code-190", async () => {
  mockFindUnique.mockResolvedValue({ accessTokenEnc: "e" });
  mockListCampaigns.mockRejectedValue({ metaError: { code: 190 } });
  expect(await fetchOwnerAdObjects("org1")).toEqual({ needsReconnect: true });
});

it("returns transientError (F37) on a non-auth Graph error — never a false reconnect", async () => {
  mockFindUnique.mockResolvedValue({ accessTokenEnc: "e" });
  mockListCampaigns.mockRejectedValue(new Error("Graph 500"));
  expect(await fetchOwnerAdObjects("org1")).toEqual({ transientError: true });
  expect(mockUpdate).not.toHaveBeenCalled();
});
