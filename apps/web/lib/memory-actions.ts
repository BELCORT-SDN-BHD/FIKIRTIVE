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

export async function listMemory(_ownerId?: string, brandId?: string | null): Promise<MemoryRow[]> {
  // SECURITY: this module is "use server", so every export is a client-invocable
  // Server Action. Resolve the owner from the SESSION and IGNORE any caller-supplied
  // id — otherwise a forged ownerId could read another org's brand memory. Server-side
  // callers already pass their own session ownerId, so behaviour is unchanged for them.
  const gate = await requireOwner();
  if ("error" in gate) return [];
  const ownerId = gate.ownerId;
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

/** Compile this owner/brand's memory into a compact plain-text block for Otto's context.
 *  Appends Brand Kit (name, colors, fonts, tone, style guide) and active Brand Rules
 *  (ALWAYS/NEVER/TONE/COLOR) when present so generations are on-brand and rule-constrained. */
export async function getBrandContextText(_ownerId?: string, brandId?: string | null): Promise<string> {
  // SECURITY: session-scoped, ignore any caller-supplied id (see listMemory above).
  const gate = await requireOwner();
  if ("error" in gate) return "";
  const ownerId = gate.ownerId;

  const [rows, kit, rules] = await Promise.all([
    prisma.memory.findMany({
      where: { ownerId, brandId: brandId ?? null, deletedAt: null },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      select: { category: true, content: true },
      take: 100,
    }),
    prisma.brandKit.findFirst({
      where: { ownerId, brandId: brandId ?? null },
      select: { name: true, colorsJson: true, fonts: true, tone: true, styleGuide: true },
    }),
    prisma.brandRule.findMany({
      where: { ownerId, brandId: brandId ?? null, active: true },
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
      select: { kind: true, text: true },
    }),
  ]);

  const parts: string[] = [];

  // Memory notes grouped by category
  if (rows.length) {
    const byCat = new Map<string, string[]>();
    for (const r of rows) {
      const bucket = byCat.get(r.category) ?? [];
      bucket.push(r.content);
      byCat.set(r.category, bucket);
    }
    parts.push(
      [...byCat.entries()]
        .map(([cat, items]) => `${cat}: ${items.join("; ")}`)
        .join("\n"),
    );
  }

  // Brand Kit block
  if (kit) {
    const kitLines: string[] = [];
    if (kit.name) kitLines.push(`Name: ${kit.name}`);
    if (kit.colorsJson) kitLines.push(`Colors: ${JSON.stringify(kit.colorsJson)}`);
    if (kit.fonts?.length) kitLines.push(`Fonts: ${kit.fonts.join(", ")}`);
    if (kit.tone) kitLines.push(`Tone: ${kit.tone}`);
    if (kit.styleGuide) kitLines.push(`Style guide: ${kit.styleGuide}`);
    if (kitLines.length) parts.push(`Brand kit:\n${kitLines.join("\n")}`);
  }

  // Brand Rules block — group by kind
  if (rules.length) {
    const byKind = new Map<string, string[]>();
    for (const r of rules) {
      const bucket = byKind.get(r.kind.toUpperCase()) ?? [];
      bucket.push(r.text);
      byKind.set(r.kind.toUpperCase(), bucket);
    }
    const ruleLines = [...byKind.entries()]
      .map(([kind, texts]) => `${kind}: ${texts.join("; ")}`)
      .join("\n");
    parts.push(`Brand rules:\n${ruleLines}`);
  }

  if (!parts.length) return "";
  const text = parts.join("\n\n");
  if (text.length <= 3000) return text;
  return text.slice(0, 3000) + "\n…(older brand notes not shown)";
}
