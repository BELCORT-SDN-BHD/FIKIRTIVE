/** Brand living-collection record shapes (founder decision C, 2026-07-02).
 *  Pure: zod schemas + name/date helpers. No IO. Shared by web actions + otto skills. */
import { z } from "zod";

export const RECORD_KINDS = ["product", "segment", "offer"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const productRecordData = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  /** Display-only free text ("RM 49"). NEVER parsed into any billing/credits logic. */
  price: z.string().max(60).optional(),
  url: z.string().max(500).optional(),
  sellingAngle: z.string().max(300).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
  /** Type-to-create category; display keeps original casing. */
  category: z.string().max(40).optional(),
  /** Optional My Stuff asset link for the showcase card. Display-only; UI-managed (OTTO skills never accept it). */
  imageAssetId: z.string().max(64).optional(),
});
export type ProductRecordData = z.infer<typeof productRecordData>;

export const segmentRecordData = z.object({
  name: z.string().min(1).max(120),
  who: z.string().min(1).max(400),
  pains: z.string().max(400).optional(),
  wants: z.string().max(400).optional(),
  channels: z.string().max(200).optional(),
  toneTips: z.string().max(300).optional(),
});
export type SegmentRecordData = z.infer<typeof segmentRecordData>;

/** Offer dates (startsAt/endsAt) live in real BrandRecord columns, NOT in data. */
export const offerRecordData = z.object({
  title: z.string().min(1).max(160),
  details: z.string().max(400).optional(),
  code: z.string().max(60).optional(),
  appliesTo: z.string().max(200).optional(),
});
export type OfferRecordData = z.infer<typeof offerRecordData>;

export function recordSchemaFor(kind: RecordKind): z.ZodObject<any> {
  return kind === "product" ? productRecordData : kind === "segment" ? segmentRecordData : offerRecordData;
}

export function recordName(kind: RecordKind, data: unknown): string {
  const d = data as Record<string, unknown> | null;
  const raw = kind === "offer" ? d?.title : d?.name;
  return typeof raw === "string" ? raw : "";
}

export function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export type OfferPhase = "active" | "scheduled" | "expired";
/** Read-time phase derivation — status is never written back (undo stays clean). */
export function offerPhase(o: { startsAt?: Date | null; endsAt?: Date | null }, now: Date): OfferPhase {
  if (o.endsAt && o.endsAt.getTime() < now.getTime()) return "expired";
  if (o.startsAt && o.startsAt.getTime() > now.getTime()) return "scheduled";
  return "active";
}

/** Case-insensitive grouping key for type-to-create categories (display keeps original casing). */
export function categoryKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Derived category list: distinct categories of ACTIVE products, first-seen casing, insertion order. */
export function distinctCategories(
  records: Array<{ kind: string; status: string; data: Record<string, unknown> }>,
): string[] {
  const seen = new Map<string, string>();
  for (const r of records) {
    if (r.kind !== "product" || r.status !== "active") continue;
    const raw = r.data.category;
    if (typeof raw !== "string" || !raw.trim()) continue;
    const key = categoryKey(raw);
    if (!seen.has(key)) seen.set(key, raw.trim());
  }
  return [...seen.values()];
}

/**
 * 读路那一半:把身份(`Entity`)上的名字与主图盖回价签的 `data`
 * (规格 `docs/specs/brand-product-identity.md` §1.4;验收 PRODID-A4)。
 *
 * 名字与主图的**单一源是身份**,`data` 里那两格是缓存,由 `@fikirtive/db` 的
 * `createProduct` / `confirmProductDraft` / `updateProductRecord` / `renameProductIdentity`
 * 在同一个事务里跟着写。这一层是**兜底**:存量行、回填行、以及任何绕过共享动作的写入,
 * 都不会让商家在 Brand 页看到一个跟 Library 不一样的名字。
 *
 * 住在 core 而不是 db,因为它是纯函数 —— 三条读路(Brand 页 `listBrandRecords`、Otto 上下文
 * `compileBrandContext`、Otto 技能 `lookupProducts`)共用同一份判断,谁都不必先要一个数据库。
 *
 * 草稿此刻没有身份(`entity` 为 null),照原样返回。
 */
export function withProductIdentity<T extends Record<string, unknown>>(
  kind: string,
  data: T,
  entity: { name: string; baseAssetId: string | null } | null | undefined,
): T {
  if (kind !== "product" || !entity) return data;
  const out: Record<string, unknown> = { ...data, name: entity.name };
  if (entity.baseAssetId) out.imageAssetId = entity.baseAssetId;
  else delete out.imageAssetId; // 身份上没有主图 = 这件产品没有主图,缓存里那一格是过期的
  return out as T;
}
