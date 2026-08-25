import { R22SettingsEntry } from "@/components/settings/R22SettingsEntry";

/**
 * Preferences —— 换壳(Wave 2)的 W2-4,规格书 `docs/specs/wave2-shell.md` §4.7。
 *
 * 这一票在这一面只做**搬家**:今天商家要改花费上限或看自己的 credits,得先落在 `/otto`
 * 这个板块里、再从第二条导轨点进「Account」,地址栏一路写着 `/otto?view=account` ——
 * 那是 Otto 的地址,不是商家的。这里把同一份内容摆成它自己的一扇门 `/settings`,
 * 组件一行没搬:背后仍是 `OttoAccount` → `buildSettingsSections` → `SettingsPage`,
 * 零 schema 改动、零迁移、零钱路改动。
 *
 * **数据只从服务端身份来**:`requireOwner()` 是这一页唯一的入口闸,`getMyAccount()` 自己
 * 再核一次同一个 session —— 页面不接、也不转发任何客户端传来的 ownerId。
 *
 * **Stack A 纪律**(规格书 §6.3):这一票只**新增**路由。`packages/core` 的导航权威一个字
 * 不动(`MERCHANT_NAV` 里 Preferences 那格今天还指着 `/otto?view=account`),所以只有直接
 * 输地址才到得了这里,旧壳行为零变化。导航指过来 + 旧地址 307 是切换总票 W2-11 的事。
 *
 * **通知**:这一面早就不渲染任何通知开关(#791-2 把那一段删了,产品里没有邮件发送器也没有
 * 站内通道)。导航文案里那句 “Set your spend cap, notifications and posting defaults.”
 * 还留着一个 “notifications”,但它在导航权威文件里 —— 按 Stack A 归 W2-11 改,这一票不碰。
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Fikirtive" };

export default function SettingsRoutePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> } = { searchParams: Promise.resolve({}) }) {
  return <R22SettingsEntry searchParams={searchParams} />;
}
