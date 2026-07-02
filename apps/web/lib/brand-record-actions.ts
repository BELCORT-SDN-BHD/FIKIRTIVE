"use server";
import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@fikirtive/db";
import {
  newId, RECORD_KINDS, recordSchemaFor, recordName, normalizeNameKey, type RecordKind,
} from "@fikirtive/core";
import { requireOwner } from "./auth-guard";

export type BrandRecordRow = {
  id: string;
  kind: RecordKind;
  data: Record<string, unknown>;
  status: "active" | "archived";
  startsAt: Date | null;
  endsAt: Date | null;
  source: "otto" | "user";
  pinned: boolean;
  updatedAt: Date;
};

const SELECT = {
  id: true, kind: true, data: true, status: true,
  startsAt: true, endsAt: true, source: true, pinned: true, updatedAt: true,
} as const;

/** Client-callable list (Memory-screen refetch after a chat turn). Session-scoped. */
export async function listMyBrandRecords(): Promise<BrandRecordRow[]> {
  return listBrandRecords();
}

export async function listBrandRecords(_ownerId?: string, brandId?: string | null): Promise<BrandRecordRow[]> {
  // SECURITY: "use server" export — owner comes from the SESSION, caller ids ignored (see memory-actions listMemory).
  const gate = await requireOwner();
  if ("error" in gate) return [];
  const rows = await prisma.brandRecord.findMany({
    where: { ownerId: gate.ownerId, brandId: brandId ?? null, deletedAt: null },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: SELECT,
  });
  return rows as unknown as BrandRecordRow[];
}

function parseInput(raw: unknown):
  | { kind: RecordKind; data: Record<string, unknown>; id?: string; status?: "active" | "archived"; startsAt?: Date | null; endsAt?: Date | null }
  | { error: string } {
  const r = raw as { id?: unknown; kind?: unknown; data?: unknown; status?: unknown; startsAt?: unknown; endsAt?: unknown };
  const kind = r?.kind as RecordKind;
  if (!RECORD_KINDS.includes(kind)) return { error: "Unknown record type." };
  const parsed = recordSchemaFor(kind).safeParse(r.data);
  if (!parsed.success) return { error: "That record is missing something — please fill in the required fields." };
  const toDate = (v: unknown): Date | null | undefined => {
    if (v === null) return null;                       // explicit clear
    if (typeof v !== "string" || !v.trim()) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  return {
    kind,
    data: parsed.data as Record<string, unknown>,
    id: typeof r.id === "string" ? r.id : undefined,
    status: r.status === "archived" ? "archived" : r.status === "active" ? "active" : undefined,
    startsAt: kind === "offer" ? toDate(r.startsAt) : undefined,
    endsAt: kind === "offer" ? toDate(r.endsAt) : undefined,
  };
}

/** Create (no id) or full-data update (id). User writes stamp source:"user". */
export async function saveBrandRecord(raw: unknown): Promise<{ ok: true; id: string } | { error: string }> {
  const input = parseInput(raw);
  if ("error" in input) return input;
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const nameKey = normalizeNameKey(recordName(input.kind, input.data));
  if (!nameKey) return { error: "A record needs a name." };

  try {
    if (input.id) {
      const { count } = await prisma.brandRecord.updateMany({
        where: { id: input.id, ownerId: gate.ownerId, deletedAt: null },
        data: {
          data: input.data as unknown as Prisma.InputJsonObject, nameKey, source: "user",
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
          ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        },
      });
      if (!count) return { error: "Record not found." };
      revalidatePath("/", "layout");
      return { ok: true, id: input.id };
    }
    const existing = await prisma.brandRecord.findFirst({
      where: { ownerId: gate.ownerId, brandId: null, kind: input.kind, nameKey, deletedAt: null },
      select: { id: true },
    });
    if (existing) return saveBrandRecord({ ...(raw as object), id: existing.id });
    const id = newId();
    await prisma.brandRecord.create({
      data: {
        id, ownerId: gate.ownerId, brandId: null,
        kind: input.kind, nameKey, data: input.data as unknown as Prisma.InputJsonObject,
        status: input.status ?? "active",
        startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null,
        source: "user", pinned: false,
      },
    });
    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch {
    return { error: "Couldn't save that — please try again." };
  }
}

export async function deleteBrandRecord(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  try {
    const { count } = await prisma.brandRecord.updateMany({
      where: { id: r.id, ownerId: gate.ownerId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!count) return { error: "Record not found." };
  } catch { return { error: "Couldn't delete — please try again." }; }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Undo of an OTTO-removed record: bring the soft-deleted row back. */
export async function restoreBrandRecord(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  try {
    const { count } = await prisma.brandRecord.updateMany({
      where: { id: r.id, ownerId: gate.ownerId },
      data: { deletedAt: null },
    });
    if (!count) return { error: "Record not found." };
  } catch { return { error: "Couldn't restore — please try again." }; }
  revalidatePath("/", "layout");
  return { ok: true };
}
