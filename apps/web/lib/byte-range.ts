import type { ByteRange } from "@fikirtive/storage";

/**
 * SHARE-A1 —— 一个 `Range:` 请求头,解成存储层认识的闭区间。
 *
 * 三种回答,刻意互不重叠:
 *   · `ByteRange` —— 客户端要这一段,路由回 206 + `Content-Range`;
 *   · `"unsatisfiable"` —— 起点已经越过对象末尾,路由回 416。**不能**退化成 200 整条:
 *     那等于把「你要的那段不存在」答成「给你全部」,播放器会当成新的一整条从头放;
 *   · `null` —— 没带 Range,或形状我们不受理(多段、非 bytes 单位、垃圾)。RFC 9110 允许
 *     服务端忽略认不出来的 Range,照常回 200 整条 —— 这也正是今天的行为(SHARE-A2)。
 *
 * 我们**不做** multipart/byteranges:一条预览链接上的图和视频,浏览器与播放器要的都是单段。
 * 多段回 null 而不是报错,是让它退回到今天那条一定能工作的路上。
 */
export function parseByteRange(header: string | null | undefined, totalSize: number): ByteRange | "unsatisfiable" | null {
  const raw = (header ?? "").trim();
  if (!raw) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(raw);
  if (!match) return null;
  const [, first, last] = match as unknown as [string, string, string];
  if (first === "" && last === "") return null; // `bytes=-` names nothing

  if (first === "") {
    // Suffix form: the LAST `last` bytes. A suffix longer than the object is the whole object
    // (RFC 9110 §14.1.2), not a negative offset.
    const wanted = Number(last);
    if (totalSize === 0) return "unsatisfiable";
    // `bytes=-0` 要的是「最后 0 个字节」—— RFC 9110 §14.1.2 明说不可满足(416)。
    // 不在这里拦住,下面算出来的是 { start: totalSize, end: totalSize - 1 } 这种颠倒区间。
    if (wanted === 0) return "unsatisfiable";
    return { start: Math.max(0, totalSize - wanted), end: totalSize - 1 };
  }

  const start = Number(first);
  // An open-ended `bytes=N-` runs to the last byte; a closed one is clamped to it.
  const end = last === "" ? totalSize - 1 : Math.min(Number(last), totalSize - 1);
  if (start >= totalSize || start > end) return "unsatisfiable";
  return { start, end };
}
