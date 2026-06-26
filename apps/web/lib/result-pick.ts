/**
 * result-pick.ts — persist the user's chosen variant index across reloads.
 *
 * Keyed by `otto:pick:<id>` in localStorage.
 * Guards `typeof window` so this is safe to import in SSR/test contexts.
 */

function key(id: string): string {
  return `otto:pick:${id}`;
}

export function readPick(id: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key(id));
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function writePick(id: string, idx: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key(id), String(idx));
}
