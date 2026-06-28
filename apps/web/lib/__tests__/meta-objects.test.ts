import { describe, it, expect, vi, beforeEach } from "vitest";

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

it("returns needsReconnect on code-190", async () => {
  mockFindUnique.mockResolvedValue({ accessTokenEnc: "e" });
  mockListCampaigns.mockRejectedValue({ metaError: { code: 190 } });
  expect(await fetchOwnerAdObjects("org1")).toEqual({ needsReconnect: true });
});
