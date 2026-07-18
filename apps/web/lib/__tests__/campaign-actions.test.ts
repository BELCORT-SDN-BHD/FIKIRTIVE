import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireOwner,
  mockIsImpersonating,
  mockTransaction,
  mockCampaignCreate,
  mockCampaignFindFirst,
  mockCampaignFindMany,
  mockCampaignUpdateMany,
  mockTrendCreate,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockIsImpersonating: vi.fn(),
  mockTransaction: vi.fn(),
  mockCampaignCreate: vi.fn(),
  mockCampaignFindFirst: vi.fn(),
  mockCampaignFindMany: vi.fn(),
  mockCampaignUpdateMany: vi.fn(),
  mockTrendCreate: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    $transaction: mockTransaction,
    campaign: {
      create: mockCampaignCreate,
      findFirst: mockCampaignFindFirst,
      findMany: mockCampaignFindMany,
      updateMany: mockCampaignUpdateMany,
    },
    trendSnapshot: { create: mockTrendCreate },
  },
}));

let idCounter = 0;
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: () => `new-${++idCounter}`,
}));

import {
  approveCampaignEntry,
  deriveCampaignName,
  proposeCampaign,
  removeCampaignEntry,
  updateCampaignEntry,
} from "../campaign-actions";
import { getCampaign, listCampaigns } from "../campaign-view-data";

const OWNER = "org-a";
const UPDATED_AT = new Date("2026-07-15T02:00:00.000Z");
const PLAN = {
  theme: "Local pride, freshly baked",
  rationale: null,
  entries: [
    {
      id: "entry-1",
      date: "2026-08-24",
      platform: "instagram",
      format: "image",
      hook: "The box that sells out every Merdeka",
      brief: "Show the gift box opening on a bakery counter in warm morning light.",
      estCredits: 12,
      status: "proposed",
    },
  ],
  ideas: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER, email: "owner@example.com" });
  mockIsImpersonating.mockResolvedValue(false);
  mockCampaignCreate.mockResolvedValue({});
  mockTrendCreate.mockResolvedValue({});
  mockCampaignUpdateMany.mockResolvedValue({ count: 1 });
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      campaign: { create: mockCampaignCreate },
      trendSnapshot: { create: mockTrendCreate },
    }),
  );
});

describe("proposeCampaign", () => {
  it("creates one owner-scoped Campaign plan and the referenced trend conclusion for $0", async () => {
    const result = await proposeCampaign({
      goal: "Drive Merdeka gift-box pre-orders",
      period: { start: "2026-08-24", end: "2026-08-31", tz: "Asia/Kuala_Lumpur" },
      theme: "Local pride, freshly baked",
      rationale: {
        summary: "Locally rooted gift-box stories are gaining attention before Merdeka.",
        sources: [{ title: "Malaysia seasonal commerce brief", domain: "example.com" }],
        capturedAt: "2026-07-15T00:00:00.000Z",
      },
      items: [
        {
          date: "2026-08-24",
          platform: "instagram",
          format: "image",
          hook: "The box that sells out every Merdeka",
          brief: "Show the gift box opening on a bakery counter in warm morning light.",
          estCredits: 12,
        },
      ],
      ideas: ["A baker-led behind-the-scenes story"],
    });

    expect(result).toMatchObject({ ok: true, campaignId: "new-1" });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockCampaignCreate).toHaveBeenCalledTimes(1);
    const campaignData = mockCampaignCreate.mock.calls[0][0].data;
    expect(campaignData).toMatchObject({
      id: "new-1",
      ownerId: OWNER,
      name: "Drive Merdeka gift-box pre-orders",
      status: "DRAFT",
      goal: "Drive Merdeka gift-box pre-orders",
      startAt: new Date("2026-08-23T16:00:00.000Z"),
      endAt: new Date("2026-08-31T15:59:59.999Z"),
      utmBase: null,
      deletedAt: null,
    });
    expect(campaignData.planJson).toEqual({
      theme: "Local pride, freshly baked",
      rationale: {
        summary: "Locally rooted gift-box stories are gaining attention before Merdeka.",
        sources: [{ title: "Malaysia seasonal commerce brief", domain: "example.com" }],
        capturedAt: "2026-07-15T00:00:00.000Z",
      },
      entries: [
        {
          id: "new-2",
          date: "2026-08-24",
          platform: "instagram",
          format: "image",
          hook: "The box that sells out every Merdeka",
          brief: "Show the gift box opening on a bakery counter in warm morning light.",
          estCredits: 12,
          status: "proposed",
        },
      ],
      ideas: ["A baker-led behind-the-scenes story"],
    });
    expect(result).toMatchObject({ payload: campaignData.planJson });

    expect(mockTrendCreate).toHaveBeenCalledWith({
      data: {
        id: "new-3",
        ownerId: OWNER,
        summary: "Locally rooted gift-box stories are gaining attention before Merdeka.",
        sources: [{ title: "Malaysia seasonal commerce brief", domain: "example.com" }],
        capturedAt: new Date("2026-07-15T00:00:00.000Z"),
        campaignId: "new-1",
        deletedAt: null,
      },
    });
    expect(mockCampaignUpdateMany).not.toHaveBeenCalled();
  });

  it("takes ownerId only from the session and derives the same name every time", async () => {
    const input = {
      ownerId: "org-attacker",
      goal: "Launch the croffle",
      period: { start: "2026-08-01", end: "2026-08-02", tz: "Asia/Kuala_Lumpur" },
      theme: "A small launch",
      items: [{
        date: "2026-08-01",
        platform: "facebook",
        format: "carousel",
        hook: "Meet the croffle",
        brief: "Open on the crisp pastry, then reveal the finished croffle.",
        estCredits: 20,
      }],
    };
    await proposeCampaign(input);
    expect(mockCampaignCreate.mock.calls[0][0].data.ownerId).toBe(OWNER);
    expect(mockCampaignCreate.mock.calls[0][0].data.planJson.entries[0].format).toBe("carousel");
    expect(deriveCampaignName(input.goal)).toBe("Launch the croffle");
    expect(deriveCampaignName(input.goal).toLowerCase()).not.toContain("matcha");
    expect(deriveCampaignName(input.goal)).toBe(deriveCampaignName(input.goal));
  });

  it("rejects a non-English brief and never writes", async () => {
    const result = await proposeCampaign({
      goal: "Promote a weekend box",
      period: { start: "2026-08-01", end: "2026-08-02", tz: "Asia/Kuala_Lumpur" },
      theme: "Weekend sharing",
      items: [{
        date: "2026-08-01",
        platform: "instagram",
        format: "image",
        hook: "Weekend box",
        brief: "展示周末礼盒",
        estCredits: 12,
      }],
    });
    expect(result).toHaveProperty("error");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects research-body fields instead of copying a shadow report", async () => {
    const result = await proposeCampaign({
      goal: "Promote a weekend box",
      period: { start: "2026-08-01", end: "2026-08-02", tz: "Asia/Kuala_Lumpur" },
      theme: "Weekend sharing",
      rationale: {
        summary: "Gift bundles are rising.",
        sources: [{ title: "Brief", domain: "example.com" }],
        researchBody: "A full report must stay in RESEARCH_REPORT.",
      },
      items: [{
        date: "2026-08-01",
        platform: "instagram",
        format: "image",
        hook: "Weekend box",
        brief: "Show the full bundle and its individual pastries.",
        estCredits: 12,
      }],
    });
    expect(result).toHaveProperty("error");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "an impossible Campaign period date",
      period: { start: "2026-02-30", end: "2026-03-02", tz: "Asia/Kuala_Lumpur" },
      rationale: undefined,
    },
    {
      label: "an impossible trend capturedAt date",
      period: { start: "2026-02-28", end: "2026-03-02", tz: "Asia/Kuala_Lumpur" },
      rationale: {
        summary: "Gift bundles are rising.",
        sources: [{ title: "Brief", domain: "example.com" }],
        capturedAt: "2026-02-30T00:00:00.000Z",
      },
    },
  ])("rejects $label before any database write", async ({ period, rationale }) => {
    const result = await proposeCampaign({
      goal: "Promote a weekend box",
      period,
      theme: "Weekend sharing",
      ...(rationale ? { rationale } : {}),
      items: [{
        date: "2026-03-01",
        platform: "instagram",
        format: "image",
        hook: "Weekend box",
        brief: "Show the full bundle and its individual pastries.",
        estCredits: 12,
      }],
    });
    expect(result).toHaveProperty("error");
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("Campaign plan entry actions", () => {
  beforeEach(() => {
    mockCampaignFindFirst.mockResolvedValue({ planJson: PLAN, updatedAt: UPDATED_AT });
  });

  it("updates only the owner-scoped plan entry", async () => {
    const result = await updateCampaignEntry({
      campaignId: "campaign-1",
      entryId: "entry-1",
      patch: { hook: "A fresh Merdeka box", estCredits: 14 },
    });
    expect(result).toHaveProperty("ok", true);
    expect(mockCampaignFindFirst).toHaveBeenCalledWith({
      where: { id: "campaign-1", ownerId: OWNER, deletedAt: null },
      select: { planJson: true, updatedAt: true },
    });
    expect(mockCampaignUpdateMany).toHaveBeenCalledWith({
      where: { id: "campaign-1", ownerId: OWNER, deletedAt: null, updatedAt: UPDATED_AT },
      data: {
        planJson: expect.objectContaining({
          entries: [expect.objectContaining({ id: "entry-1", hook: "A fresh Merdeka box", estCredits: 14 })],
        }),
      },
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockTrendCreate).not.toHaveBeenCalled();
  });

  it("approves the plan entry without starting generation, spend, or publishing", async () => {
    const result = await approveCampaignEntry({ campaignId: "campaign-1", entryId: "entry-1" });
    expect(result).toHaveProperty("ok", true);
    const nextPlan = mockCampaignUpdateMany.mock.calls[0][0].data.planJson;
    expect(nextPlan.entries[0]).toEqual({ ...PLAN.entries[0], status: "approved" });
    expect(mockCampaignCreate).not.toHaveBeenCalled();
    expect(mockTrendCreate).not.toHaveBeenCalled();
  });

  it("removes only the requested entry", async () => {
    const result = await removeCampaignEntry({ campaignId: "campaign-1", entryId: "entry-1" });
    expect(result).toHaveProperty("ok", true);
    expect(mockCampaignUpdateMany.mock.calls[0][0].data.planJson.entries).toEqual([]);
  });

  it("cannot read or mutate another organization's campaign", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "org-b", email: "b@example.com" });
    mockCampaignFindFirst.mockResolvedValue(null);
    const result = await approveCampaignEntry({ campaignId: "org-a-campaign", entryId: "entry-1" });
    expect(result).toEqual({ error: "Campaign not found." });
    expect(mockCampaignFindFirst.mock.calls[0][0].where).toEqual({
      id: "org-a-campaign",
      ownerId: "org-b",
      deletedAt: null,
    });
    expect(mockCampaignUpdateMany).not.toHaveBeenCalled();
  });
});

describe("Campaign read surfaces", () => {
  it("lists only live campaigns for the session owner", async () => {
    mockCampaignFindMany.mockResolvedValue([{ id: "campaign-1" }]);
    expect(await listCampaigns()).toEqual([{ id: "campaign-1" }]);
    expect(mockCampaignFindMany.mock.calls[0][0]).toMatchObject({
      where: { ownerId: OWNER, deletedAt: null },
      orderBy: { updatedAt: "desc" },
    });
  });

  it("returns zero bytes for another organization's id and scopes every nested relation", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "org-b", email: "b@example.com" });
    mockCampaignFindFirst.mockResolvedValue(null);
    expect(await getCampaign("org-a-campaign")).toBeNull();
    const query = mockCampaignFindFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: "org-a-campaign", ownerId: "org-b", deletedAt: null });
    expect(query.select.generations.where).toEqual({ ownerId: "org-b", deletedAt: null });
    expect(query.select.scheduledPosts.where).toEqual({ ownerId: "org-b", deletedAt: null });
    expect(query.select.trendSnapshots.where).toEqual({ ownerId: "org-b", deletedAt: null });
  });
});
