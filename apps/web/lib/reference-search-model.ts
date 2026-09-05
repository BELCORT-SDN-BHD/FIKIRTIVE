/**
 * The shape and the ordering rules of an `@` reference row — shared by the server search
 * (`reference-search.ts`), the server action, and both composers' menus.
 *
 * Client-safe on purpose: it imports no `server-only` module, so the picker component can use the
 * same labels and the same ranking the database page was built with, instead of a second copy that
 * drifts. Design authority: `design-system/information-architecture/reference-picker-contract.md`
 * §2 (ordering, row cap, Recent cap) and §3 (row anatomy).
 */
import type { ReferenceType } from "@fikirtive/core/reference-ref";

/** Contract §2 — "最多显示约 8 行，之后在菜单内部滚动". */
export const REFERENCE_PAGE_LIMIT = 8;
/** Contract §2 — bare `@` shows "最多 5 个最近使用的 reference". */
export const RECENT_REFERENCE_LIMIT = 5;

/**
 * One selectable row. `type` + `id` together are the typed ID the picker submits (contract §4);
 * `thumbUrl` is a display URL resolved by the server, never something the client may send back.
 */
export interface ReferenceResult {
  type: ReferenceType;
  id: string;
  name: string;
  /** The one-line disambiguation under the name (contract §3), e.g. `Product · Otto IQ`. */
  source: string;
  thumbUrl: string | null;
}

/**
 * A reference the merchant already sent, resolved back to the object it names (FRONT-A10
 * "可回链"). Same identity as `ReferenceResult` plus the address that shows the object; the server
 * builds `href` from its own read of the row, so a message can never link somewhere the merchant
 * is not allowed to go.
 */
export interface ReferenceLink {
  type: ReferenceType;
  id: string;
  name: string;
  source: string;
  href: string;
}

export interface ReferenceSearchPage {
  items: ReferenceResult[];
  /** Opaque; pass back verbatim to continue. `null` = this was the last page. */
  nextCursor: string | null;
}

const TYPE_LABELS: Record<ReferenceType, string> = {
  product: "Product",
  character: "Character",
  "official-avatar": "Official avatar",
  location: "Location",
  clothes: "Clothes",
  generation: "Generation",
  upload: "Upload",
  brandmark: "Brand mark",
};

export function referenceTypeLabel(type: ReferenceType): string {
  return TYPE_LABELS[type];
}

/**
 * The disambiguation line. `detail` is the object's own source when it has one (the canvas a
 * generation came from); otherwise the canonical owner named by contract §4. Official avatars say
 * `Read only` because that is the fact a merchant needs before picking one (contract §7).
 */
export function referenceSourceLine(type: ReferenceType, detail?: string | null): string {
  if (type === "official-avatar") return "Official avatar · Read only";
  if (type === "product") return "Product · Otto IQ";
  const trimmed = detail?.trim();
  return `${TYPE_LABELS[type]} · ${trimmed || "Library"}`;
}

/**
 * How well `name` answers `query`. Lower is better; `null` means "not a match at all".
 *
 * Contract §2 orders by "名称匹配、最近使用与当前 Canvas 相关性". This covers the first term; the
 * caller breaks ties with recency. Canvas relevance has no production signal yet and is registered
 * rather than guessed at.
 */
export function referenceMatchRank(name: string, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  const at = n.indexOf(q);
  if (at < 0) return null;
  // a match that begins a word reads as intentional; one inside a word is a weak last resort
  return /[\s\-_/]/.test(n[at - 1] ?? "") ? 2 : 3;
}

/** Contract §2/§6 — one underlying object appears once, however many ways it was found. */
export function dedupeReferenceResults<T extends ReferenceResult>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
