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

/** 身份那两格的键名。价签(`BrandRecord.data`)从此**不承载**它们(规格 §1.4)。 */
export const PRODUCT_IDENTITY_KEYS = ["name", "imageAssetId"] as const;

/**
 * 价签落库前剥掉身份那两格 —— 名字与主图的**唯一源是 `Entity`**
 * (规格 `docs/specs/brand-product-identity.md` §1.4;验收 PRODID-A4)。
 *
 * 判官第 5 轮(PR #1337)的根:上一版把这两格留在 `data` 里当「缓存」,于是同一个事实有
 * **两处写得动的存放点**。四轮里每一条 P1(换图意图判据、缓存反写权威、回滚不还原 data、
 * 理解 worker 覆盖商家改的名字)都是从这个根上长出来的。根拔掉的办法只有一个:入库前
 * 把这两个键删掉,读路一律从身份取(`withProductIdentity`)。
 *
 * **草稿例外**:`contextStatus: "Draft"` 的产品此刻**没有身份**(规格 §1.9),它的名字与
 * 主图只有 `data` 这一处记法 —— 一处不是两处,所以草稿不剥。确认(`confirmProductDraft`)
 * 建出身份的同一个事务里,这两格才从 `data` 里消失。
 */
export function stripProductIdentity<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = { ...data };
  for (const k of PRODUCT_IDENTITY_KEYS) delete out[k];
  return out as T;
}

/**
 * 读路那一半:把身份(`Entity`)上的名字与主图盖进价签的 `data`
 * (规格 `docs/specs/brand-product-identity.md` §1.4;验收 PRODID-A4)。
 *
 * 名字与主图的**单一源是身份**,而 `data` 里根本不再有这两格(写路 `stripProductIdentity`),
 * 所以这一层不是「盖掉缓存」而是**把身份补进来** —— 少了它,产品的 `data` 连名字都没有。
 *
 * 住在 core 而不是 db,因为它是纯函数 —— 四条读路(Brand 页 `listBrandRecords`、`/brand`
 * 的 `loadBrandSections`、Otto 上下文 `compileBrandContext`、Otto 技能 `lookupProducts`)
 * 共用同一份判断,谁都不必先要一个数据库。
 *
 * 草稿此刻没有身份(`entity` 为 null),照原样返回 —— 它的名字就在 `data` 里。
 */
export function withProductIdentity<T extends Record<string, unknown>>(
  kind: string,
  data: T,
  entity: { name: string; baseAssetId: string | null } | null | undefined,
): T {
  if (kind !== "product" || !entity) return data;
  const out: Record<string, unknown> = { ...data, name: entity.name };
  if (entity.baseAssetId) out.imageAssetId = entity.baseAssetId;
  else delete out.imageAssetId; // 身份上没有主图 = 这件产品没有主图
  return out as T;
}
