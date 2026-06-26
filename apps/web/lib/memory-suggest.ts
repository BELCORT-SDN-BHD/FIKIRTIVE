/**
 * Pure client-side heuristics for the manual memory add form.
 * No LLM, no server calls.
 */

const VOICE_RE = /\b(tone|voice|sound|speak|style|writing|copy|personality)\b/i;
const AUDIENCE_RE = /\b(customer|audience|client|user|who|for|demographic|buyer|person|people)\b/i;
const RULES_RE = /\b(never|always|don't|dont|must|avoid|forbidden|rule|guideline|policy)\b/i;
const PRODUCTS_RE = /\b(\$|price|cost|product|sku|item|sell|service|offer|collection|shop)\b/i;

/**
 * Suggests a category based on keyword heuristics.
 * Returns null to indicate "Brand" (the default) so callers can skip showing
 * a suggestion when the draft matches the already-selected default.
 */
export function suggestCategory(text: string): string | null {
  if (!text.trim()) return null;
  if (RULES_RE.test(text)) return "Rules";
  if (PRODUCTS_RE.test(text)) return "Products";
  if (AUDIENCE_RE.test(text)) return "Audience";
  if (VOICE_RE.test(text)) return "Voice";
  return null; // → Brand (default)
}

/**
 * Returns true if `text` is a near-duplicate of any entry in `existing`.
 * "Near-dup" = the normalised text is an exact match or a substring of
 * an existing memory (or vice-versa). Case-insensitive, whitespace-collapsed.
 */
export function isNearDup(text: string, existing: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const needle = norm(text);
  if (!needle) return false;
  return existing.some((e) => {
    const hay = norm(e);
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
}
