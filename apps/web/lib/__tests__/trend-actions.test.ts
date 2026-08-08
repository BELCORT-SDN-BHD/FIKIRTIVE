import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireOwner,
  mockIsImpersonating,
  mockCampaignFindFirst,
  mockTrendFindMany,
  mockTrendFindFirst,
  mockTrendCreate,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockIsImpersonating: vi.fn(),
  mockCampaignFindFirst: vi.fn(),
  mockTrendFindMany: vi.fn(),
  mockTrendFindFirst: vi.fn(),
  mockTrendCreate: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: mockIsImpersonating }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    campaign: { findFirst: mockCampaignFindFirst },
    trendSnapshot: {
      findMany: mockTrendFindMany,
      findFirst: mockTrendFindFirst,
      create: mockTrendCreate,
    },
  },
}));
vi.mock("@fikirtive/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fikirtive/core")>()),
  newId: () => "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
}));

import { listTrendSnapshots, saveTrendSnapshot } from "../trend-actions";

const OWNER = "org-a";
const CAMPAIGN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const SNAPSHOT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";
const CAPTURED = new Date("2026-07-15T00:00:00.000Z");
const CREATED = new Date("2026-07-15T00:01:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BETTER_AUTH_SECRET = "trend-test-secret";
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER, email: "a@example.com" });
  mockIsImpersonating.mockResolvedValue(false);
  mockCampaignFindFirst.mockResolvedValue({ id: CAMPAIGN_ID });
  mockTrendFindMany.mockResolvedValue([]);
  mockTrendFindFirst.mockResolvedValue(null);
  mockTrendCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...data,
    createdAt: CREATED,
  }));
});
describe("listTrendSnapshots", () => {
  it("returns only live conclusion rows for the session owner", async () => {
    const rows = [{
      id: "trend-1",
      summary: "Local gift bundles are rising.",
      sources: [{ title: "Seasonal brief", domain: "example.com" }],
      capturedAt: CAPTURED,
      campaignId: CAMPAIGN_ID,
      createdAt: CREATED,
    }];
    mockTrendFindMany.mockResolvedValue(rows);

    const result = await listTrendSnapshots({ campaignId: CAMPAIGN_ID, limit: 20 });
    expect(result).toMatchObject({
      ok: true,
      snapshots: [{ id: "trend-1", capturedAt: CAPTURED.toISOString() }],
      nextSnapshotId: SNAPSHOT_ID,
    });
    expect(mockCampaignFindFirst).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID, ownerId: OWNER, deletedAt: null },
      select: { id: true },
    });
    expect(mockTrendFindMany.mock.calls[0][0].where).toEqual({
      ownerId: OWNER,
      campaignId: CAMPAIGN_ID,
      deletedAt: null,
    });
  });

  it("returns zero bytes for another tenant's Campaign filter", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "org-b", email: "b@example.com" });
    mockCampaignFindFirst.mockResolvedValue(null);
    await expect(listTrendSnapshots({ campaignId: CAMPAIGN_ID })).resolves.toEqual({ error: "Campaign not found." });
    expect(mockCampaignFindFirst.mock.calls[0][0].where.ownerId).toBe("org-b");
    expect(mockTrendFindMany).not.toHaveBeenCalled();
  });

  it("rejects a client identity field instead of trusting it", async () => {
    await expect(listTrendSnapshots({ ownerId: "org-attacker", limit: 5 })).resolves.toEqual({
      error: "That trend filter isn't valid.",
    });
    expect(mockTrendFindMany).not.toHaveBeenCalled();
  });
});

describe("saveTrendSnapshot", () => {
  async function draft() {
    const result = await listTrendSnapshots();
    if (!("ok" in result)) throw new Error("test draft unavailable");
    return result;
  }

  it("saves one server-issued owner-scoped conclusion and validates the optional Campaign", async () => {
    const issued = await draft();
    const result = await saveTrendSnapshot({
      snapshotId: issued.nextSnapshotId,
      snapshotProof: issued.nextSnapshotProof,
      campaignId: CAMPAIGN_ID,
      evidence: {
        summary: "Gift bundles are rising.",
        sources: [{ title: "Seasonal brief", domain: "example.com" }],
        capturedAt: "2026-07-15T00:00:00.000Z",
      },
    });
    expect(result).toMatchObject({ ok: true, idempotent: false, snapshot: { id: SNAPSHOT_ID } });
    expect(mockCampaignFindFirst.mock.calls[0][0].where).toEqual({ id: CAMPAIGN_ID, ownerId: OWNER, deletedAt: null });
    expect(mockTrendCreate.mock.calls[0][0].data).toMatchObject({
      id: SNAPSHOT_ID,
      ownerId: OWNER,
      campaignId: CAMPAIGN_ID,
      summary: "Gift bundles are rising.",
      capturedAt: CAPTURED,
      deletedAt: null,
    });
  });

  it("replays the same signed snapshot idempotently", async () => {
    const issued = await draft();
    mockTrendFindFirst.mockResolvedValue({
      id: SNAPSHOT_ID,
      summary: "Gift bundles are rising.",
      sources: [{ title: "Seasonal brief", domain: "example.com" }],
      capturedAt: CAPTURED,
      campaignId: null,
      createdAt: CREATED,
    });
    const result = await saveTrendSnapshot({
      snapshotId: issued.nextSnapshotId,
      snapshotProof: issued.nextSnapshotProof,
      campaignId: null,
      evidence: {
        summary: "Gift bundles are rising.",
        sources: [{ title: "Seasonal brief", domain: "example.com" }],
        capturedAt: "2026-07-15T00:00:00.000Z",
      },
    });
    expect(result).toMatchObject({ ok: true, idempotent: true });
    expect(mockTrendCreate).not.toHaveBeenCalled();
  });

  it("refuses a capture date in the future and says why", async () => {
    const issued = await draft();
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    await expect(saveTrendSnapshot({
      snapshotId: issued.nextSnapshotId,
      snapshotProof: issued.nextSnapshotProof,
      campaignId: null,
      evidence: {
        summary: "Gift bundles are rising.",
        sources: [{ title: "Seasonal brief", domain: "example.com" }],
        capturedAt: future,
      },
    })).resolves.toEqual({
      error: "The captured date can't be in the future — use the day you actually saw this evidence.",
    });
    expect(mockTrendCreate).not.toHaveBeenCalled();
  });

  it("still accepts today and a past capture date", async () => {
    const issued = await draft();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    await expect(saveTrendSnapshot({
      snapshotId: issued.nextSnapshotId,
      snapshotProof: issued.nextSnapshotProof,
      campaignId: null,
      evidence: {
        summary: "Gift bundles are rising.",
        sources: [{ title: "Seasonal brief", domain: "example.com" }],
        capturedAt: past,
      },
    })).resolves.toMatchObject({ ok: true });
    expect(mockTrendCreate).toHaveBeenCalledTimes(1);
  });

  it("names the wrong box instead of the generic sentence, and keeps the generic one otherwise", async () => {
    const issued = await draft();
    await expect(saveTrendSnapshot({
      snapshotId: issued.nextSnapshotId,
      snapshotProof: issued.nextSnapshotProof,
      campaignId: null,
      evidence: {
        summary: "Gift bundles are rising.",
        sources: [{ title: "Seasonal brief", domain: "example.com" }],
        capturedAt: "not a date",
      },
    })).resolves.toEqual({
      error: "Enter the captured date as a real calendar date, for example 2026-08-01.",
    });
    await expect(saveTrendSnapshot({
      snapshotId: issued.nextSnapshotId,
      snapshotProof: issued.nextSnapshotProof,
      campaignId: null,
      evidence: { summary: "", sources: [] },
    })).resolves.toEqual({ error: "That trend snapshot isn't valid." });
    expect(mockTrendCreate).not.toHaveBeenCalled();
  });

  it("fails closed on a forged draft proof or cross-tenant Campaign", async () => {
    const issued = await draft();
    const evidence = {
      summary: "Gift bundles are rising.",
      sources: [{ title: "Seasonal brief", domain: "example.com" }],
    };
    await expect(saveTrendSnapshot({
      snapshotId: issued.nextSnapshotId,
      snapshotProof: "forged",
      campaignId: null,
      evidence,
    })).resolves.toEqual({ error: "Refresh the trend archive and try again." });
    mockCampaignFindFirst.mockResolvedValue(null);
    await expect(saveTrendSnapshot({
      snapshotId: issued.nextSnapshotId,
      snapshotProof: issued.nextSnapshotProof,
      campaignId: CAMPAIGN_ID,
      evidence,
    })).resolves.toEqual({ error: "Campaign not found." });
    expect(mockTrendCreate).not.toHaveBeenCalled();
  });
});
