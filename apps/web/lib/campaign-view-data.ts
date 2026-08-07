"use server";

import { createHmac } from "node:crypto";
import { newId } from "@fikirtive/core";
import { prisma, type Prisma } from "@fikirtive/db";
import { z } from "zod";
import type { CampaignPlan } from "./campaign-actions";
import { requireOwner } from "./auth-guard";
import { dispatchedCampaignEntryIds } from "./campaign-dispatch-history";

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const CAMPAIGN_DRAFT_CONTEXT = "fikirtive:campaign-draft:v1";
const ENTRY_DRAFT_CONTEXT = "fikirtive:campaign-entry-draft:v1";

const campaignPlanSchema: z.ZodType<CampaignPlan> = z.object({
  theme: z.string().trim().min(1).max(300),
  rationale: z.object({
    summary: z.string().trim().min(1).max(1_000),
    sources: z.array(z.object({
      title: z.string().trim().min(1).max(200),
      domain: z.string().trim().min(1).max(253),
    }).strict()).min(1).max(20),
    capturedAt: z.string().optional(),
  }).strict().nullable(),
  entries: z.array(z.object({
    id: z.string().regex(ULID_PATTERN),
    date: z.string(),
    platform: z.string(),
    format: z.string(),
    hook: z.string(),
    brief: z.string(),
    estCredits: z.number().int().nonnegative(),
    status: z.enum(["proposed", "approved"]),
  }).strict()).max(40),
  ideas: z.array(z.string()).max(20),
}).strict();

function signDraft(parts: string[]): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required to issue a Campaign draft.");
  return createHmac("sha256", secret).update(JSON.stringify(parts)).digest("base64url");
}

function issueCampaignDraft(ownerId: string) {
  const campaignId = newId();
  return {
    campaignId,
    campaignProof: signDraft([CAMPAIGN_DRAFT_CONTEXT, ownerId, campaignId]),
  };
}

function issueCampaignEntryDraft(ownerId: string, campaignId: string) {
  const entryId = newId();
  return {
    entryId,
    entryProof: signDraft([ENTRY_DRAFT_CONTEXT, ownerId, campaignId, entryId]),
  };
}

export type CampaignListRow = {
  id: string;
  name: string;
  status: string;
  goal: string;
  startAt: string;
  endAt: string;
  plan: CampaignPlan | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignGroupedProject = {
  id: string;
  name: string;
  createdAt: string;
};

export type CampaignGroupedPost = {
  id: string;
  channel: string;
  caption: string;
  scheduledAt: string;
  status: string;
  createdAt: string;
};

export type CampaignGroupedGeneration = {
  id: string;
  assetId: string;
  kind: "image" | "video";
  createdAt: string;
};

export type CampaignGroupedBroadcast = {
  id: string;
  purpose: string;
  status: string;
  createdAt: string;
  executedAt: string | null;
};

export type CampaignDetailRow = CampaignListRow & {
  /** Plan entries whose generation has already been dispatched — and therefore already cost
   *  credits. The page greys out Undo approval and Remove for these instead of letting the
   *  merchant press a button the server will refuse (#744 判官 r1 P1-1). */
  dispatchedEntryIds: string[];
  grouped: {
    projects: CampaignGroupedProject[];
    scheduledPosts: CampaignGroupedPost[];
    generations: CampaignGroupedGeneration[];
    broadcasts: CampaignGroupedBroadcast[];
  };
  available: {
    projects: CampaignGroupedProject[];
    scheduledPosts: CampaignGroupedPost[];
    generations: CampaignGroupedGeneration[];
  };
  trendSnapshots: {
    id: string;
    summary: string;
    sources: Prisma.JsonValue;
    capturedAt: string;
    createdAt: string;
  }[];
};

const CAMPAIGN_SELECT = {
  id: true,
  name: true,
  status: true,
  goal: true,
  startAt: true,
  endAt: true,
  planJson: true,
  createdAt: true,
  updatedAt: true,
} as const;

type CampaignDbRow = {
  id: string;
  name: string;
  status: string;
  goal: string;
  startAt: Date;
  endAt: Date;
  planJson: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

function publicCampaign(row: CampaignDbRow): CampaignListRow {
  const parsed = campaignPlanSchema.safeParse(row.planJson);
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    goal: row.goal,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    plan: parsed.success ? parsed.data : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Campaign list source. Soft-deleted rows and every other tenant are invisible. */
export async function listCampaigns(): Promise<
  | {
      ok: true;
      campaigns: CampaignListRow[];
      nextCampaignId: string;
      nextCampaignProof: string;
    }
  | { error: string }
> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  try {
    const rows = await prisma.campaign.findMany({
      where: { ownerId: gate.ownerId, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: CAMPAIGN_SELECT,
    });
    const draft = issueCampaignDraft(gate.ownerId);
    return {
      ok: true,
      campaigns: (rows as CampaignDbRow[]).map(publicCampaign),
      nextCampaignId: draft.campaignId,
      nextCampaignProof: draft.campaignProof,
    };
  } catch {
    return { error: "Campaigns couldn't load. Please retry." };
  }
}

/** Container detail plus owner-checked grouping choices. No relation trusts campaignId alone. */
export async function getCampaign(id: string): Promise<
  | {
      ok: true;
      campaign: CampaignDetailRow;
      nextEntryId: string;
      nextEntryProof: string;
    }
  | { error: string }
> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (typeof id !== "string" || !ULID_PATTERN.test(id)) return { error: "Campaign not found." };

  try {
    const row = await prisma.campaign.findFirst({
      where: { id, ownerId: gate.ownerId, deletedAt: null },
      select: CAMPAIGN_SELECT,
    }) as CampaignDbRow | null;
    if (!row) return { error: "Campaign not found." };

    const [projects, scheduledPosts, generations, broadcasts, trendSnapshots] = await Promise.all([
      prisma.project.findMany({
        where: {
          ownerId: gate.ownerId,
          deletedAt: null,
          OR: [{ campaignId: id }, { campaignId: null }],
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 100,
        select: { id: true, name: true, campaignId: true, createdAt: true },
      }),
      prisma.scheduledPost.findMany({
        where: {
          ownerId: gate.ownerId,
          deletedAt: null,
          OR: [{ campaignId: id }, { campaignId: null }],
        },
        orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
        take: 100,
        select: {
          id: true,
          channel: true,
          caption: true,
          scheduledAt: true,
          status: true,
          campaignId: true,
          createdAt: true,
        },
      }),
      prisma.generation.findMany({
        where: {
          ownerId: gate.ownerId,
          deletedAt: null,
          OR: [{ campaignId: id }, { campaignId: null }],
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 100,
        select: {
          id: true,
          assetId: true,
          campaignId: true,
          createdAt: true,
          asset: { select: { ext: true } },
        },
      }),
      prisma.broadcastRun.findMany({
        where: { ownerId: gate.ownerId, campaignId: id },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 100,
        select: { id: true, purpose: true, status: true, createdAt: true, executedAt: true },
      }),
      prisma.trendSnapshot.findMany({
        where: { ownerId: gate.ownerId, campaignId: id, deletedAt: null },
        orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true, summary: true, sources: true, capturedAt: true, createdAt: true },
      }),
    ]);

    // Presentation only. It never decides whether a change is allowed — the server actions
    // re-check under the campaign approval lock — so a read failure here greys out nothing
    // rather than failing the whole page.
    const planned = publicCampaign(row).plan?.entries.map((entry) => entry.id) ?? [];
    const dispatchedEntryIds = planned.length === 0
      ? []
      : [...await dispatchedCampaignEntryIds(prisma, gate.ownerId, id, planned).catch(() => new Set<string>())];

    const publicProjects = projects.map((project) => ({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt.toISOString(),
    }));
    const publicPosts = scheduledPosts.map((post) => ({
      id: post.id,
      channel: post.channel,
      caption: post.caption,
      scheduledAt: post.scheduledAt.toISOString(),
      status: post.status,
      createdAt: post.createdAt.toISOString(),
    }));
    const publicGenerations = generations.map((generation) => ({
      id: generation.id,
      assetId: generation.assetId,
      kind: ["mp4", "mov", "webm"].includes(generation.asset.ext.toLowerCase()) ? "video" as const : "image" as const,
      createdAt: generation.createdAt.toISOString(),
    }));
    const draft = issueCampaignEntryDraft(gate.ownerId, id);

    return {
      ok: true,
      campaign: {
        ...publicCampaign(row),
        dispatchedEntryIds,
        grouped: {
          projects: publicProjects.filter((_, index) => projects[index].campaignId === id),
          scheduledPosts: publicPosts.filter((_, index) => scheduledPosts[index].campaignId === id),
          generations: publicGenerations.filter((_, index) => generations[index].campaignId === id),
          broadcasts: broadcasts.map((broadcast) => ({
            id: broadcast.id,
            purpose: broadcast.purpose,
            status: broadcast.status,
            createdAt: broadcast.createdAt.toISOString(),
            executedAt: broadcast.executedAt?.toISOString() ?? null,
          })),
        },
        available: {
          projects: publicProjects.filter((_, index) => projects[index].campaignId === null),
          scheduledPosts: publicPosts.filter((_, index) => scheduledPosts[index].campaignId === null),
          generations: publicGenerations.filter((_, index) => generations[index].campaignId === null),
        },
        trendSnapshots: trendSnapshots.map((snapshot) => ({
          id: snapshot.id,
          summary: snapshot.summary,
          sources: snapshot.sources,
          capturedAt: snapshot.capturedAt.toISOString(),
          createdAt: snapshot.createdAt.toISOString(),
        })),
      },
      nextEntryId: draft.entryId,
      nextEntryProof: draft.entryProof,
    };
  } catch {
    return { error: "Campaign details couldn't load. Please retry." };
  }
}
