/**
 * _brand-record — shared $0 upsert for the three living-collection write skills.
 * Spends NO money, creates NO GenJob. Identity from ctx only (never tool input).
 * Upsert-by-name: find live row (ownerId+kind+nameKey) → merge-update; else create.
 */
import type { RunContext } from "@openai/agents";
import { prisma, Prisma } from "@fikirtive/db";
import {
  newId, recordSchemaFor, recordName, normalizeNameKey, type RecordKind,
} from "@fikirtive/core";
import type { OttoContext } from "../context.js";

export interface UpsertBrandRecordInput {
  kind: RecordKind;
  /** Partial per-kind fields, already shape-checked by the skill's zod parameters. */
  fields: Record<string, unknown>;
  status?: "active" | "archived";
  startsAt?: string; // YYYY-MM-DD (offers)
  endsAt?: string;
}

const stripUndefined = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const toDate = (v?: string): Date | undefined => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export async function upsertBrandRecordFromOtto(
  input: UpsertBrandRecordInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ ok: true; id: string; updated: boolean }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  const name = recordName(input.kind, input.fields);
  const nameKey = normalizeNameKey(name);
  if (!nameKey) throw new Error(`A ${input.kind} needs a name.`);

  const existing = await prisma.brandRecord.findFirst({
    where: { ownerId: ctx.orgId, brandId: null, kind: input.kind, nameKey, deletedAt: null },
    select: { id: true, data: true },
  });

  // Merge (update) or take as-is (create), then validate the FULL shape.
  const mergedRaw = existing
    ? { ...(existing.data as Record<string, unknown>), ...stripUndefined(input.fields) }
    : stripUndefined(input.fields);
  const parsed = recordSchemaFor(input.kind).safeParse(mergedRaw);
  if (!parsed.success) {
    throw new Error(`Invalid ${input.kind}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const data = parsed.data as unknown as Prisma.InputJsonObject;

  const dates = stripUndefined({ startsAt: toDate(input.startsAt), endsAt: toDate(input.endsAt) });
  const status = input.status;

  if (existing) {
    await prisma.brandRecord.update({
      where: { id: existing.id },
      data: { data, nameKey, source: "otto", ...(status ? { status } : {}), ...dates },
    });
    return { ok: true, id: existing.id, updated: true };
  }

  const id = newId();
  try {
    await prisma.brandRecord.create({
      data: {
        id, ownerId: ctx.orgId, brandId: null,
        kind: input.kind, nameKey, data,
        status: status ?? "active",
        startsAt: (dates.startsAt as Date | undefined) ?? null,
        endsAt: (dates.endsAt as Date | undefined) ?? null,
        source: "otto", pinned: false,
      },
    });
  } catch (e) {
    // Unique-index race (two turns saving the same name): retry once as an update.
    const again = await prisma.brandRecord.findFirst({
      where: { ownerId: ctx.orgId, brandId: null, kind: input.kind, nameKey, deletedAt: null },
      select: { id: true },
    });
    if (!again) throw e;
    await prisma.brandRecord.update({ where: { id: again.id }, data: { data, source: "otto", ...(status ? { status } : {}), ...dates } });
    return { ok: true, id: again.id, updated: true };
  }
  return { ok: true, id, updated: false };
}
