/**
 * 同源下载链接 —— 2026-09-04 走查 P0-2「下载不下载、反而把人踢出应用」。
 *
 * `<a href="/files/…" download>` 在生产环境根本不下载。`/files/` 在 r2 模式下 302 到 R2 的
 * 预签名地址,而 HTML 规范只让**同源**的 `download` 属性生效 —— 跨源一律忽略。于是商家按
 * 「Download」不是把片子存下来,而是整个人被导航出应用,落在一个陌生域名的裸 mp4 上:片子
 * 没存下,应用也回不去。
 *
 * 出路只有一条:让下载走**同源**。`/files/<key>?download=1&name=<人话文件名>` 由我们自己的
 * 路由把字节流回去并带 `Content-Disposition: attachment`,浏览器再没有机会导航走,R2 的地址
 * 也不再落到浏览器手里。
 *
 * 文件名的单一来源是 `canvas-selection.ts` 的 `canvasDownloadFileName`(画布与资产详情共用
 * 同一个函数);这里只负责把它安全地送进 URL,以及在服务端把送回来的那一串洗干净 —— 洗过
 * 之后既塞不进换行或引号(响应头注入),也塞不进路径分隔符。
 */

/** `?download=1` —— 只有这个值算数,别的一律当没写(默认仍是内联播放那条老路)。 */
export const DOWNLOAD_FLAG = "download";
/** `&name=…` —— 商家看到的那个文件名。 */
export const DOWNLOAD_NAME = "name";

const UNSAFE = /[^A-Za-z0-9._-]+/gu;

/**
 * 把任意一串洗成一个能安全写进 `Content-Disposition` 的文件名。
 * 只留 `A-Za-z0-9._-`;去掉开头的点(隐藏文件/路径把戏)与结尾的连字符;截到 80 字。
 * 洗空了就用 `fallback`。
 */
export function safeDownloadFileName(raw: string | null | undefined, fallback: string): string {
  const cleaned = (raw ?? "")
    .replace(UNSAFE, "-")
    .replace(/^[-.]+/u, "")
    .slice(0, 80)
    .replace(/-+$/u, "");
  return cleaned || fallback;
}

/**
 * 把一条 app-relative 的 `/files/…` 地址改写成同源附件下载地址。
 * 不是我们自己的 `/files/` 地址(blob:、data:、外链)原样返回 —— 那些本来就同源或另有归属,
 * 不该被这里悄悄改写。
 */
export function sameOriginDownloadUrl(url: string, fileName?: string | null): string {
  if (!url.startsWith("/files/")) return url;
  // base 只为解析,永不出现在返回值里(返回的仍是 app-relative 路径)。
  const parsed = new URL(url, "http://files.invalid");
  parsed.searchParams.set(DOWNLOAD_FLAG, "1");
  const safe = safeDownloadFileName(fileName, "");
  if (safe) parsed.searchParams.set(DOWNLOAD_NAME, safe);
  return `${parsed.pathname}${parsed.search}`;
}
