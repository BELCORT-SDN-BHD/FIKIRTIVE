"use server";
import { revalidatePath } from "next/cache";
import { SAVE_FAILED } from "./save-failed-copy";
import { prisma } from "@fikirtive/db";
import {
  newId, sectionForCategory, offerPhase, distinctCategories,
  isBrandSectionKey, isBrandContextOrigin,
} from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { resolveActor, recordBrandRevision, stampOf, actorStamp } from "./brand-revision";
import { packBrandContent } from "./brand-context-format";

export type MemoryRow = {
  id: string;
  category: string;
  content: string;
  source: "otto" | "user";
  pinned: boolean;
  updatedAt: Date;
};

/** 只有 `Ready` 的行是**正式记录**。草稿(`Draft`)与读取中(`Processing`)一律不在这里出现,
 *  也不进 Otto 上下文 —— Founder 2026-09-03 裁决四「商家确认之前不落正式记录」的落法是
 *  一条 where 条件,而不是一句约定:任何忘了带它的读路径会读到草稿,带上了就不可能读到。
 *  (规格 docs/specs/frontend-baseline.md §7.3④。) */
const READY_ONLY = { contextStatus: "Ready" } as const;


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
    where: { ownerId, brandId: brandId ?? null, deletedAt: null, ...READY_ONLY },
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
  // FRONT-A8:一条记录从此带着「谁写的」出生,而不是只带一个 'user'。
  const actor = await resolveActor(gate.email);
  let stamp: Date;
  try {
    const created = await prisma.memory.create({
      data: {
        id,
        ownerId: gate.ownerId,
        brandId: typeof r.brandId === "string" ? r.brandId : null,
        category: category.slice(0, 60),
        content: content.slice(0, 2000),
        source: "user",
        pinned: true,
        updatedById: actor.userId,
      },
      select: { updatedAt: true },
    });
    stamp = created.updatedAt;
  } catch { return { error: SAVE_FAILED }; }
  await recordBrandRevision({
    ownerId: gate.ownerId, targetKind: "memory", targetId: id,
    action: "created", stamp, actor, summary: "Added this context.",
  });
  revalidatePath("/", "layout");
  return { ok: true, id };
}


export async function updateMemory(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown; content?: unknown; pinned?: unknown };
  if (typeof r?.id !== "string" || typeof r?.content !== "string") return { error: "Invalid memory edit." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const actor = await resolveActor(gate.email);
  try {
    const { count } = await prisma.memory.updateMany({
      where: { id: r.id, ownerId: gate.ownerId, deletedAt: null },
      data: {
        content: r.content.trim().slice(0, 2000),
        pinned: typeof r.pinned === "boolean" ? r.pinned : undefined,
        source: "user",
        updatedById: actor.userId,
      },
    });
    if (!count) return { error: "Memory not found." };
  } catch { return { error: SAVE_FAILED }; }
  await recordBrandRevision({
    ownerId: gate.ownerId, targetKind: "memory", targetId: r.id, action: "updated",
    stamp: await stampOf(gate.ownerId, r.id, "memory"), actor, summary: "Edited the wording.",
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteMemory(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const actor = await resolveActor(gate.email);
  let removed = false;
  try {
    const { count } = await prisma.memory.updateMany({
      // 判官 P2-1:`deletedAt: null` 少不得。少了它,连按 Remove 会把 `deletedAt` 一次次
      // 盖成新时间,幂等键(含 updatedAt)跟着变 —— 改动史里于是一行接一行 deleted,
      // 一次删除被讲成三次。(与 `discardBrandDraft` 同一条口径。)
      where: { id: r.id, ownerId: gate.ownerId, deletedAt: null },
      // 判官 P2-4:`actor.userId` 查不到 User 行时是 null,无条件写会把这一行已知的作者
      // **抹掉**。删除这件事不该让「谁写的」变成「不知道是谁」——认得出人才改这一列。
      data: { deletedAt: new Date(), ...actorStamp(actor) },
    });
    removed = count > 0;
    if (!removed) {
      // 命中 0 行有两种可能(照 `confirmBrandDraft` 的写法回查真实状态):①这一行已经
      // 删掉了 —— 重发的删除,结果仍然是「已删除」,不是错误,也不该再写一行历史;
      // ②它真的不在了(或不属于这个租户)。
      const already = await prisma.memory.findFirst({
        where: { id: r.id, ownerId: gate.ownerId, deletedAt: { not: null } },
        select: { id: true },
      });
      if (!already) return { error: "Memory not found." };
    }
  } catch { return { error: "Couldn't delete — please try again." }; }
  if (removed) {
    await recordBrandRevision({
      ownerId: gate.ownerId, targetKind: "memory", targetId: r.id, action: "deleted",
      stamp: await stampOf(gate.ownerId, r.id, "memory"), actor, summary: "Removed this context.",
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Undo a soft delete without minting a second memory row. Repeating this is safe. */
export async function restoreMemory(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const actor = await resolveActor(gate.email);
  let broughtBack = false;
  try {
    const { count } = await prisma.memory.updateMany({
      // 判官 P2-1:同上的镜像 —— 只有还在删除态的行才需要恢复。少了它,连按 Restore 会
      // 每次都 bump `updatedAt`,改动史里于是一行接一行 restored。
      where: { id: r.id, ownerId: gate.ownerId, deletedAt: { not: null } },
      // 判官 P2-4:同上 —— 恢复不该顺手把已知作者抹掉。
      data: { deletedAt: null, ...actorStamp(actor) },
    });
    broughtBack = count > 0;
    if (!broughtBack) {
      // 回查真实状态:这一行已经在了 —— 重发的恢复,结果仍然是「已恢复」。
      const already = await prisma.memory.findFirst({
        where: { id: r.id, ownerId: gate.ownerId, deletedAt: null },
        select: { id: true },
      });
      if (!already) return { error: "Memory not found." };
    }
  } catch { return { error: "Couldn't restore — please try again." }; }
  if (broughtBack) {
    await recordBrandRevision({
      ownerId: gate.ownerId, targetKind: "memory", targetId: r.id, action: "restored",
      stamp: await stampOf(gate.ownerId, r.id, "memory"), actor, summary: "Brought this context back.",
    });
  }
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
  return compileBrandContext(gate.ownerId, brandId ?? null, null);
}

/** The one place Otto's brand context is assembled. NOT exported — this module is
 *  "use server", so an export here would be a client-callable action, and `includeDraftId`
 *  is exactly the kind of parameter that must never be reachable from a browser.
 *
 *  FRONT-A9 / 裁决四: `contextStatus: "Ready"` on BOTH reads is what makes a draft
 *  structurally unreachable by Otto. `includeDraftId` lets the merchant's own preview
 *  (and only that) answer "what would change if I saved this?" — see
 *  `previewBrandContextEffect` below. */
async function compileBrandContext(
  ownerId: string,
  brandId: string | null,
  includeDraftId: string | null,
): Promise<string> {
  const memoryStatus = includeDraftId
    ? { OR: [{ contextStatus: "Ready" }, { id: includeDraftId }] }
    : READY_ONLY;

  const [rows, kit, rules, records] = await Promise.all([
    prisma.memory.findMany({
      where: { ownerId, brandId: brandId ?? null, deletedAt: null, ...memoryStatus },
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
      where: { ownerId, brandId: brandId ?? null, deletedAt: null, ...READY_ONLY },
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
      const categories = distinctCategories(records as Array<{ kind: string; status: string; data: Record<string, unknown> }>);
      const catSegment = categories.length ? ` Categories: ${categories.join(", ")}.` : "";
      lines.push(`Your products: ${products.length} total (${pinnedCount} pinned).${catSegment} Top:`);
      for (const rec of products.slice(0, 10)) {
        const d = rec.data as Record<string, unknown>;
        const bits = [str(d.description), str(d.price), str(d.sellingAngle) && `angle: ${d.sellingAngle}`].filter(Boolean);
        const cat = str(d.category);
        lines.push(`- ${str(d.name) ?? "?"}${bits.length ? ` — ${bits.join("; ")}` : ""}${cat ? ` [${cat}]` : ""}`);
      }
      if (products.length > 10) lines.push("(use lookupProducts for the rest)");
    }
    for (const f of factsBySection.get("products") ?? []) lines.push(`- ${f}`);
    if (lines.length) parts.push(cap(lines.join("\n"), 800));
  }

  if (!parts.length) return "";
  return parts.join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// 草稿流(FRONT-A8;Founder 2026-09-03 裁决四:「加来源 → 抽取 → 生成草稿 → 预览效果
// → 确认保存」,商家确认之前不落正式记录)
//
// 五步是五个真动作,不是一个向导的五个 UI 步骤。分开的理由是**前三步一个字节都不写库**:
// 商家在还没决定之前,库里不该多出任何东西 —— 包括一条「反正是草稿」的行。第一次落库
// 发生在 `saveBrandDraft`,而那一行带 `contextStatus='Draft'`,被上面 READY_ONLY 那道
// where 条件挡在 Otto 之外。
//
// 钱:这条链**一分钱都不花**。设计里的「Preview effect」在夹具上比的是模型生成的样例文案;
// 那要调模型,而调模型的价格今天在集中配置里没有单一权威(钱引擎规格已交付·归档,
// 新增一笔计费腿要另立规格)。所以这里的预览换成一件**真实且免费**的事:把这条草稿保存
// 前后 Otto 实际拿到的品牌上下文原文摆出来对比。它是服务器算的真事,不是样例;要模型
// 生成的样例预览,等钱路给出价目再补(见 PR 的「设计有、生产暂不显示」表)。
// ─────────────────────────────────────────────────────────────────────────────

/** ① 加来源。**不写库**:只判断这份来源我们收不收,以及它带来的是什么。
 *  今天只收 `text`(商家自己粘贴的材料)。URL 与文件要真去读一个网页/一份文件,
 *  那是花钱的动作,价目未定,所以入口在生产上根本不渲染(见 PR 的暂不显示表)。 */
export async function addBrandSource(
  raw: unknown,
): Promise<{ ok: true; origin: "text"; originDetail: string; text: string } | { error: string }> {
  const r = raw as { sourceKind?: unknown; text?: unknown };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  if (r?.sourceKind !== "text") {
    return { error: "Only pasted text can be added right now." };
  }
  const text = typeof r?.text === "string" ? r.text.trim() : "";
  if (!text) return { error: "Paste the material you want Otto to learn from." };
  return { ok: true, origin: "text", originDetail: "Pasted text", text };
}

/** ② 抽取。今天对粘贴的文字做的是**规整**,不是模型抽取 —— 商家自己写的话,本来就是内容。
 *  界面照这个事实说话(「Review what will be saved」),不许说成 Otto 读懂了什么。
 *  **不写库。** */
export async function extractBrandDraft(
  raw: unknown,
): Promise<{ ok: true; name: string; content: string } | { error: string }> {
  const r = raw as { name?: unknown; text?: unknown };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const name = typeof r?.name === "string" ? r.name.trim().slice(0, 80) : "";
  const text = typeof r?.text === "string" ? r.text : "";
  if (!name) return { error: "Give this context a name." };
  const content = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000);
  if (!content) return { error: "Paste the material you want Otto to learn from." };
  return { ok: true, name, content };
}

/** ③ 生成草稿 —— 这一步才第一次写库,而且写的是 `contextStatus='Draft'`。
 *  草稿不是正式记录:`listMemory` 与 Otto 上下文都读不到它(READY_ONLY)。 */
export async function saveBrandDraft(
  raw: unknown,
): Promise<{ ok: true; id: string } | { error: string }> {
  const r = raw as { section?: unknown; name?: unknown; content?: unknown; origin?: unknown; originDetail?: unknown };
  const section = typeof r?.section === "string" ? r.section : "";
  if (!isBrandSectionKey(section)) return { error: "Unknown section." };
  const name = typeof r?.name === "string" ? r.name.trim().slice(0, 80) : "";
  const content = typeof r?.content === "string" ? r.content.trim().slice(0, 2000) : "";
  if (!name || !content) return { error: "A context needs a name and some text." };
  const origin = isBrandContextOrigin(r?.origin) ? r.origin : "manual";
  const originDetail = typeof r?.originDetail === "string" ? r.originDetail.slice(0, 200) : null;

  const gate = await requireOwner(); if ("error" in gate) return gate;
  const actor = await resolveActor(gate.email);
  const id = newId();
  try {
    await prisma.memory.create({
      data: {
        id, ownerId: gate.ownerId, brandId: null,
        category: section, content: packBrandContent(name, content),
        source: "user", pinned: true,
        contextStatus: "Draft", origin, originDetail, updatedById: actor.userId,
      },
    });
  } catch { return { error: "Couldn't save that draft — please try again." }; }
  revalidatePath("/", "layout");
  return { ok: true, id };
}

/** ④ 预览效果。免费、无模型:把这条草稿保存前后 Otto 实际读到的品牌上下文原文摆出来。
 *  草稿必须是自己的(where 带 ownerId),而且必须还是草稿 —— 已经是正式记录的行没有
 *  「保存前」可言。 */
export async function previewBrandContextEffect(
  raw: unknown,
): Promise<{ ok: true; without: string; with: string } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const draft = await prisma.memory.findFirst({
    where: { id: r.id, ownerId: gate.ownerId, deletedAt: null, contextStatus: "Draft" },
    select: { id: true },
  });
  if (!draft) return { error: "That draft is no longer here." };
  const [without, withDraft] = await Promise.all([
    compileBrandContext(gate.ownerId, null, null),
    compileBrandContext(gate.ownerId, null, draft.id),
  ]);
  return { ok: true, without, with: withDraft };
}

/** ⑤ 确认保存 —— 草稿变成正式记录的**唯一**一步。到这一刻之前 Otto 读不到它。 */
export async function confirmBrandDraft(
  raw: unknown,
): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const actor = await resolveActor(gate.email);
  let confirmed = false;
  try {
    // 判官 P2-5:where 必须带 `contextStatus: "Draft"`。少了它,一条已经是 Ready 的行
    // 每被确认一次就 bump 一次 `updatedAt`,并且因为幂等键含 updatedAt,改动史里会多出
    // 一行又一行「Saved this context for Otto.」—— 一次保存被讲成三次。
    const { count } = await prisma.memory.updateMany({
      where: { id: r.id, ownerId: gate.ownerId, deletedAt: null, contextStatus: "Draft" },
      data: { contextStatus: "Ready", ...actorStamp(actor) },
    });
    confirmed = count > 0;
    if (!confirmed) {
      // 命中 0 行有两种可能:①这一行已经是 Ready —— 重发的确认,结果仍然是「已保存」,
      // 不是错误,也不该再写一行历史;②它真的不在了。
      const already = await prisma.memory.findFirst({
        where: { id: r.id, ownerId: gate.ownerId, deletedAt: null, ...READY_ONLY },
        select: { id: true },
      });
      if (!already) return { error: "That draft is no longer here." };
    }
  } catch { return { error: SAVE_FAILED }; }
  if (confirmed) {
    await recordBrandRevision({
      ownerId: gate.ownerId, targetKind: "memory", targetId: r.id, action: "confirmed",
      stamp: await stampOf(gate.ownerId, r.id, "memory"), actor,
      summary: "Saved this context for Otto.",
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** 放弃草稿。软删除,不是硬删 —— 与这一面其他删除同一个语义,也就还留着后悔的余地。 */
export async function discardBrandDraft(
  raw: unknown,
): Promise<{ ok: true } | { error: string }> {
  const r = raw as { id?: unknown };
  if (typeof r?.id !== "string") return { error: "Invalid request." };
  const gate = await requireOwner(); if ("error" in gate) return gate;
  const actor = await resolveActor(gate.email);
  try {
    const { count } = await prisma.memory.updateMany({
      // 判官复验尾巴①:`deletedAt: null` 少不得。已经放弃过的行还留着 Draft 状态,
      // 少了它,重复调用会把 `deletedAt` 盖成新的时间,幂等键(含 updatedAt)也就跟着
      // 变 —— 改动史里于是一行接一行「Discarded this draft.」,一次放弃被讲成三次。
      where: { id: r.id, ownerId: gate.ownerId, contextStatus: "Draft", deletedAt: null },
      data: { deletedAt: new Date(), ...actorStamp(actor) },
    });
    if (!count) return { error: "That draft is no longer here." };
  } catch { return { error: "Couldn't discard that — please try again." }; }
  // 判官 P2-3:这是这一面**唯一**一个不写改动史的写动作。放弃草稿也是一次改动 ——
  // 「这里本来有一条,是谁在什么时候丢掉的」跟其他四个动作一样该答得出。
  await recordBrandRevision({
    ownerId: gate.ownerId, targetKind: "memory", targetId: r.id, action: "discarded",
    stamp: await stampOf(gate.ownerId, r.id, "memory"), actor,
    summary: "Discarded this draft.",
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
