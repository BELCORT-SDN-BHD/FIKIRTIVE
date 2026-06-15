/**
 * Per-entity-type reference knowledge: the single base prompt + the variant-chip
 * taxonomy, plus handle slugification. One place to add a future entity type.
 * Pure (no DB / React) so it is unit-tested and reusable by web + worker.
 */
export type RefEntityType = "CHARACTER" | "LOCATION" | "PRODUCT" | "BRAND";

export interface VariantChip {
  key: string;
  label: string;
  scaffold: string; // appended to the prompt when the chip is clicked
}

export interface RefTypeConfig {
  baseHint: string;
  /** the locked single base shot (not a multi-view sheet) */
  baseShot: (subject: string) => string;
  variantChips: VariantChip[];
}

export const REF_TYPE_CONFIG: Record<RefEntityType, RefTypeConfig> = {
  CHARACTER: {
    baseHint: "One clean full-body photo — the identity anchor every variant is generated from.",
    baseShot: (s) => `Full-body reference photo of ${s}, neutral expression, natural standing pose, plain studio background, soft even lighting, sharp focus`,
    variantChips: [
      { key: "outfit", label: "Outfit", scaffold: "wearing " },
      { key: "pose", label: "Pose", scaffold: "in a " },
      { key: "angle", label: "Angle", scaffold: "seen from " },
      { key: "expression", label: "Expression", scaffold: "with a " },
    ],
  },
  LOCATION: {
    baseHint: "One wide establishing shot — the canonical look of this place.",
    baseShot: (s) => `Wide establishing shot of ${s}, consistent architecture and materials, even natural lighting, sharp focus`,
    variantChips: [
      { key: "time", label: "Time of day", scaffold: "at " },
      { key: "angle", label: "Angle", scaffold: "from " },
      { key: "weather", label: "Weather", scaffold: "in " },
      { key: "season", label: "Season", scaffold: "during " },
    ],
  },
  PRODUCT: {
    baseHint: "One clean studio shot — the hero look of this product.",
    baseShot: (s) => `Clean studio product shot of ${s}, neutral seamless background, consistent materials and proportions, soft even lighting, sharp focus`,
    variantChips: [
      { key: "color", label: "Color", scaffold: "in " },
      { key: "angle", label: "Angle", scaffold: "from " },
      { key: "material", label: "Material", scaffold: "in " },
      { key: "packaging", label: "Packaging", scaffold: "with " },
    ],
  },
  BRAND: {
    baseHint: "One primary logo lockup — the canonical mark.",
    baseShot: (s) => `Primary logo lockup for ${s}, centered on a plain background, crisp edges, consistent visual identity`,
    variantChips: [
      { key: "light", label: "Light bg", scaffold: "on a light background" },
      { key: "dark", label: "Dark bg", scaffold: "on a dark background" },
      { key: "treatment", label: "Treatment", scaffold: "as a " },
      { key: "layout", label: "Layout", scaffold: "in a " },
    ],
  },
};

export function basePromptFor(
  type: RefEntityType,
  e: { name: string; notes: string; negativeConstraints: string },
): string {
  const subject = `${e.name}${e.notes ? `, ${e.notes}` : ""}`;
  return `${REF_TYPE_CONFIG[type].baseShot(subject)}${e.negativeConstraints ? `. Avoid: ${e.negativeConstraints}.` : "."}`;
}

/** Handle for @entity:handle — lowercase, non-alnum → "-", trimmed, ascii-only,
 *  with a stable fallback (collisions are resolved by the caller's -N loop). */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return s || "variant";
}
