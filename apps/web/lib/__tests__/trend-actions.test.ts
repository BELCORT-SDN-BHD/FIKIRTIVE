import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireOwner, mockFindMany } = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@fikirtive/db", () => ({
  prisma: { trendSnapshot: { findMany: mockFindMany } },
}));

import { listTrendSnapshots } from "../trend-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: "org-a", email: "a@example.com" });
});

describe("listTrendSnapshots", () => {
  it("returns only live conclusion rows for the session owner", async () => {
    const rows = [{
      id: "trend-1",
      summary: "Local gift bundles are rising.",
      sources: [{ title: "Seasonal brief", domain: "example.com" }],
      capturedAt: new Date("2026-07-15T00:00:00.000Z"),
      campaignId: "campaign-1",
      createdAt: new Date("2026-07-15T00:01:00.000Z"),
    }];
    mockFindMany.mockResolvedValue(rows);

    expect(await listTrendSnapshots({ campaignId: "campaign-1", limit: 20 })).toEqual(rows);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { ownerId: "org-a", campaignId: "campaign-1", deletedAt: null },
      orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        summary: true,
        sources: true,
        capturedAt: true,
        campaignId: true,
        createdAt: true,
      },
    });
  });

  it("returns zero bytes for another organization and ignores a client ownerId", async () => {
    mockRequireOwner.mockResolvedValue({ ownerId: "org-b", email: "b@example.com" });
    mockFindMany.mockResolvedValue([]);

    expect(await listTrendSnapshots({ ownerId: "org-a", limit: 5 })).toEqual([]);
    expect(mockFindMany.mock.calls[0][0].where).toEqual({ ownerId: "org-b", deletedAt: null });
  });

  it("does not query when auth fails", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    expect(await listTrendSnapshots()).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
