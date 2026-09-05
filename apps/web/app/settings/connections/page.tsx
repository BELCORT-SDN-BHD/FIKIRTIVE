import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import OttoConnections from "@/components/otto/OttoConnections";
import { SettingsShell } from "@/components/settings/SettingsShell";

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

export default async function ConnectionsRoutePage() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  return (
    <SettingsShell
      active="connections"
      title="Connections"
      description="Connect the services Fikirtive uses across this workspace."
      scopeNote="Changes affect everyone in this workspace."
    >
      {/* 第⑦段只换外壳。连接列表本体住在 `components/otto/OttoConnections.tsx`(本段写集
          之外),所以这里只把它放进夹具的内容列几何:整宽、`py-8`。真实厂牌 logo
          (`public/integrations/*.svg` —— 夹具的 `ConnectionLogo` 用的就是这三个文件)
          要替掉那份 lucide 占位图标,只能在那个组件里改;已在 PR 描述里列为需要 Otto 段
          配合的一项。 */}
      <div className="w-full py-8">
        <OttoConnections embedded />
      </div>
    </SettingsShell>
  );
}
