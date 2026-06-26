import type { EntityDTO } from "@/lib/types";

export type EntityGroup = { type: EntityDTO["type"]; label: string; items: EntityDTO[] };

const SECTION_ORDER: Array<{ type: EntityDTO["type"]; label: string }> = [
  { type: "PRODUCT", label: "Products" },
  { type: "CHARACTER", label: "Characters" },
  { type: "LOCATION", label: "Locations" },
  { type: "BRANDMARK", label: "Brand marks" },
];

/**
 * Filter by case-insensitive name substring, then group into the fixed section
 * order (Products, Characters, Locations, Brand marks). Omits empty groups.
 */
export function groupEntitiesByType(entities: EntityDTO[], query: string): EntityGroup[] {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? entities.filter((e) => (e.name ?? "").toLowerCase().includes(needle))
    : entities;

  const groups: EntityGroup[] = [];
  for (const { type, label } of SECTION_ORDER) {
    const items = filtered.filter((e) => e.type === type);
    if (items.length > 0) groups.push({ type, label, items });
  }
  return groups;
}
