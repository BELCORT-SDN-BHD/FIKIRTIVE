/** Brand memory sections (6, founder-approved 2026-07-02) + snapshot diff for the live-edit/undo UI. Pure, no IO. */

export const SECTIONS = [
  { key: "about", label: "About the brand" },
  { key: "look", label: "Look & feel" },
  { key: "customers", label: "Your customers" },
  { key: "products", label: "Your products" },
  { key: "offers", label: "Your offers" },
  { key: "rules", label: "Do & don't" },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];

/** New FACTS may only be filed to these; customers/products/offers take structured records. */
export const FACT_SECTION_KEYS = ["about", "look", "rules"] as const;

const LEGACY: Record<string, SectionKey> = {
  brand: "about", voice: "about", audience: "customers", products: "products", rules: "rules",
  about: "about", look: "look", customers: "customers", offers: "offers",
  // 五节 key(FRONT-A8,规格 §7.3④)也解析得回老六节 —— 新 Brand 界面写入的
  // `Memory.category` 用的是设计的五节 key,而 `getBrandContextText` 仍按老六节分段。
  // 存量行的 category 一个字节都没改,所以 Otto 读到的正文与迁移前逐字相同(理由见文件末尾)。
  "brand-voice": "about", audiences: "customers", "knowledge-base": "products",
  "style-guide": "rules", "visual-guidelines": "look",
};

export function sectionForCategory(category: string): SectionKey {
  return LEGACY[category.trim().toLowerCase()] ?? "about";
}

export type RowDiff<T> = { added: T[]; changed: { before: T; after: T }[]; removed: T[] };

const ts = (v: Date | string) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/** id + updatedAt based diff between a pre-turn snapshot and a post-turn refetch. */
export function diffRows<T extends { id: string; updatedAt: Date | string }>(before: T[], after: T[]): RowDiff<T> {
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const afterIds = new Set(after.map((r) => r.id));
  const added: T[] = [];
  const changed: { before: T; after: T }[] = [];
  for (const row of after) {
    const prev = beforeById.get(row.id);
    if (!prev) added.push(row);
    else if (ts(prev.updatedAt) !== ts(row.updatedAt)) changed.push({ before: prev, after: row });
  }
  const removed = before.filter((r) => !afterIds.has(r.id));
  return { added, changed, removed };
}

const KIND_SECTION: Record<string, SectionKey> = { segment: "customers", product: "products", offer: "offers" };

/** Which tabs a chat turn touched — drives the per-tab coral dot. */
export function sectionsTouched(
  factDiff: RowDiff<{ id: string; updatedAt: Date | string; category: string }>,
  recDiff: RowDiff<{ id: string; updatedAt: Date | string; kind: string }>,
): Set<SectionKey> {
  const out = new Set<SectionKey>();
  for (const f of [...factDiff.added, ...factDiff.removed, ...factDiff.changed.map((c) => c.after)]) out.add(sectionForCategory(f.category));
  for (const r of [...recDiff.added, ...recDiff.removed, ...recDiff.changed.map((c) => c.after)]) {
    const s = KIND_SECTION[r.kind];
    if (s) out.add(s);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 五节品牌分区（FRONT-A8；规格 docs/specs/frontend-baseline.md §7.3④，
// Founder 2026-09-03 裁决三 ＋ 裁决十一）
//
// 生产今天存的是 2026-07-02 批的六节（上面的 `SECTIONS`），设计（
// `apps/web/design-system/patterns/brand/model.ts` 的 `BRAND_SECTIONS`）是五节。
// 裁决三／十一把六→五的对应全表定死，产品／优惠两节并进 Knowledge base。
//
// ── 为什么这一层是纯映射，一行数据都不改写 ──────────────────────────────────
// 规格原话是「迁移只改『这条记录归哪一节』，**不删任何行**；`sectionForCategory` 的
// LEGACY 表同批扩写，旧 category 字符串继续解析得出新节」。把 `Memory.category` 的
// 存量值真的 UPDATE 成新节字符串是**做得到但不该做**的：`getBrandContextText` 用
// 老六节的 key 决定每一段的标题与预算，而六→五是**多对一**（products ＋ offers →
// knowledge-base）。一旦写回去再解析回来，原本落在 `offers` 桶（该函数今天根本不读）
// 的备注就会冒到「Your products」段里 —— Otto 读到的正文当场就变了。
// 所以：**存量 category 一个字节不动**，归属靠这里的函数在读的时候算出来；
// LEGACY 表同批扩写，只为让**新写入**的五节 key 也解析得回老六节。
// 结果是 A9 那条「Otto 读到的与迁移前逐字相同」可以被一条断言证明，而不是被相信。
// ─────────────────────────────────────────────────────────────────────────────

/** 设计权威的五节，逐字取自 `apps/web/design-system/patterns/brand/model.ts`。 */
export const BRAND_SECTIONS = [
  { key: "brand-voice", label: "Brand voice", action: "Add brand voice" },
  { key: "audiences", label: "Audiences", action: "Add audience" },
  { key: "knowledge-base", label: "Knowledge base", action: "Add knowledge" },
  { key: "style-guide", label: "Style guide", action: "Add style guide" },
  { key: "visual-guidelines", label: "Visual guidelines", action: "Add visual guideline" },
] as const;

export type BrandSectionKey = (typeof BRAND_SECTIONS)[number]["key"];

export function isBrandSectionKey(value: unknown): value is BrandSectionKey {
  return typeof value === "string" && BRAND_SECTIONS.some((s) => s.key === value);
}

export function brandSectionLabel(key: BrandSectionKey): string {
  return BRAND_SECTIONS.find((s) => s.key === key)?.label ?? "Brand voice";
}

export function brandSectionAction(key: BrandSectionKey): string {
  return BRAND_SECTIONS.find((s) => s.key === key)?.action ?? "Add brand voice";
}

/** 六 → 五的全表（Founder 2026-09-03 裁决三＋裁决十一）。没有待确认项。 */
export const LEGACY_SECTION_TO_BRAND_SECTION: Record<SectionKey, BrandSectionKey> = {
  about: "brand-voice",
  customers: "audiences",
  products: "knowledge-base",
  offers: "knowledge-base",
  look: "visual-guidelines",
  rules: "style-guide",
};

/** 五 → 六的回程（多对一的逆向取一个代表节）。只作用于**新写入**的五节 key：
 *  它让 `sectionForCategory` 继续答得出老六节，`getBrandContextText` 因此一个字不用改。 */
export const BRAND_SECTION_TO_LEGACY_SECTION: Record<BrandSectionKey, SectionKey> = {
  "brand-voice": "about",
  audiences: "customers",
  "knowledge-base": "products",
  "style-guide": "rules",
  "visual-guidelines": "look",
};

/** 一条 `Memory.category`（新旧字符串皆可）归哪一个五节分区。 */
export function brandSectionForCategory(category: string): BrandSectionKey {
  return LEGACY_SECTION_TO_BRAND_SECTION[sectionForCategory(category)];
}

/** 一条 `BrandRecord.kind` 归哪一个五节分区。产品与优惠都进 Knowledge base（裁决三）。 */
export function brandSectionForRecordKind(kind: string): BrandSectionKey {
  return LEGACY_SECTION_TO_BRAND_SECTION[KIND_SECTION[kind] ?? "about"];
}

/** 上下文行的三态（设计 `ContextRecord.status`）。`Ready` 之外的行永不进 Otto 上下文。 */
export const BRAND_CONTEXT_STATUSES = ["Ready", "Draft", "Processing"] as const;
export type BrandContextStatus = (typeof BRAND_CONTEXT_STATUSES)[number];

export function isBrandContextStatus(value: unknown): value is BrandContextStatus {
  return typeof value === "string" && (BRAND_CONTEXT_STATUSES as readonly string[]).includes(value);
}

/** 一条上下文的来源（设计 `ContextRecord.source` / `sourceDetail`）。
 *  与 `Memory.source`（'otto' | 'user' ＝ 最后是谁写的）**不是一回事**，不复用同一列。 */
export const BRAND_CONTEXT_ORIGINS = ["manual", "text", "url", "file"] as const;
export type BrandContextOrigin = (typeof BRAND_CONTEXT_ORIGINS)[number];

export function isBrandContextOrigin(value: unknown): value is BrandContextOrigin {
  return typeof value === "string" && (BRAND_CONTEXT_ORIGINS as readonly string[]).includes(value);
}

const ORIGIN_LABEL: Record<BrandContextOrigin, string> = {
  manual: "Written here",
  text: "Pasted text",
  url: "Web page",
  file: "Uploaded file",
};

export function brandOriginLabel(origin: string): string {
  return isBrandContextOrigin(origin) ? ORIGIN_LABEL[origin] : ORIGIN_LABEL.manual;
}
