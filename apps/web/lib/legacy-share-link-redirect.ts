import type { NextConfig } from "next";
import { SHARE_PREVIEW_COOKIE_PATH } from "./share-preview-cookie";

/**
 * R3-F32 —— 旧式分享链接 `/schedule/share-preview?t=<token>` 的答法：一条**路由层**重定向，在
 * 任何外壳冲出去之前就答完。
 *
 * ── 修前发生了什么（2026-09-17 staging 只读核证）──────────────────────────────────────────
 * 它答 HTTP 200，约 25 KB：一段 `<meta id="__next-page-redirect" http-equiv="refresh"
 * content="1;url=/s/<token>">`，外加一屏已经冲出去的外壳（负载里带着 `href="/login"` 的
 * 「Go to sign in」）。顾客的地址栏上因此停着那个 token 约一秒，而且在一张自述「no sign-in, no
 * link back into the workspace」的页面（`app/schedule/share-preview/page.tsx:33`）上先闪了一下
 * 登录面的东西 —— 与规格 SHARE-A6「地址栏是不含 token 的干净地址」正相反。
 *
 * ── 为什么页面里那句 `redirect()` 兑现不了 ───────────────────────────────────────────────
 * 不是猜的，仓内 2026-09-15 已经在 `next build` + `next start` + `curl --max-redirs 0` 下逐条实测
 * 并写在 `lib/parked-route-redirect.ts` 里：这一段头上压着 `app/schedule/loading.tsx`（一个
 * Suspense 边界），Next 先把外壳当 200 冲出去，`redirect()` 就降级成一次客户端跳转。同一份实测
 * 给出的答法是「根本不要进渲染」—— 停放旧地址因此改成了 Route Handler。
 *
 * ── 为什么这一条不能也用 Route Handler ──────────────────────────────────────────────────
 * 因为 `/schedule/share-preview` 这个地址本身必须**还是那张页面**（同一路径不能既是 page.tsx 又是
 * route.ts）。所以这一条退到更外面一层：Next 的路由层重定向表。它比渲染更早，`loading.tsx` 摆在
 * 哪里都影响不到它，正文 0 字节。
 *
 * ── 为什么规则是个普通值，不写死在 next.config.ts 里 ────────────────────────────────────
 * `lib/security-headers.ts` 已经立过这条形状：写在配置文件里的规则是一个没人能核的承诺。这里同
 * 样把它做成一个纯值函数，`lib/__tests__/legacy-share-link-redirect.test.ts` 既核这个值，也把
 * `next.config.ts` 载进来核它真的接上了。
 *
 * ── 三件本机实测出来、如实写下来的事（`next dev`，2026-09-17）────────────────────────────
 * ① `value` 这条正则不是装饰。不带 `value` 的 `has` 会把 `query.t` **原样**塞进参数，重复的
 *    `?t=a&t=b` 于是是一个数组，path-to-regexp 编译 `/s/:t` 时当场抛 —— 实测 HTTP **500**（修前
 *    那条地址是一张干净的 unavailable 页）。带上 `value` 之后 `matchHas` 走的是
 *    `Array.isArray(value) ? value.slice(-1)[0].match(...)`（`next/dist/shared/lib/router/utils/
 *    prepare-destination.js`），取最后一个值，实测 307 → `/s/b`。顾客看到的结果与修前一样（那个
 *    token 验不过，仍是同一张 unavailable），只是地址栏这次也干净了。
 * ② 字符集只收**能安全地当一个路径段**的那些（base64url 的 `A-Za-z0-9_-`，外加 `.` 与 `~`），并且
 *    **首字符不许是点**。token 本身就是 `<base64url>.<base64url>`（`packages/token-crypto`），首
 *    字符必落在 base64url 字母表里，所以真链接全中；带 `/`、空格、`%` 的伪造值一律不匹配，落回页
 *    面里那句后备转发 —— 也就是修前的行为，不会被这条规则拼出一条畸形的 `Location`。
 *    首字符那一条是跨厂复审（2026-09-17，P3）加的：旧写法收纯点值，`?t=..`（以及 `?t=%2e%2e`，
 *    query 先被解码）会编译出 `Location: /s/..`。**不是开放重定向**（没有主机名、没有协议，浏览器
 *    按同源解析，重复斜杠也会被归一），而且页面那句后备转发同样早就送得出它
 *    （`encodeURIComponent("..") === ".."`）—— 但一条谁也不想要的相对上跳没有理由从这里出去。
 * ③ Next 会把源地址的查询串**透传**给去处：实测 `location: /s/<token>?t=<token>`。那不是新的泄漏
 *    面（token 本来就在这条地址的路径段里），而且 `/s/[token]` 压根不读 query，下一跳就是干净的
 *    `/schedule/share-preview`。地址栏最终干净，SHARE-A6 要的就是这一条。
 *
 * ── 一条必须写明、免得后来人误读的事：这条 307 不带安全响应头 ──────────────────────────
 * Next 16 的配置层重定向**绕过** `next.config.ts` 的 `headers()`（`resolve-routes.js` 这条路返回的
 * `resHeaders` 是 null，`router-server` 只在非 null 时才套那些头），所以
 * `lib/security-headers.ts` 的四条一条都不在这个响应上 —— 本机实测 2026-09-17：`/s/<token>` 的
 * 303 带着 CSP／X-Frame-Options／X-Content-Type-Options／Referrer-Policy，这条 307 一条都没有。
 * 没找到可利用的后果（307 默认不可缓存；正文不是文档，没有 Referer 可泄、没有框可嵌、没有 MIME
 * 可嗅），所以本票不改 —— 但别把「全站都有那四条头」当成这条路也有。
 */

/** 旧链接里携带 token 的那个查询键。它同时是 `destination` 里那个占位符的名字。 */
export const LEGACY_SHARE_LINK_QUERY = "t";

/**
 * 收哪些 `?t=` 值 —— 见上面 ①②。命名捕获组的名字必须与 `LEGACY_SHARE_LINK_QUERY` 一致，
 * `destination` 里那个 `:t` 取的就是这个组。
 */
export const LEGACY_SHARE_LINK_VALUE = `(?<${LEGACY_SHARE_LINK_QUERY}>[A-Za-z0-9_~-][A-Za-z0-9._~-]*)`;

type RedirectRule = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>[number];

/**
 * `next.config.ts` 的 `redirects()` 就是这张表。
 *
 * `permanent: false`（307）而不是 308：旧链接的形状不该被浏览器永久缓存住 —— 哪天这条兜底撤掉，
 * 一个缓存了 308 的浏览器会再也到不了那张页面。
 */
export function legacyShareLinkRedirects(): RedirectRule[] {
  return [
    {
      // 地址只有一份（`lib/share-preview-cookie.ts` 同时是那颗 cookie 的作用域），不在这里手打第二遍。
      source: SHARE_PREVIEW_COOKIE_PATH,
      // 只在带 `?t=` 时才拦；干净地址（cookie 那条路）照旧直接渲染那张页面。
      has: [{ type: "query", key: LEGACY_SHARE_LINK_QUERY, value: LEGACY_SHARE_LINK_VALUE }],
      destination: `/s/:${LEGACY_SHARE_LINK_QUERY}`,
      permanent: false,
    },
  ];
}
