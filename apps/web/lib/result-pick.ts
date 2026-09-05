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

/**
 * 存储被禁的浏览器上 `getItem` 自己就抛(隐私设置关掉站点存储、无痕配额为零、第三方
 * iframe)。这一格只是个方便,抛了就当「没挑过」——素材面板绝不能因为存储不给用就打不开。
 */
export function readPick(id: string): number | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key(id));
  } catch {
    return null;
  }
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function writePick(id: string, idx: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(id), String(idx));
  } catch {
    // 记不住比炸掉好:这一次选中的那张照常显示,只是刷新后回到第一张。
  }
}
