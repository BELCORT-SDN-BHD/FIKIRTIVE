/**
 * TrendSnapshot.sources is stored as JSON. Both the Trend archive card and the campaign
 * detail panel label the same rows, so the shape check lives here once. Nothing is guessed:
 * an entry with neither a title nor a domain is dropped rather than labelled "Source".
 *
 * #713 — when a row carries both, both are shown. Hiding the domain behind the title meant a
 * conclusion could claim a source the merchant could never see, on a page whose whole promise
 * is that its conclusions are source-labelled.
 */
export function trendSourceLabels(sources: unknown): string[] {
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const value = entry as { title?: unknown; domain?: unknown };
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const domain = typeof value.domain === "string" ? value.domain.trim() : "";
    const label = [title, domain].filter(Boolean).join(" · ");
    return label ? [label] : [];
  });
}
