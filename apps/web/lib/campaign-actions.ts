import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { z } from "zod";
import { isImpersonating } from "@/lib/better-auth/compat";
import { requireOwner } from "./auth-guard";
import {
  buildTrendSnapshotCreateData,
  trendEvidenceSchema,
  type TrendEvidence,
} from "./trend-actions";

const IMPERSONATION_BLOCK = "Paused while impersonating a customer — exit impersonation to do this.";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

const dateSchema = z.string().refine(isCalendarDate, "Use a real YYYY-MM-DD date.");
const briefSchema = z.string().trim().min(1).max(2_000)
  .refine((value) => /[A-Za-z]{2}/.test(value), "Use an English brief.");
const boundedSlugSchema = z.string().trim().min(1).max(40)
  .transform((value) => value.toLowerCase())
  .pipe(z.string().regex(/^[a-z][a-z0-9_-]*$/));

const proposedEntrySchema = z.object({
  date: dateSchema,
  platform: boundedSlugSchema,
  format: boundedSlugSchema,
  hook: z.string().trim().min(1).max(300),
  brief: briefSchema,
  estCredits: z.number().int().min(0).max(1_000_000),
}).strict();

const planEntrySchema = proposedEntrySchema.extend({
  id: z.string().min(1),
  status: z.enum(["proposed", "approved"]),
}).strict();

const campaignPlanSchema = z.object({
  theme: z.string().trim().min(1).max(300),
  rationale: trendEvidenceSchema.nullable(),
  entries: z.array(planEntrySchema).max(40),
  ideas: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();

export type CampaignPlanEntry = z.infer<typeof planEntrySchema>;
export type CampaignPlan = z.infer<typeof campaignPlanSchema>;

const periodSchema = z.object({
  start: dateSchema,
  end: dateSchema,
  tz: z.literal("Asia/Kuala_Lumpur"),
}).strict().refine((period) => period.start <= period.end, {
  message: "The campaign end date must be on or after its start date.",
});

const proposeInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  goal: z.string().trim().min(1).max(500),
  period: periodSchema,
  theme: z.string().trim().min(1).max(300),
  rationale: trendEvidenceSchema.optional(),
  items: z.array(proposedEntrySchema).min(1).max(40),
  ideas: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  utmBase: z.string().trim().max(2_048).nullable().optional(),
}).superRefine((input, ctx) => {
  input.items.forEach((entry, index) => {
    if (entry.date < input.period.start || entry.date > input.period.end) {
      ctx.addIssue({
        code: "custom",
        path: ["items", index, "date"],
        message: "A plan entry must fall inside the campaign period.",
      });
    }
  });
});

/** Deterministic fallback name shared by forms and the future Otto campaign skill. */
export function deriveCampaignName(goal: string): string {
  const trimmed = goal.trim();
  const words = trimmed.split(/\s+/).slice(0, 6).join(" ").slice(0, 80).trimEnd();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "New campaign";
}

function campaignStart(date: string): Date {
  return new Date(`${date}T00:00:00.000+08:00`);
}

function campaignEnd(date: string): Date {
  return new Date(`${date}T23:59:59.999+08:00`);
}

type CampaignActionError = { error: string };
type CampaignPlanResult = { ok: true; payload: CampaignPlan } | CampaignActionError;

export async function proposeCampaign(raw: unknown): Promise<
  { ok: true; campaignId: string; payload: CampaignPlan } | CampaignActionError
> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const parsed = proposeInputSchema.safeParse(raw);
  if (!parsed.success) return { error: "That campaign plan isn't valid." };
  const input = parsed.data;
  const campaignId = newId();
  const rationale: TrendEvidence | null = input.rationale ?? null;
  const plan: CampaignPlan = {
    theme: input.theme,
    rationale,
    entries: input.items.map((entry) => ({ ...entry, id: newId(), status: "proposed" as const })),
    ideas: input.ideas,
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.campaign.create({
        data: {
          id: campaignId,
          ownerId: gate.ownerId,
          name: input.title ?? deriveCampaignName(input.goal),
          status: "DRAFT",
          goal: input.goal,
          startAt: campaignStart(input.period.start),
          endAt: campaignEnd(input.period.end),
          utmBase: input.utmBase || null,
          planJson: plan as unknown as Prisma.InputJsonObject,
          deletedAt: null,
        },
      });
      if (rationale) {
        await tx.trendSnapshot.create({
          data: buildTrendSnapshotCreateData({
            id: newId(),
            ownerId: gate.ownerId,
            campaignId,
            evidence: rationale,
          }),
        });
      }
    });
  } catch {
    return { error: "Couldn't save that campaign — please try again." };
  }

  revalidatePath("/", "layout");
  return { ok: true, campaignId, payload: plan };
}

const entryTargetSchema = z.object({
  campaignId: z.string().trim().min(1).max(200),
  entryId: z.string().trim().min(1).max(200),
}).strict();

const entryPatchSchema = proposedEntrySchema.partial().strict()
  .refine((patch) => Object.keys(patch).length > 0, "Include at least one change.");

const updateEntrySchema = entryTargetSchema.extend({ patch: entryPatchSchema }).strict();

async function saveMutatedPlan(input: {
  ownerId: string;
  campaignId: string;
  mutate: (plan: CampaignPlan) => CampaignPlan | CampaignActionError;
}): Promise<CampaignPlanResult> {
  let campaign;
  try {
    campaign = await prisma.campaign.findFirst({
      where: { id: input.campaignId, ownerId: input.ownerId, deletedAt: null },
      select: { planJson: true, updatedAt: true },
    });
  } catch {
    return { error: "Couldn't load that campaign — please try again." };
  }
  if (!campaign) return { error: "Campaign not found." };

  const parsedPlan = campaignPlanSchema.safeParse(campaign.planJson);
  if (!parsedPlan.success) return { error: "Campaign plan is invalid." };
  const next = input.mutate(parsedPlan.data);
  if ("error" in next) return next;

  try {
    const { count } = await prisma.campaign.updateMany({
      where: {
        id: input.campaignId,
        ownerId: input.ownerId,
        deletedAt: null,
        updatedAt: campaign.updatedAt,
      },
      data: { planJson: next as unknown as Prisma.InputJsonObject },
    });
    if (!count) return { error: "Campaign changed — reload and try again." };
  } catch {
    return { error: "Couldn't update that campaign — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true, payload: next };
}

export async function updateCampaignEntry(raw: unknown): Promise<CampaignPlanResult> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };
  const parsed = updateEntrySchema.safeParse(raw);
  if (!parsed.success) return { error: "That campaign change isn't valid." };

  return saveMutatedPlan({
    ownerId: gate.ownerId,
    campaignId: parsed.data.campaignId,
    mutate: (plan) => {
      const index = plan.entries.findIndex((entry) => entry.id === parsed.data.entryId);
      if (index < 0) return { error: "Campaign entry not found." };
      const entries = [...plan.entries];
      entries[index] = { ...entries[index], ...parsed.data.patch };
      return { ...plan, entries };
    },
  });
}

export async function removeCampaignEntry(raw: unknown): Promise<CampaignPlanResult> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };
  const parsed = entryTargetSchema.safeParse(raw);
  if (!parsed.success) return { error: "That campaign change isn't valid." };

  return saveMutatedPlan({
    ownerId: gate.ownerId,
    campaignId: parsed.data.campaignId,
    mutate: (plan) => {
      if (!plan.entries.some((entry) => entry.id === parsed.data.entryId)) {
        return { error: "Campaign entry not found." };
      }
      return { ...plan, entries: plan.entries.filter((entry) => entry.id !== parsed.data.entryId) };
    },
  });
}

export async function approveCampaignEntry(raw: unknown): Promise<CampaignPlanResult> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };
  const parsed = entryTargetSchema.safeParse(raw);
  if (!parsed.success) return { error: "That campaign change isn't valid." };

  return saveMutatedPlan({
    ownerId: gate.ownerId,
    campaignId: parsed.data.campaignId,
    mutate: (plan) => {
      const index = plan.entries.findIndex((entry) => entry.id === parsed.data.entryId);
      if (index < 0) return { error: "Campaign entry not found." };
      const entries = [...plan.entries];
      entries[index] = { ...entries[index], status: "approved" };
      return { ...plan, entries };
    },
  });
}
