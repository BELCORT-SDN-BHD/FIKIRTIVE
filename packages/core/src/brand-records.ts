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
