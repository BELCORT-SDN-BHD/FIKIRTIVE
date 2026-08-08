/**
 * TrendSnapshot.sources is stored as JSON. Both the Trend archive card and the campaign
 * detail panel label the same rows, so the shape check lives here once. Nothing is guessed:
 * an entry with neither a title nor a domain is dropped rather than labelled "Source".
 */
export function trendSourceLabels(sources: unknown): string[] {
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const value = entry as { title?: unknown; domain?: unknown };
    const label = typeof value.title === "string" && value.title.trim()
      ? value.title.trim()
      : typeof value.domain === "string" && value.domain.trim()
        ? value.domain.trim()
        : null;
    return label ? [label] : [];
  });
}
