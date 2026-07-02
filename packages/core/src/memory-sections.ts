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
