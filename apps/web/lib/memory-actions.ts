"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";

export type MemoryRow = {
  id: string;
  category: string;
  content: string;
  source: "otto" | "user";
  pinned: boolean;
  updatedAt: Date;
};

/** Client-callable list: resolves the owner from the session (the client never
 *  passes an ownerId). Used by the Memory screen to refetch after a mutation. */
export async function listMyMemory(): Promise<MemoryRow[]> {
  const gate = await requireOwner();
  if ("error" in gate) return [];
  return listMemory(gate.ownerId);
}

export async function listMemory(ownerId: string, brandId?: string | null): Promise<MemoryRow[]> {
  const rows = await prisma.memory.findMany({
    where: { ownerId, brandId: brandId ?? null, deletedAt: null },
    orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
    select: { id: true, category: true, content: true, source: true, pinned: true, updatedAt: true },
  });
  return rows as MemoryRow[];
}

export async function addMemory(raw: unknown): Promise<{ ok: true; id: string } | { error: string }> {
  const r = raw as { category?: unknown; content?: unknown; brandId?: unknown };
  const category = typeof r?.category === "string" ? r.category.trim() : "";
  const content = typeof r?.content === "string" ? r.content.trim() : "";
  if (!category || !content) return { error: "A memory needs a category and some text." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const id = newId();
  try {
    await prisma.memory.create({
      data: {
        id,
        ownerId: gate.ownerId,
        brandId: typeof r.brandId === "string" ? r.brandId : null,
        category: category.slice(0, 60),
        content: content.slice(0, 2000),
        source: "user",
        pinned: true,
      },
    });
  } catch { return { error: "Couldn't save that — please try again." }; }
  revalidatePath("/", "layout");
  return { ok: true, id };
}

export async function updateMemory(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown; content?: unknown; pinned?: unknown };
  if (typeof r?.id !== "string" || typeof r?.content !== "string") return { error: "Invalid memory edit." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  try {
    const { count } = await prisma.memory.updateMany({
      where: { id: r.id, ownerId: gate.ownerId, deletedAt: null },
      data: {
        content: r.content.trim().slice(0, 2000),
        pinned: typeof r.pinned === "boolean" ? r.pinned : undefined,
        source: "user",
      },
    });
    if (!count) return { error: "Memory not found." };
  } catch { return { error: "Couldn't save that — please try again." }; }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteMemory(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  try {
    const { count } = await prisma.memory.updateMany({
      where: { id: r.id, ownerId: gate.ownerId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!count) return { error: "Memory not found." };
  } catch { return { error: "Couldn't delete — please try again." }; }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Compile this owner/brand's memory into a compact plain-text block for Otto's context. */
export async function getBrandContextText(ownerId: string, brandId?: string | null): Promise<string> {
  const rows = await prisma.memory.findMany({
    where: { ownerId, brandId: brandId ?? null, deletedAt: null },
    orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
    select: { category: true, content: true },
    take: 100,
  });
  if (!rows.length) return "";
  const byCat = new Map<string, string[]>();
  for (const r of rows) {
    const bucket = byCat.get(r.category) ?? [];
    bucket.push(r.content);
    byCat.set(r.category, bucket);
  }
  return [...byCat.entries()]
    .map(([cat, items]) => `${cat}: ${items.join("; ")}`)
    .join("\n")
    .slice(0, 3000);
}
