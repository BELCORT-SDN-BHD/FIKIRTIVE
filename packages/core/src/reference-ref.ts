/**
 * Typed reference IDs — the vocabulary the Otto `@` reference picker submits.
 *
 * Design authority: `apps/web/design-system/information-architecture/reference-picker-contract.md`
 * §4 ("Picker 只提交 typed ID，不复制 image URL、Product facts 或媒体文件"). The seven contract
 * types are mirrored verbatim from the approved fixture's taxonomy
 * (`apps/web/design-system/patterns/reference-picker/model.ts`). This package cannot import from
 * `apps/web`, so the test that actually READS that fixture and compares it with this list lives on
 * the web side: `apps/web/lib/__tests__/reference-picker-pattern.test.ts`. The test in this package
 * pins the same list as a literal — the two together are what make a silent drift impossible.
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

/**
 * How many typed references one chat turn may carry. The menu offers 8 rows at a time and a
 * merchant picks a handful; a bound a real draft cannot reach still stops a scripted client from
 * turning one message into an unbounded batch of ownership lookups. One number, read by the
 * request schema (`cowork.ts`) and by the server-side resolver, so the two can never disagree.
 */
export const MAX_TURN_REFERENCES = 24;

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

/**
 * Parse a whole wire list: every well-formed ref, deduped, order preserved.
 *
 * Malformed entries are DROPPED, not coerced. The alternative — guessing a type for a bare id —
 * is what the typed form exists to make impossible, and a ref nobody can name is a ref nobody
 * can link back to. Callers that must refuse the request instead of dropping compare lengths.
 */
export function parseReferenceRefs(raw: readonly string[]): ReferenceRef[] {
  const parsed: ReferenceRef[] = [];
  for (const entry of raw) {
    const ref = parseReferenceRef(entry);
    if (ref) parsed.push(ref);
  }
  return dedupeReferenceRefs(parsed);
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
