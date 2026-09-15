import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

/**
 * Campaigns 前缀底下**没有路由文件**的那些地址 —— 回 Home(R3-F11)。
 *
 * `app/campaign/layout.tsx` 只管得到**匹配得上**的子路由:`/campaign/<一段>` 会被
 * `app/campaign/[id]/page.tsx` 认成一个 campaign id、于是吃到那条 layout 重定向,而
 * `/campaign/<一段>/<一段>` 谁都不认,落进的是 Next 自带的裸 404(layout 不为一条没匹配上的
 * 路由渲染)。这一页接的正是那一批。
 *
 * 去处与权威表 `MERCHANT_NAV_REDIRECTS` 里 `/campaign` 那一行逐字同一个(`route-redirects.test.ts`
 * 逐条核)。它和 `app/campaign/calendar/page.tsx` 一样,实际跑到的是上面那条 layout ——
 * 但「表说的」与「文件做的」要是同一句话。
 */
export default async function ParkedCampaignSubpath() {
  redirect(SHELL_ROUTES.home);
}
