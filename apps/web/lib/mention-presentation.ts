import type { EntityTypeDTO } from "@/lib/types";

/**
 * Presentation truth for the Otto `@` reference picker rows.
 *
 * Design authority: `design-system/information-architecture/reference-picker-contract.md` §3
 * (row anatomy: thumbnail or type icon, primary name, one disambiguation line, trailing type icon)
 * and §2 (at most ~8 rows, then scroll inside the menu). The approved fixture that renders that
 * contract is `design-system/patterns/reference-picker/ReferencePickerReference.tsx`.
 *
 * Drift note (not fixed here — outside this slice's write set): the same entity-type label map is
 * duplicated in `components/MentionInput.tsx` (ENTITY_TYPE_LABELS) and, in a tag flavour, in
 * `components/otto/stuff/StuffLibrary.tsx` (tagFor). This module is the intended single owner;
 * a follow-up should point those two at it.
 */

/** Contract §2: "最多显示约 8 行，之后在菜单内部滚动". */
export const MENTION_ROW_LIMIT = 8;

const MENTION_TYPE_LABELS: Record<EntityTypeDTO, string> = {
  CHARACTER: "Character",
  LOCATION: "Location",
  PRODUCT: "Product",
  BRANDMARK: "Brand mark",
};

export interface MentionRefImage {
  assetId: string;
  url: string;
  kind: "image" | "video" | "other";
}

/**
 * What the picker needs from a suggestion. Both production composers pass `EntityDTO` values, so
 * everything past `id` / `name` is optional: a caller that only knows the name still renders a
 * legal row (name only), never an invented type or source line.
 */
export interface MentionSuggestion {
  id: string;
  name: string;
  type?: EntityTypeDTO;
  baseAssetId?: string | null;
  refs?: readonly MentionRefImage[];
}

export function mentionTypeLabel(type: EntityTypeDTO): string {
  return MENTION_TYPE_LABELS[type];
}

/**
 * The one-line disambiguation under the name. Today every mentionable object in production is a
 * Library element, so the source half is `Library` for all four types; a type the picker cannot
 * name gets no line at all rather than a guess.
 */
export function mentionSourceLine(suggestion: MentionSuggestion): string | null {
  return suggestion.type ? `${mentionTypeLabel(suggestion.type)} · Library` : null;
}

/** The locked base image when there is one, else the first image ref. Videos are not thumbnails. */
export function mentionThumbnailUrl(suggestion: MentionSuggestion): string | null {
  const images = (suggestion.refs ?? []).filter((ref) => ref.kind === "image");
  const base = images.find((ref) => ref.assetId === suggestion.baseAssetId);
  return base?.url ?? images[0]?.url ?? null;
}
