import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireOwner,
  mockCampaignFindMany,
  mockCampaignFindFirst,
  mockProjectFindMany,
  mockPostFindMany,
  mockGenerationFindMany,
  mockBroadcastFindMany,
  mockTrendFindMany,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockCampaignFindMany: vi.fn(),
  mockCampaignFindFirst: vi.fn(),
  mockProjectFindMany: vi.fn(),
  mockPostFindMany: vi.fn(),
  mockGenerationFindMany: vi.fn(),
  mockBroadcastFindMany: vi.fn(),
  mockTrendFindMany: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    campaign: { findMany: mockCampaignFindMany, findFirst: mockCampaignFindFirst },
    project: { findMany: mockProjectFindMany },
    scheduledPost: { findMany: mockPostFindMany },
    generation: { findMany: mockGenerationFindMany },
    broadcastRun: { findMany: mockBroadcastFindMany },
    trendSnapshot: { findMany: mockTrendFindMany },
  },
}));
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: () => "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
}));

import { getCampaign, listCampaigns } from "../campaign-view-data";

const OWNER = "org-a";
const CAMPAIGN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const NOW = new Date("2026-07-18T00:00:00.000Z");
const CAMPAIGN = {
  id: CAMPAIGN_ID,
  name: "Merdeka launch",
  status: "DRAFT",
  goal: "Drive pre-orders",
  startAt: new Date("2026-08-23T16:00:00.000Z"),
  endAt: new Date("2026-08-31T15:59:59.999Z"),
  planJson: { theme: "Local pride", rationale: null, entries: [], ideas: [] },
  createdAt: NOW,
  updatedAt: NOW,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BETTER_AUTH_SECRET = "campaign-view-test-secret";
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER, email: "owner@example.com" });
  mockCampaignFindMany.mockResolvedValue([CAMPAIGN]);
  mockCampaignFindFirst.mockResolvedValue(CAMPAIGN);
  mockProjectFindMany.mockResolvedValue([]);
  mockPostFindMany.mockResolvedValue([]);
  mockGenerationFindMany.mockResolvedValue([]);
  mockBroadcastFindMany.mockResolvedValue([]);
  mockTrendFindMany.mockResolvedValue([]);
});

describe("listCampaigns", () => {
  it("returns only live Campaigns for the session owner plus a server-issued retry draft", async () => {
    const result = await listCampaigns();
    expect(result).toMatchObject({
      ok: true,
      campaigns: [{ id: CAMPAIGN_ID, name: "Merdeka launch", plan: CAMPAIGN.planJson }],
      nextCampaignId: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
    });
    expect(mockCampaignFindMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: expect.not.objectContaining({ utmBase: true }),
    });
  });

  it("returns an auth error without querying", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    await expect(listCampaigns()).resolves.toEqual({ error: "Not authorized." });
    expect(mockCampaignFindMany).not.toHaveBeenCalled();
  });
});

describe("getCampaign", () => {
  it("scopes Campaign and every grouped summary independently to the authenticated owner", async () => {
    mockProjectFindMany.mockResolvedValue([
      { id: "p1", name: "Grouped project", campaignId: CAMPAIGN_ID, createdAt: NOW },
      { id: "p2", name: "Available project", campaignId: null, createdAt: NOW },
    ]);
    mockPostFindMany.mockResolvedValue([
      { id: "s1", channel: "instagram", caption: "Post", scheduledAt: NOW, status: "DRAFT", campaignId: CAMPAIGN_ID, createdAt: NOW },
    ]);
    mockGenerationFindMany.mockResolvedValue([
      { id: "g1", assetId: "asset-1", campaignId: CAMPAIGN_ID, createdAt: NOW, asset: { ext: "png" } },
    ]);
    mockBroadcastFindMany.mockResolvedValue([
      { id: "b1", purpose: "marketing", status: "completed", createdAt: NOW, executedAt: NOW },
    ]);
    mockTrendFindMany.mockResolvedValue([
      { id: "t1", summary: "Trend", sources: [], capturedAt: NOW, createdAt: NOW },
    ]);

    const result = await getCampaign(CAMPAIGN_ID);
    expect(result).toMatchObject({
      ok: true,
      campaign: {
        id: CAMPAIGN_ID,
        grouped: {
          projects: [{ id: "p1" }],
          scheduledPosts: [{ id: "s1" }],
          generations: [{ id: "g1", kind: "image" }],
          broadcasts: [{ id: "b1", purpose: "marketing", status: "completed" }],
        },
        available: { projects: [{ id: "p2" }] },
        trendSnapshots: [{ id: "t1" }],
      },
    });
    expect(mockCampaignFindFirst.mock.calls[0][0].where).toEqual({ id: CAMPAIGN_ID, ownerId: OWNER, deletedAt: null });
    for (const query of [
      mockProjectFindMany.mock.calls[0][0],
      mockPostFindMany.mock.calls[0][0],
      mockGenerationFindMany.mock.calls[0][0],
      mockBroadcastFindMany.mock.calls[0][0],
      mockTrendFindMany.mock.calls[0][0],
    ]) {
      expect(query.where.ownerId).toBe(OWNER);
    }
    expect(mockBroadcastFindMany.mock.calls[0][0].where).toEqual({
      ownerId: OWNER,
      campaignId: CAMPAIGN_ID,
    });
    for (const query of [
      mockProjectFindMany.mock.calls[0][0],
      mockPostFindMany.mock.calls[0][0],
      mockGenerationFindMany.mock.calls[0][0],
      mockTrendFindMany.mock.calls[0][0],
    ]) expect(query.where.deletedAt).toBeNull();
  });

  it("returns zero bytes for another tenant's Campaign id and never reads grouped rows", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "org-b", email: "b@example.com" });
    mockCampaignFindFirst.mockResolvedValue(null);
    await expect(getCampaign(CAMPAIGN_ID)).resolves.toEqual({ error: "Campaign not found." });
    expect(mockCampaignFindFirst.mock.calls[0][0].where.ownerId).toBe("org-b");
    expect(mockProjectFindMany).not.toHaveBeenCalled();
    expect(mockPostFindMany).not.toHaveBeenCalled();
    expect(mockGenerationFindMany).not.toHaveBeenCalled();
    expect(mockBroadcastFindMany).not.toHaveBeenCalled();
    expect(mockTrendFindMany).not.toHaveBeenCalled();
  });
});
