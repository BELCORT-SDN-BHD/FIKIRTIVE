import { parkedSubpathRedirect } from "@/lib/parked-route-redirect";

/**
 * Campaigns 前缀底下**没有路由文件**的那些地址 —— 回 Home,一条真的 307(R3-F11)。
 *
 * `app/campaign/layout.tsx` 只管得到**匹配得上**的子路由:`/campaign/<一段>` 会被
 * `app/campaign/[id]/page.tsx` 认成一个 campaign id、于是吃到那条 layout 重定向,而
 * `/campaign/<一段>/<一段>` 谁都不认,落进的是 Next 自带的裸 404(layout 不为一条没匹配上的
 * 路由渲染)。这一条接的正是那一批。
 *
 * 写成 Route Handler 而不是 `page.tsx`:handler 不进渲染,layout 与 `campaign/loading.tsx`
 * 那层 Suspense 边界都影响不到它 —— 「这条地址答几」不再取决于文件摆在哪一层(R3-F10 的
 * 实测与变异记录全文在 `lib/parked-route-redirect.ts`)。去处与权威表 `MERCHANT_NAV_REDIRECTS`
 * 里 `/campaign` 那一行逐字同一个;`/campaign/calendar/<没建过的段>` 按最长匹配落到它自己
 * 那一行(今天两行同去处,都是 Home)。
 */
export function GET(request: Request) {
  return parkedSubpathRedirect(new URL(request.url).pathname);
}
