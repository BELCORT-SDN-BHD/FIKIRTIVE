"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import { newId, sectionForCategory, offerPhase } from "@fikirtive/core";
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

  const [rows, kit, rules, records] = await Promise.all([
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
    prisma.brandRecord.findMany({
      where: { ownerId, brandId: brandId ?? null, deletedAt: null },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      select: { kind: true, data: true, status: true, startsAt: true, endsAt: true, pinned: true },
    }),
  ]);

  // Per-section budgets (chars). Rules are assembled FIRST so they can never be
  // truncated by other sections growing (the old global slice(0,3000) cut them first).
  const cap = (text: string, budget: number) => (text.length <= budget ? text : text.slice(0, budget) + "…");
  const now = new Date();

  // Facts grouped into the 6-section taxonomy (legacy categories map here).
  const factsBySection = new Map<string, string[]>();
  for (const r of rows) {
    const key = sectionForCategory(r.category);
    factsBySection.set(key, [...(factsBySection.get(key) ?? []), r.content]);
  }

  const parts: string[] = [];

  // 1) Do & don't — budget 600
  {
    const lines: string[] = [];
    const byKind = new Map<string, string[]>();
    for (const r of rules) byKind.set(r.kind.toUpperCase(), [...(byKind.get(r.kind.toUpperCase()) ?? []), r.text]);
    for (const [kind, texts] of byKind) lines.push(`${kind}: ${texts.join("; ")}`);
    for (const f of factsBySection.get("rules") ?? []) lines.push(f);
    if (lines.length) parts.push(cap(`Brand rules:\n${lines.join("\n")}`, 600));
  }

  // 2) About + Look & feel + Brand kit — budget 1200 combined
  {
    const lines: string[] = [];
    const about = factsBySection.get("about") ?? [];
    if (about.length) lines.push(`About the brand: ${about.join("; ")}`);
    const look = factsBySection.get("look") ?? [];
    if (look.length) lines.push(`Look & feel: ${look.join("; ")}`);
    if (kit) {
      const kitLines: string[] = [];
      if (kit.name) kitLines.push(`Name: ${kit.name}`);
      if (kit.colorsJson) kitLines.push(`Colors: ${JSON.stringify(kit.colorsJson)}`);
      if (kit.fonts?.length) kitLines.push(`Fonts: ${kit.fonts.join(", ")}`);
      if (kit.tone) kitLines.push(`Tone: ${kit.tone}`);
      if (kit.styleGuide) kitLines.push(`Style guide: ${kit.styleGuide}`);
      if (kitLines.length) lines.push(`Brand kit:\n${kitLines.join("\n")}`);
    }
    if (lines.length) parts.push(cap(lines.join("\n"), 1200));
  }

  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

  // 3) Your customers — budget 900
  {
    const lines: string[] = [];
    for (const rec of records) {
      if (rec.kind !== "segment" || rec.status !== "active") continue;
      const d = rec.data as Record<string, unknown>;
      const bits = [str(d.who), str(d.pains) && `pains: ${d.pains}`, str(d.wants) && `wants: ${d.wants}`,
        str(d.channels) && `reach: ${d.channels}`, str(d.toneTips) && `tone: ${d.toneTips}`].filter(Boolean);
      lines.push(`- ${str(d.name) ?? "?"}: ${bits.join("; ")}`);
    }
    for (const f of factsBySection.get("customers") ?? []) lines.push(`- ${f}`);
    if (lines.length) parts.push(cap(`Your customers:\n${lines.join("\n")}`, 900));
  }

  // 4) Your offers — budget 500; expired NEVER injected (read-time derivation)
  {
    const lines: string[] = [];
    for (const rec of records) {
      if (rec.kind !== "offer" || rec.status !== "active") continue;
      const phase = offerPhase(rec, now);
      if (phase === "expired") continue;
      const d = rec.data as Record<string, unknown>;
      const bits = [str(d.details), str(d.code) && `code ${d.code}`,
        rec.endsAt && `ends ${rec.endsAt.toISOString().slice(0, 10)}`].filter(Boolean);
      lines.push(`- ${phase === "scheduled" ? "(upcoming) " : ""}${str(d.title) ?? "?"}${bits.length ? ` (${bits.join("; ")})` : ""}`);
    }
    if (lines.length) parts.push(cap(`Your offers (active):\n${lines.join("\n")}`, 500));
  }

  // 5) Your products — budget 800: summary + Top-10 + lookup hint
  {
    const products = records.filter((r) => r.kind === "product" && r.status === "active");
    const lines: string[] = [];
    if (products.length) {
      const pinnedCount = products.filter((p) => p.pinned).length;
      lines.push(`Your products: ${products.length} total (${pinnedCount} pinned). Top:`);
      for (const rec of products.slice(0, 10)) {
        const d = rec.data as Record<string, unknown>;
        const bits = [str(d.description), str(d.price), str(d.sellingAngle) && `angle: ${d.sellingAngle}`].filter(Boolean);
        lines.push(`- ${str(d.name) ?? "?"}${bits.length ? ` — ${bits.join("; ")}` : ""}`);
      }
      if (products.length > 10) lines.push("(use lookupProducts for the rest)");
    }
    for (const f of factsBySection.get("products") ?? []) lines.push(`- ${f}`);
    if (lines.length) parts.push(cap(lines.join("\n"), 800));
  }

  if (!parts.length) return "";
  return parts.join("\n\n");
}
