/**
 * Typed reference IDs — the vocabulary the Otto `@` reference picker submits.
 *
 * Design authority: `apps/web/design-system/information-architecture/reference-picker-contract.md`
 * §4 ("Picker 只提交 typed ID，不复制 image URL、Product facts 或媒体文件"). The seven contract
 * types are mirrored verbatim from the approved fixture's taxonomy
 * (`apps/web/design-system/patterns/reference-picker/model.ts`); a test in this package asserts the
 * two lists stay identical so the fixture can never drift away from production silently.
 *
 * `brandmark` is the eighth member and is NOT in the contract's §4 table. It exists because
 * production's `EntityType` has had `BRANDMARK` since before this contract was written, and those
 * entities are mentionable today — dropping them from the picker would delete a working capability
 * rather than converge on the design. It is carried, and registered for a Founder ruling.
 */

/** The seven types the frozen contract §4 names, in the fixture's order. */
export const CONTRACT_REFERENCE_TYPES = [
  "product",
  "character",
  "official-avatar",
  "location",
  "clothes",
  "generation",
  "upload",
] as const;

export const REFERENCE_TYPES = [...CONTRACT_REFERENCE_TYPES, "brandmark"] as const;

export type ReferenceType = (typeof REFERENCE_TYPES)[number];

/** A reference is a *type plus an id*, never a bare string: two sources can share an id shape. */
export interface ReferenceRef {
  type: ReferenceType;
  id: string;
}

/** The types that resolve to an `Entity` row. The rest resolve to media. */
export const ENTITY_REFERENCE_TYPES = [
  "product",
  "character",
  "official-avatar",
  "location",
  "brandmark",
] as const satisfies readonly ReferenceType[];

export function isReferenceType(value: string): value is ReferenceType {
  return (REFERENCE_TYPES as readonly string[]).includes(value);
}

export function isEntityReferenceType(type: ReferenceType): boolean {
  return (ENTITY_REFERENCE_TYPES as readonly ReferenceType[]).includes(type);
}

/**
 * Wire/persistence form: `"<type>:<id>"`. Ids are `newId()` values (no colon), so the FIRST colon
 * is always the separator — parsing splits there rather than on the last one, which would corrupt
 * any id that ever grew a colon instead of failing loudly.
 */
export function formatReferenceRef(ref: ReferenceRef): string {
  return `${ref.type}:${ref.id}`;
}

/** `null` for anything that is not a well-formed typed ref — callers must not guess a type. */
export function parseReferenceRef(raw: string): ReferenceRef | null {
  const at = raw.indexOf(":");
  if (at <= 0) return null;
  const type = raw.slice(0, at);
  const id = raw.slice(at + 1);
  if (!id || !isReferenceType(type)) return null;
  return { type, id };
}

/** Deduplicate by identity (type + id), first occurrence wins. Contract §2/§6. */
export function dedupeReferenceRefs<T extends ReferenceRef>(refs: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const ref of refs) {
    const key = formatReferenceRef(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}
