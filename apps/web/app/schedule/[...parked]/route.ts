import { parkedSubpathRedirect } from "@/lib/parked-route-redirect";

/**
 * Schedule 前缀底下**没有路由文件**的那些地址 —— 一条真的 307(R3-F11)。
 *
 * 去处按**最长匹配**从权威表读,所以这一条不是「全部回 Home」:
 * `/schedule/<没建过的段>` 落到 `/schedule` 那一行(Home),而 `/schedule/analytics/<没建过的段>`
 * 落到 `/schedule/analytics` 那一行(`/analysis`)—— 商家要找的是表现分析,把他送去总览等于
 * 答错了门(理由全文在 `lib/parked-route-redirect.ts`)。
 *
 * 静态段优先于 catch-all,所以这一条接不到同一棵树下的两条真路由:`/schedule/analytics`
 * (它自己的 `route.ts`)与 `/schedule/share-preview`(免登录的公开分享页,B0-28)。这也是为什么
 * 收口写成一条 catch-all 而不是一层 layout —— `app/schedule/share-preview/page.tsx` 的文件头
 * 逐字写着「DO NOT add an app/schedule/layout.tsx that gates its children」:layout 会把那扇
 * 公开的门一起吃掉。
 */
export function GET(request: Request) {
  return parkedSubpathRedirect(new URL(request.url).pathname);
}
