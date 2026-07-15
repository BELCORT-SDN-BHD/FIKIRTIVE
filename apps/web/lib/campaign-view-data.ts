import { prisma, type Prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";

export type CampaignListRow = {
  id: string;
  name: string;
  status: string;
  goal: string;
  startAt: Date;
  endAt: Date;
  utmBase: string | null;
  planJson: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

export type CampaignDetailRow = CampaignListRow & {
  generations: { id: string; assetId: string; createdAt: Date }[];
  scheduledPosts: { id: string; channel: string; scheduledAt: Date; status: string; createdAt: Date }[];
  trendSnapshots: {
    id: string;
    summary: string;
    sources: Prisma.JsonValue;
    capturedAt: Date;
    createdAt: Date;
  }[];
};

const CAMPAIGN_SELECT = {
  id: true,
  name: true,
  status: true,
  goal: true,
  startAt: true,
  endAt: true,
  utmBase: true,
  planJson: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Campaign list source. Soft-deleted rows and every other tenant are invisible. */
export async function listCampaigns(): Promise<CampaignListRow[]> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return [];
  const rows = await prisma.campaign.findMany({
    where: { ownerId: gate.ownerId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: CAMPAIGN_SELECT,
  });
  return rows as CampaignListRow[];
}

/** Container detail plus owner-checked grouped outputs. No relation trusts campaignId alone. */
export async function getCampaign(id: string): Promise<CampaignDetailRow | null> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return null;
  if (typeof id !== "string" || !id.trim()) return null;

  const row = await prisma.campaign.findFirst({
    where: { id, ownerId: gate.ownerId, deletedAt: null },
    select: {
      ...CAMPAIGN_SELECT,
      generations: {
        where: { ownerId: gate.ownerId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, assetId: true, createdAt: true },
      },
      scheduledPosts: {
        where: { ownerId: gate.ownerId, deletedAt: null },
        orderBy: { scheduledAt: "asc" },
        select: { id: true, channel: true, scheduledAt: true, status: true, createdAt: true },
      },
      trendSnapshots: {
        where: { ownerId: gate.ownerId, deletedAt: null },
        orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true, summary: true, sources: true, capturedAt: true, createdAt: true },
      },
    },
  });
  return row as CampaignDetailRow | null;
}
