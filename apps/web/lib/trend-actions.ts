import { prisma, Prisma } from "@fikirtive/db";
import { z } from "zod";
import { requireOwner } from "./auth-guard";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;

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

export function parseTrendCapturedAt(value: string): Date | null {
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

export const trendEvidenceSchema = z.object({
  summary: z.string().trim().min(1).max(1_000),
  sources: z.array(sourceSchema).min(1).max(20),
  capturedAt: z.string().refine((value) => parseTrendCapturedAt(value) !== null, "Invalid capture date.").optional(),
}).strict();

export type TrendEvidence = z.infer<typeof trendEvidenceSchema>;

export function buildTrendSnapshotCreateData(input: {
  id: string;
  ownerId: string;
  campaignId: string;
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
  capturedAt: Date;
  campaignId: string | null;
  createdAt: Date;
};

const listInputSchema = z.object({
  campaignId: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

/** $0 read surface for Otto and the Trend archive. Only conclusion rows are returned. */
export async function listTrendSnapshots(raw: unknown = {}): Promise<TrendSnapshotRow[]> {
  "use server";
  const gate = await requireOwner();
  if ("error" in gate) return [];
  const parsed = listInputSchema.safeParse(raw ?? {});
  if (!parsed.success) return [];

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
  return rows as TrendSnapshotRow[];
}
