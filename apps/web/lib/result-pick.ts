/**
 * result-pick.ts — persist the user's chosen variant index across reloads.
 *
 * Keyed by `otto:pick:<id>` in localStorage.
 * Guards `typeof window` so this is safe to import in SSR/test contexts.
 */

/**
 * 这一格记在哪里,由这个文件说了算,所以说给商家听的那句话也放在这里 —— 存法哪天升级成
 * 账号级(需要新的持久化列,另立规格),改的人在同一个文件里就看得见这句话必须跟着改。
 * 措辞不得暗示跨设备同步:今天它确实只在这台浏览器上。
 */
export const PICK_SCOPE_NOTE = "Variant choice is saved on this browser only.";

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
