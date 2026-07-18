"use server";

import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { newId } from "@fikirtive/core";
import { prisma, Prisma } from "@fikirtive/db";
import { z } from "zod";
import { isImpersonating } from "@/lib/better-auth/compat";
import { requireOwner } from "./auth-guard";

const IMPERSONATION_BLOCK = "Paused while impersonating a customer — exit impersonation to do this.";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const TREND_DRAFT_CONTEXT = "fikirtive:trend-snapshot-draft:v1";

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

const sourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(253),
}).strict();

const trendEvidenceSchema = z.object({
  summary: z.string().trim().min(1).max(1_000),
  sources: z.array(sourceSchema).min(1).max(20),
  capturedAt: z.string().refine((value) => parseTrendCapturedAt(value) !== null, "Invalid capture date.").optional(),
}).strict();

export type TrendEvidence = z.infer<typeof trendEvidenceSchema>;

function buildTrendSnapshotCreateData(input: {
  id: string;
  ownerId: string;
  campaignId: string | null;
  evidence: TrendEvidence;
  now?: Date;
}): Prisma.TrendSnapshotUncheckedCreateInput {
  const capturedAt = input.evidence.capturedAt
    ? parseTrendCapturedAt(input.evidence.capturedAt)
    : (input.now ?? new Date());
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

export type TrendSnapshotRow = {
  id: string;
  summary: string;
  sources: Prisma.JsonValue;
  capturedAt: string;
  campaignId: string | null;
  createdAt: string;
};

const listInputSchema = z.object({
  campaignId: z.string().regex(ULID_PATTERN).optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();

function signTrendDraft(ownerId: string, snapshotId: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required to issue a Trend draft.");
  return createHmac("sha256", secret)
    .update(JSON.stringify([TREND_DRAFT_CONTEXT, ownerId, snapshotId]))
    .digest("base64url");
}

function issueTrendDraft(ownerId: string) {
  const snapshotId = newId();
  return { snapshotId, snapshotProof: signTrendDraft(ownerId, snapshotId) };
}

function validTrendProof(ownerId: string, snapshotId: string, proof: unknown): boolean {
  if (typeof proof !== "string") return false;
  const expected = Buffer.from(signTrendDraft(ownerId, snapshotId));
  const supplied = Buffer.from(proof);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function publicTrend(row: {
  id: string;
  summary: string;
  sources: Prisma.JsonValue;
  capturedAt: Date;
  campaignId: string | null;
  createdAt: Date;
}): TrendSnapshotRow {
  return {
    ...row,
    capturedAt: row.capturedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** $0 read surface for Otto and the Trend archive. Only conclusion rows are returned. */
export async function listTrendSnapshots(raw: unknown = {}): Promise<
  | {
      ok: true;
      snapshots: TrendSnapshotRow[];
      nextSnapshotId: string;
      nextSnapshotProof: string;
    }
  | { error: string }
> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const parsed = listInputSchema.safeParse(raw ?? {});
  if (!parsed.success) return { error: "That trend filter isn't valid." };

  try {
    if (parsed.data.campaignId) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: parsed.data.campaignId, ownerId: gate.ownerId, deletedAt: null },
        select: { id: true },
      });
      if (!campaign) return { error: "Campaign not found." };
    }

    const rows = await prisma.trendSnapshot.findMany({
      where: {
        ownerId: gate.ownerId,
        ...(parsed.data.campaignId ? { campaignId: parsed.data.campaignId } : {}),
        deletedAt: null,
      },
      orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
      take: parsed.data.limit,
      select: {
        id: true,
        summary: true,
        sources: true,
        capturedAt: true,
        campaignId: true,
        createdAt: true,
      },
    });
    const draft = issueTrendDraft(gate.ownerId);
    return {
      ok: true,
      snapshots: rows.map(publicTrend),
      nextSnapshotId: draft.snapshotId,
      nextSnapshotProof: draft.snapshotProof,
    };
  } catch {
    return { error: "Trend snapshots couldn't load. Please retry." };
  }
}

const saveInputSchema = z.object({
  snapshotId: z.string().regex(ULID_PATTERN),
  snapshotProof: z.string().min(1).max(200),
  campaignId: z.string().regex(ULID_PATTERN).nullable().default(null),
  evidence: trendEvidenceSchema,
}).strict();

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

export async function saveTrendSnapshot(raw: unknown): Promise<
  | { ok: true; idempotent: boolean; snapshot: TrendSnapshotRow }
  | { error: string }
> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };
  const parsed = saveInputSchema.safeParse(raw);
  if (!parsed.success) return { error: "That trend snapshot isn't valid." };
  const { snapshotId, snapshotProof, campaignId, evidence } = parsed.data;
  if (!validTrendProof(gate.ownerId, snapshotId, snapshotProof)) {
    return { error: "Refresh the trend archive and try again." };
  }

  try {
    if (campaignId) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, ownerId: gate.ownerId, deletedAt: null },
        select: { id: true },
      });
      if (!campaign) return { error: "Campaign not found." };
    }

    const expected = buildTrendSnapshotCreateData({
      id: snapshotId,
      ownerId: gate.ownerId,
      campaignId,
      evidence,
    });
    const expectedCapturedAt = expected.capturedAt instanceof Date
      ? expected.capturedAt
      : new Date(expected.capturedAt);
    const existing = await prisma.trendSnapshot.findFirst({
      where: { id: snapshotId, ownerId: gate.ownerId, deletedAt: null },
      select: {
        id: true,
        summary: true,
        sources: true,
        capturedAt: true,
        campaignId: true,
        createdAt: true,
      },
    });
    if (existing) {
      const same = existing.summary === expected.summary
        && stableJson(existing.sources) === stableJson(expected.sources)
        && existing.capturedAt.getTime() === expectedCapturedAt.getTime()
        && existing.campaignId === expected.campaignId;
      return same
        ? { ok: true, idempotent: true, snapshot: publicTrend(existing) }
        : { error: "Couldn't save that trend snapshot — refresh and start a new draft." };
    }

    try {
      const created = await prisma.trendSnapshot.create({
        data: expected,
        select: {
          id: true,
          summary: true,
          sources: true,
          capturedAt: true,
          campaignId: true,
          createdAt: true,
        },
      });
      revalidatePath("/campaign/trends");
      return { ok: true, idempotent: false, snapshot: publicTrend(created) };
    } catch {
      const raced = await prisma.trendSnapshot.findFirst({
        where: { id: snapshotId, ownerId: gate.ownerId, deletedAt: null },
        select: {
          id: true,
          summary: true,
          sources: true,
          capturedAt: true,
          campaignId: true,
          createdAt: true,
        },
      });
      if (!raced
        || raced.summary !== expected.summary
        || stableJson(raced.sources) !== stableJson(expected.sources)
        || raced.capturedAt.getTime() !== expectedCapturedAt.getTime()
        || raced.campaignId !== expected.campaignId) {
        return { error: "Couldn't save that trend snapshot — refresh and start a new draft." };
      }
      revalidatePath("/campaign/trends");
      return { ok: true, idempotent: true, snapshot: publicTrend(raced) };
    }
  } catch {
    return { error: "Couldn't save that trend snapshot — please try again." };
  }
}
