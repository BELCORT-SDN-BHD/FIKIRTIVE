import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

/**
 * Schedule 前缀底下**没有路由文件**的那些地址 —— 回 Home(R3-F11,与 `app/schedule/page.tsx`
 * 同一个去处、同一条权威表行)。
 *
 * 静态段优先于 catch-all,所以这一页接不到同一棵树下的两条真路由:
 * `/schedule/analytics`(它自己进 Home analysis)与 `/schedule/share-preview`(免登录的公开
 * 分享页,B0-28)。这也是为什么收口写成一条 catch-all **页**,而不是一层 layout ——
 * `app/schedule/share-preview/page.tsx` 的文件头逐字写着「DO NOT add an app/schedule/layout.tsx
 * that gates its children」:layout 会把那扇公开的门一起吃掉。
 */
export default async function ParkedScheduleSubpath() {
  redirect(SHELL_ROUTES.home);
}
