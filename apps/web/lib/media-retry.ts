/**
 * media-retry.ts — pure helper to cache-bust a media URL on error retry.
 *
 * Appends `r=<attempt>` as a query parameter so the browser re-fetches the
 * asset rather than serving a cached 404/error. Safe to call with URLs that
 * already have query params.
 */
export function bustUrl(url: string, attempt: number): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}r=${attempt}`;
}
