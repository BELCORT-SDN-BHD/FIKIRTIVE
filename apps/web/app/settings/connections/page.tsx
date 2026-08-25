import { R22SettingsEntry } from "@/components/settings/R22SettingsEntry";

/**
 * Connections —— 换壳(Wave 2)的 W2-4,规格书 `docs/specs/wave2-shell.md` §4.7。
 *
 * 搬家:同一份 `OttoConnections` 从 `/otto?view=connections` 摆成它自己的一扇门
 * `/settings/connections`。零 schema 改动、零迁移;页面本身不取数,组件挂载后自己发
 * **一次** `getAccountViewData()`(#518 返工:整页只有一次 Meta 读)。
 *
 * 所以这一页的服务端职责只有一件:**关门**。`requireOwner()` 没过就回登录页,过了就把
 * 组件交出去 —— 组件的每一次读写都各自再核一次同一个 session,页面不接、也不转发任何
 * 客户端传来的 ownerId。
 *
 * **Stack A 纪律**(规格书 §6.3):只新增路由,导航权威一个字不动,`/otto?view=connections`
 * 照常开着。导航指过来 + 旧地址 307 是切换总票 W2-11 的事。
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Connections · Fikirtive" };

export default function ConnectionsRoutePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> } = { searchParams: Promise.resolve({}) }) {
  return <R22SettingsEntry searchParams={searchParams} defaultSection="connections" />;
}
