import { notFound } from "next/navigation";
import { ImmersiveShell } from "@/components/northstar/immersive/immersive-shell";
// 双声部 scoped token 层(Wave C · C-D · f1-tokens):蓝人手声部 + 手感工具类,只作用于
// `.gb.ns-immersive` 根容器,全局 token 值不动、live 产品不受影响。见 design-rules §2 修正案。
import "./immersive-tokens.css";

/**
 * 北极星沉浸式外壳路由组 —— 一个真能上手开的产品外壳,不是页面画廊。
 *
 * 门禁(照抄 /northstar 先例):prod 默认 404,对客不可见;
 * staging 设 NORTHSTAR_PREVIEW=1 → founder 上手开;本地 dev 永远可见。
 * Gallery 与 northstar 组件树仍是纯前端。沉浸式 Canvas 的真实 runtime 例外
 * 只能通过 fenced tree 外的受控 adapter 进入；路由与 northstar 组件不得
 * 直接 import server actions / db / auth。scripts/check-northstar-imports.sh 继续看守。
 */

export const metadata = { title: "FIKIRTIVE" };

export default function NorthstarImmersiveLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env.NORTHSTAR_PREVIEW !== "1") {
    notFound();
  }
  return <ImmersiveShell>{children}</ImmersiveShell>;
}
