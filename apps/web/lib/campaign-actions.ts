"use server";

import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { newId } from "@fikirtive/core";
import { prisma, Prisma } from "@fikirtive/db";
import { z } from "zod";
import { isImpersonating } from "@/lib/better-auth/compat";
import { requireOwner } from "./auth-guard";

const IMPERSONATION_BLOCK = "Paused while impersonating a customer — exit impersonation to do this.";
const GENERIC_CREATE_ERROR = "Couldn't save that campaign — please retry the same draft.";
const GENERIC_UPDATE_ERROR = "Couldn't update that campaign — please try again.";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const CAMPAIGN_DRAFT_CONTEXT = "fikirtive:campaign-draft:v1";
const ENTRY_DRAFT_CONTEXT = "fikirtive:campaign-entry-draft:v1";

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

function parseTrendCapturedAt(value: string): Date | null {
  if (DATE_ONLY.test(value)) {
    if (!isCalendarDate(value)) return null;
    return new Date(`${value}T00:00:00.000+08:00`);
  }
  const match = ISO_INSTANT.exec(value);
  if (!match || !isCalendarDate(`${match[1]}-${match[2]}-${match[3]}`)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dateSchema = z.string().refine(isCalendarDate, "Use a real YYYY-MM-DD date.");
const briefSchema = z.string().trim().min(1).max(2_000)
  .refine((value) => /[A-Za-z]{2}/.test(value), "Use an English brief.");
const boundedSlugSchema = z.string().trim().min(1).max(40)
  .transform((value) => value.toLowerCase())
  .pipe(z.string().regex(/^[a-z][a-z0-9_-]*$/));
const idSchema = z.string().regex(ULID_PATTERN);
const campaignStatusSchema = z.enum(["DRAFT", "ACTIVE", "DONE", "CANCELLED"]);

const trendSourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(253),
}).strict();

const trendEvidenceSchema = z.object({
  summary: z.string().trim().min(1).max(1_000),
  sources: z.array(trendSourceSchema).min(1).max(20),
  capturedAt: z.string().refine((value) => parseTrendCapturedAt(value) !== null, "Invalid capture date.").optional(),
}).strict();

type TrendEvidence = z.infer<typeof trendEvidenceSchema>;

const proposedCampaignEntrySchema = z.object({
  date: dateSchema,
  platform: boundedSlugSchema,
  format: boundedSlugSchema,
  hook: z.string().trim().min(1).max(300),
  brief: briefSchema,
  // Display-only planning estimate. This value is never sent to a ledger or generation action.
  estCredits: z.number().int().min(0).max(1_000_000),
}).strict();

const campaignPlanEntrySchema = proposedCampaignEntrySchema.extend({
  id: idSchema,
  status: z.enum(["proposed", "approved"]),
}).strict();

const campaignPlanSchema = z.object({
  theme: z.string().trim().min(1).max(300),
  rationale: trendEvidenceSchema.nullable(),
  entries: z.array(campaignPlanEntrySchema).max(40),
  ideas: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();

export type ProposedCampaignEntry = z.infer<typeof proposedCampaignEntrySchema>;
export type CampaignPlanEntry = z.infer<typeof campaignPlanEntrySchema>;
export type CampaignPlan = z.infer<typeof campaignPlanSchema>;

const periodSchema = z.object({
  start: dateSchema,
  end: dateSchema,
  tz: z.literal("Asia/Kuala_Lumpur"),
}).strict().refine((period) => period.start <= period.end, {
  message: "The campaign end date must be on or after its start date.",
});

const proposeInputSchema = z.object({
  campaignId: idSchema,
  campaignProof: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(120).optional(),
  goal: z.string().trim().min(1).max(500),
  status: campaignStatusSchema.default("DRAFT"),
  period: periodSchema,
  theme: z.string().trim().min(1).max(300).optional(),
  rationale: trendEvidenceSchema.optional(),
  items: z.array(proposedCampaignEntrySchema).max(40).default([]),
  ideas: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
}).strict().superRefine((input, ctx) => {
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

/** Deterministic fallback name shared by the structured form and Otto's planner. */
function deriveCampaignName(goal: string): string {
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

function malaysiaDate(date: Date): string {
  return new Date(date.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function proofSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required to issue a Campaign draft.");
  return secret;
}

function signDraft(parts: string[]): string {
  return createHmac("sha256", proofSecret()).update(JSON.stringify(parts)).digest("base64url");
}

function proofMatches(expected: string, supplied: unknown): boolean {
  if (typeof supplied !== "string") return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validCampaignProof(ownerId: string, campaignId: string, proof: unknown): boolean {
  return proofMatches(signDraft([CAMPAIGN_DRAFT_CONTEXT, ownerId, campaignId]), proof);
}

function validEntryProof(ownerId: string, campaignId: string, entryId: string, proof: unknown): boolean {
  return proofMatches(signDraft([ENTRY_DRAFT_CONTEXT, ownerId, campaignId, entryId]), proof);
}

function initialEntryId(ownerId: string, campaignId: string, index: number): string {
  // Stable on retry, server-owned, and constrained to the same 26-character id alphabet.
  return createHmac("sha256", proofSecret())
    .update(JSON.stringify([ENTRY_DRAFT_CONTEXT, ownerId, campaignId, index]))
    .digest("hex")
    .slice(0, 26)
    .toUpperCase();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildTrendSnapshotCreateData(input: {
  id: string;
  ownerId: string;
  campaignId: string;
  evidence: TrendEvidence;
}): Prisma.TrendSnapshotUncheckedCreateInput {
  const capturedAt = input.evidence.capturedAt
    ? parseTrendCapturedAt(input.evidence.capturedAt)
    : new Date();
  if (!capturedAt) throw new Error("Invalid trend capture date.");
  return {
    id: input.id,
    ownerId: input.ownerId,
    summary: input.evidence.summary,
    sources: input.evidence.sources as Prisma.InputJsonArray,
    capturedAt,
    campaignId: input.campaignId,
    deletedAt: null,
  };
}

type CampaignActionError = { error: string };
type CampaignPlanResult =
  | { ok: true; idempotent: boolean; payload: CampaignPlan }
  | CampaignActionError;

type ExistingCampaign = {
  id: string;
  name: string;
  status: string;
  goal: string;
  startAt: Date;
  endAt: Date;
  planJson: Prisma.JsonValue;
};

function sameCampaign(existing: ExistingCampaign, input: z.infer<typeof proposeInputSchema>, plan: CampaignPlan) {
  return existing.name === (input.title ?? deriveCampaignName(input.goal))
    && existing.status === input.status
    && existing.goal === input.goal
    && existing.startAt.getTime() === campaignStart(input.period.start).getTime()
    && existing.endAt.getTime() === campaignEnd(input.period.end).getTime()
    && stableJson(existing.planJson) === stableJson(plan);
}

async function findOwnedCampaignForReplay(ownerId: string, campaignId: string) {
  return prisma.campaign.findFirst({
    where: { id: campaignId, ownerId, deletedAt: null },
    select: {
      id: true,
      name: true,
      status: true,
      goal: true,
      startAt: true,
      endAt: true,
      planJson: true,
    },
  }) as Promise<ExistingCampaign | null>;
}

export async function proposeCampaign(raw: unknown): Promise<
  { ok: true; idempotent: boolean; campaignId: string; payload: CampaignPlan } | CampaignActionError
> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };

  const parsed = proposeInputSchema.safeParse(raw);
  if (!parsed.success) return { error: "That campaign plan isn't valid." };
  const input = parsed.data;
  if (!validCampaignProof(gate.ownerId, input.campaignId, input.campaignProof)) {
    return { error: "Start a new campaign draft and try again." };
  }

  const rationale: TrendEvidence | null = input.rationale ?? null;
  const plan: CampaignPlan = {
    theme: input.theme ?? input.title ?? deriveCampaignName(input.goal),
    rationale,
    entries: input.items.map((entry, index) => ({
      ...entry,
      id: initialEntryId(gate.ownerId, input.campaignId, index),
      status: "proposed" as const,
    })),
    ideas: input.ideas,
  };
  const existing = await findOwnedCampaignForReplay(gate.ownerId, input.campaignId);
  if (existing) {
    if (!sameCampaign(existing, input, plan)) return { error: GENERIC_CREATE_ERROR };
    revalidatePath("/campaign");
    return { ok: true, idempotent: true, campaignId: existing.id, payload: plan };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.campaign.create({
        data: {
          id: input.campaignId,
          ownerId: gate.ownerId,
          name: input.title ?? deriveCampaignName(input.goal),
          status: input.status,
          goal: input.goal,
          startAt: campaignStart(input.period.start),
          endAt: campaignEnd(input.period.end),
          planJson: plan as unknown as Prisma.InputJsonObject,
          deletedAt: null,
        },
      });
      if (rationale) {
        await tx.trendSnapshot.create({
          data: buildTrendSnapshotCreateData({
            id: newId(),
            ownerId: gate.ownerId,
            campaignId: input.campaignId,
            evidence: rationale,
          }),
        });
      }
    });
  } catch {
    const raced = await findOwnedCampaignForReplay(gate.ownerId, input.campaignId).catch(() => null);
    if (!raced || !sameCampaign(raced, input, plan)) return { error: GENERIC_CREATE_ERROR };
    revalidatePath("/campaign");
    return { ok: true, idempotent: true, campaignId: raced.id, payload: plan };
  }

  revalidatePath("/campaign");
  return { ok: true, idempotent: false, campaignId: input.campaignId, payload: plan };
}

const entryTargetSchema = z.object({
  campaignId: idSchema,
  entryId: idSchema,
}).strict();

const proposeEntrySchema = z.object({
  campaignId: idSchema,
  entryId: idSchema,
  entryProof: z.string().min(1).max(200),
  entry: proposedCampaignEntrySchema,
}).strict();

const entryPatchSchema = proposedCampaignEntrySchema.partial().strict()
  .refine((patch) => Object.keys(patch).length > 0, "Include at least one change.");

const updateEntrySchema = entryTargetSchema.extend({ patch: entryPatchSchema }).strict();

type MutationResult = { plan: CampaignPlan; idempotent: boolean } | CampaignActionError;

async function saveMutatedPlan(input: {
  ownerId: string;
  campaignId: string;
  mutate: (plan: CampaignPlan, period: { start: string; end: string }) => MutationResult;
}): Promise<CampaignPlanResult> {
  let campaign;
  try {
    campaign = await prisma.campaign.findFirst({
      where: { id: input.campaignId, ownerId: input.ownerId, deletedAt: null },
      select: { planJson: true, startAt: true, endAt: true, updatedAt: true },
    });
  } catch {
    return { error: "Couldn't load that campaign — please try again." };
  }
  if (!campaign) return { error: "Campaign not found." };

  const parsedPlan = campaignPlanSchema.safeParse(campaign.planJson);
  if (!parsedPlan.success) return { error: "Campaign plan is invalid." };
  const next = input.mutate(parsedPlan.data, {
    start: malaysiaDate(campaign.startAt),
    end: malaysiaDate(campaign.endAt),
  });
  if ("error" in next) return next;
  if (next.idempotent) return { ok: true, idempotent: true, payload: next.plan };

  try {
    const { count } = await prisma.campaign.updateMany({
      where: {
        id: input.campaignId,
        ownerId: input.ownerId,
        deletedAt: null,
        updatedAt: campaign.updatedAt,
      },
      data: { planJson: next.plan as unknown as Prisma.InputJsonObject },
    });
    if (!count) return { error: "Campaign changed — reload and try again." };
  } catch {
    return { error: GENERIC_UPDATE_ERROR };
  }
  revalidatePath("/campaign");
  return { ok: true, idempotent: false, payload: next.plan };
}

export async function proposeCampaignEntry(raw: unknown): Promise<CampaignPlanResult> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };
  const parsed = proposeEntrySchema.safeParse(raw);
  if (!parsed.success) return { error: "That campaign entry isn't valid." };
  if (!validEntryProof(
    gate.ownerId,
    parsed.data.campaignId,
    parsed.data.entryId,
    parsed.data.entryProof,
  )) return { error: "Refresh this campaign and try the proposal again." };

  return saveMutatedPlan({
    ownerId: gate.ownerId,
    campaignId: parsed.data.campaignId,
    mutate: (plan, period) => {
      if (parsed.data.entry.date < period.start || parsed.data.entry.date > period.end) {
        return { error: "A plan entry must fall inside the campaign period." };
      }
      const existing = plan.entries.find((entry) => entry.id === parsed.data.entryId);
      const candidate: CampaignPlanEntry = {
        ...parsed.data.entry,
        id: parsed.data.entryId,
        status: "proposed",
      };
      if (existing) {
        return stableJson(existing) === stableJson(candidate)
          ? { plan, idempotent: true }
          : { error: "That campaign entry id is already in use." };
      }
      if (plan.entries.length >= 40) return { error: "A campaign can contain up to 40 plan entries." };
      return { plan: { ...plan, entries: [...plan.entries, candidate] }, idempotent: false };
    },
  });
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
    mutate: (plan, period) => {
      const index = plan.entries.findIndex((entry) => entry.id === parsed.data.entryId);
      if (index < 0) return { error: "Campaign entry not found." };
      const candidate = campaignPlanEntrySchema.safeParse({
        ...plan.entries[index],
        ...parsed.data.patch,
      });
      if (!candidate.success) return { error: "That campaign change isn't valid." };
      if (candidate.data.date < period.start || candidate.data.date > period.end) {
        return { error: "A plan entry must fall inside the campaign period." };
      }
      if (stableJson(candidate.data) === stableJson(plan.entries[index])) {
        return { plan, idempotent: true };
      }
      const entries = [...plan.entries];
      entries[index] = candidate.data;
      return { plan: { ...plan, entries }, idempotent: false };
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
        return { plan, idempotent: true };
      }
      return {
        plan: { ...plan, entries: plan.entries.filter((entry) => entry.id !== parsed.data.entryId) },
        idempotent: false,
      };
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
      if (plan.entries[index].status === "approved") return { plan, idempotent: true };
      const entries = [...plan.entries];
      // Approval changes only planJson. It does not dispatch generation, schedule, publish, or credits.
      entries[index] = { ...entries[index], status: "approved" };
      return { plan: { ...plan, entries }, idempotent: false };
    },
  });
}

const groupingSchema = z.object({
  campaignId: idSchema.nullable(),
  targetType: z.enum(["project", "scheduled_post", "generation"]),
  targetId: idSchema,
}).strict();

export async function setCampaignGrouping(raw: unknown): Promise<
  { ok: true; idempotent: boolean } | CampaignActionError
> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };
  const parsed = groupingSchema.safeParse(raw);
  if (!parsed.success) return { error: "That campaign grouping isn't valid." };
  const { campaignId, targetId, targetType } = parsed.data;

  if (campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, ownerId: gate.ownerId, deletedAt: null },
      select: { id: true },
    });
    if (!campaign) return { error: "Campaign not found." };
  }

  try {
    if (targetType === "project") {
      const target = await prisma.project.findFirst({
        where: { id: targetId, ownerId: gate.ownerId, deletedAt: null },
        select: { id: true, campaignId: true },
      });
      if (!target) return { error: "Project not found." };
      if (target.campaignId === campaignId) return { ok: true, idempotent: true };
      const result = await prisma.project.updateMany({
        where: { id: targetId, ownerId: gate.ownerId, deletedAt: null },
        data: { campaignId },
      });
      if (result.count !== 1) return { error: "Couldn't update that project grouping." };
    } else if (targetType === "scheduled_post") {
      const target = await prisma.scheduledPost.findFirst({
        where: { id: targetId, ownerId: gate.ownerId, deletedAt: null },
        select: { id: true, campaignId: true },
      });
      if (!target) return { error: "Scheduled post not found." };
      if (target.campaignId === campaignId) return { ok: true, idempotent: true };
      const result = await prisma.scheduledPost.updateMany({
        where: { id: targetId, ownerId: gate.ownerId, deletedAt: null },
        data: { campaignId },
      });
      if (result.count !== 1) return { error: "Couldn't update that scheduled post grouping." };
    } else {
      const target = await prisma.generation.findFirst({
        where: { id: targetId, ownerId: gate.ownerId, deletedAt: null },
        select: { id: true, campaignId: true },
      });
      if (!target) return { error: "Generation not found." };
      if (target.campaignId === campaignId) return { ok: true, idempotent: true };
      const result = await prisma.generation.updateMany({
        where: { id: targetId, ownerId: gate.ownerId, deletedAt: null },
        data: { campaignId },
      });
      if (result.count !== 1) return { error: "Couldn't update that generation grouping." };
    }
  } catch {
    return { error: "Couldn't update that campaign grouping — please try again." };
  }

  revalidatePath("/campaign");
  return { ok: true, idempotent: false };
}
