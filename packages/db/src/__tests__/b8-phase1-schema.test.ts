/**
 * B8 一期 schema acceptance tests (AC-01/02/03).
 *
 * Runs against a real *_test Postgres after migrations are deployed. The global
 * setup truncates Organization CASCADE before every test, so each case begins clean.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../index.js";

const ORG_A = "b8-org-a";
const ORG_B = "b8-org-b";
const NOW = new Date("2026-07-14T00:00:00.000Z");

beforeEach(async () => {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
});

function createCampaign(id = "campaign-a") {
  return prisma.campaign.create({
    data: {
      id,
      ownerId: ORG_A,
      name: "Raya launch",
      goal: "Launch the Raya collection",
      startAt: NOW,
      endAt: new Date("2026-07-21T00:00:00.000Z"),
      planJson: { entries: [] },
    },
  });
}

function createContact(id = "contact-a") {
  return prisma.contact.create({
    data: {
      id,
      ownerId: ORG_A,
      name: "Aisyah",
      source: "whatsapp",
      firstTouchAt: NOW,
      lastSeenAt: NOW,
    },
  });
}

describe("B8 AC-01 — tested findMany/updateMany/findFirstOrThrow; findUnique/aggregate/groupBy/count are intentional exemptions", () => {
  it("Campaign rejects unscoped access and Org B cannot read or update Org A", async () => {
    await createCampaign();

    await expect(prisma.campaign.findMany({ where: {} })).rejects.toThrow(/tenant-guard/);
    await expect(prisma.campaign.findMany({ where: { ownerId: ORG_B } })).resolves.toHaveLength(0);
    await expect(
      prisma.campaign.updateMany({
        where: { id: "campaign-a", ownerId: ORG_B },
        data: { name: "cross-tenant write" },
      }),
    ).resolves.toEqual({ count: 0 });
    await expect(
      prisma.campaign.findFirstOrThrow({ where: { id: "campaign-a", ownerId: ORG_A } }),
    ).resolves.toMatchObject({ name: "Raya launch" });
  });

  it("TrendSnapshot rejects unscoped access and Org B cannot read or update Org A", async () => {
    await prisma.trendSnapshot.create({
      data: {
        id: "trend-a",
        ownerId: ORG_A,
        summary: "Short-form product demos are rising",
        sources: [{ title: "Market note", domain: "example.com" }],
        capturedAt: NOW,
      },
    });

    await expect(prisma.trendSnapshot.findMany({ where: {} })).rejects.toThrow(/tenant-guard/);
    await expect(prisma.trendSnapshot.findMany({ where: { ownerId: ORG_B } })).resolves.toHaveLength(0);
    await expect(
      prisma.trendSnapshot.updateMany({
        where: { id: "trend-a", ownerId: ORG_B },
        data: { summary: "cross-tenant write" },
      }),
    ).resolves.toEqual({ count: 0 });
    await expect(
      prisma.trendSnapshot.findFirstOrThrow({ where: { id: "trend-a", ownerId: ORG_A } }),
    ).resolves.toMatchObject({ summary: "Short-form product demos are rising" });
  });

  it("Contact rejects unscoped access and Org B cannot read or update Org A", async () => {
    await createContact();

    await expect(prisma.contact.findMany({ where: {} })).rejects.toThrow(/tenant-guard/);
    await expect(prisma.contact.findMany({ where: { ownerId: ORG_B } })).resolves.toHaveLength(0);
    await expect(
      prisma.contact.updateMany({
        where: { id: "contact-a", ownerId: ORG_B },
        data: { name: "cross-tenant write" },
      }),
    ).resolves.toEqual({ count: 0 });
    await expect(
      prisma.contact.findFirstOrThrow({ where: { id: "contact-a", ownerId: ORG_A } }),
    ).resolves.toMatchObject({ name: "Aisyah" });
  });

  it("ContactIdentity rejects unscoped access and Org B cannot read or update Org A", async () => {
    await createContact();
    await prisma.contactIdentity.create({
      data: {
        id: "identity-a",
        ownerId: ORG_A,
        contactId: "contact-a",
        channel: "whatsapp",
        externalId: "+60123456789",
      },
    });

    await expect(prisma.contactIdentity.findMany({ where: {} })).rejects.toThrow(/tenant-guard/);
    await expect(prisma.contactIdentity.findMany({ where: { ownerId: ORG_B } })).resolves.toHaveLength(0);
    await expect(
      prisma.contactIdentity.updateMany({
        where: { id: "identity-a", ownerId: ORG_B },
        data: { label: "cross-tenant write" },
      }),
    ).resolves.toEqual({ count: 0 });
    await expect(
      prisma.contactIdentity.findFirstOrThrow({ where: { id: "identity-a", ownerId: ORG_A } }),
    ).resolves.toMatchObject({ label: null });
  });

  it("Segment rejects unscoped access and Org B cannot read or update Org A", async () => {
    await prisma.segment.create({
      data: {
        id: "segment-a",
        ownerId: ORG_A,
        name: "Hot right now",
        phrase: "Customers active in the last 30 days",
        rulesJson: { lastSeenWithinDays: 30 },
        kind: "builtin_lifecycle",
      },
    });

    await expect(prisma.segment.findMany({ where: {} })).rejects.toThrow(/tenant-guard/);
    await expect(prisma.segment.findMany({ where: { ownerId: ORG_B } })).resolves.toHaveLength(0);
    await expect(
      prisma.segment.updateMany({
        where: { id: "segment-a", ownerId: ORG_B },
        data: { name: "cross-tenant write" },
      }),
    ).resolves.toEqual({ count: 0 });
    await expect(
      prisma.segment.findFirstOrThrow({ where: { id: "segment-a", ownerId: ORG_A } }),
    ).resolves.toMatchObject({ name: "Hot right now" });
  });
});

describe("B8 AC-02 — ContactIdentity deterministic convergence", () => {
  it("concurrent duplicate LIVE (ownerId, channel, externalId) inserts land one row and one P2002", async () => {
    await createContact();
    const data = {
      ownerId: ORG_A,
      contactId: "contact-a",
      channel: "whatsapp",
      externalId: "+60112223333",
    };

    const results = await Promise.allSettled([
      prisma.contactIdentity.create({ data: { id: "identity-race-1", ...data } }),
      prisma.contactIdentity.create({ data: { id: "identity-race-2", ...data } }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect((loser.reason as { code?: string }).code).toBe("P2002");
    await expect(
      prisma.contactIdentity.count({
        where: { ownerId: ORG_A, channel: "whatsapp", externalId: "+60112223333" },
      }),
    ).resolves.toBe(1);
  });

  it("soft-delete frees (ownerId, channel, externalId) for a new LIVE identity", async () => {
    await createContact();
    const key = {
      ownerId: ORG_A,
      contactId: "contact-a",
      channel: "whatsapp",
      externalId: "+60119998888",
    };

    await prisma.contactIdentity.create({ data: { id: "identity-old", ...key } });
    await prisma.contactIdentity.updateMany({
      where: { id: "identity-old", ownerId: ORG_A },
      data: { deletedAt: NOW },
    });

    await expect(
      prisma.contactIdentity.create({ data: { id: "identity-new", ...key } }),
    ).resolves.toMatchObject({ id: "identity-new", deletedAt: null });
    await expect(
      prisma.contactIdentity.findMany({
        where: {
          ownerId: ORG_A,
          channel: "whatsapp",
          externalId: "+60119998888",
          deletedAt: null,
        },
      }),
    ).resolves.toMatchObject([{ id: "identity-new" }]);
    await expect(
      prisma.contactIdentity.count({
        where: { ownerId: ORG_A, channel: "whatsapp", externalId: "+60119998888" },
      }),
    ).resolves.toBe(2);
  });
});

describe("B8 AC-03 — Campaign grouping stays nullable and soft-delete-safe", () => {
  it("Generation and ScheduledPost accept null campaignId and survive Campaign soft-delete", async () => {
    await prisma.project.create({ data: { id: "project-a", ownerId: ORG_A, name: "Project A" } });
    await prisma.asset.create({
      data: {
        id: "asset-a",
        ownerId: ORG_A,
        contentHash: "b8-asset-hash",
        ext: "png",
        mime: "image/png",
        sizeBytes: 1n,
      },
    });
    await prisma.generation.create({
      data: {
        id: "generation-a",
        ownerId: ORG_A,
        projectId: "project-a",
        assetId: "asset-a",
        source: "UPLOAD",
        entitySnapshot: { entities: [] },
      },
    });
    await prisma.scheduledPost.create({
      data: {
        id: "post-a",
        ownerId: ORG_A,
        projectId: "project-a",
        channel: "instagram",
        caption: "Raya collection",
        scheduledAt: NOW,
        scheduledTz: "Asia/Kuala_Lumpur",
        source: "owner",
      },
    });

    await expect(
      prisma.generation.findFirstOrThrow({ where: { id: "generation-a", ownerId: ORG_A } }),
    ).resolves.toMatchObject({ campaignId: null });
    await expect(
      prisma.scheduledPost.findFirstOrThrow({ where: { id: "post-a", ownerId: ORG_A } }),
    ).resolves.toMatchObject({ campaignId: null });

    await createCampaign();
    await prisma.generation.updateMany({
      where: { id: "generation-a", ownerId: ORG_A },
      data: { campaignId: "campaign-a" },
    });
    await prisma.scheduledPost.updateMany({
      where: { id: "post-a", ownerId: ORG_A },
      data: { campaignId: "campaign-a" },
    });
    await prisma.campaign.updateMany({
      where: { id: "campaign-a", ownerId: ORG_A },
      data: { deletedAt: NOW },
    });

    await expect(
      prisma.generation.findFirstOrThrow({ where: { id: "generation-a", ownerId: ORG_A } }),
    ).resolves.toMatchObject({ campaignId: "campaign-a" });
    await expect(
      prisma.scheduledPost.findFirstOrThrow({ where: { id: "post-a", ownerId: ORG_A } }),
    ).resolves.toMatchObject({ campaignId: "campaign-a" });
  });
});
