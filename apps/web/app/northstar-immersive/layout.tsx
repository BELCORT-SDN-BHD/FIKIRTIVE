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
 * 本路由组零后台:no server actions / no db / no auth
 * (scripts/check-northstar-imports.sh 看守 app/northstar 与 components/northstar)。
 */

export const metadata = { title: "FIKIRTIVE" };

export default function NorthstarImmersiveLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env.NORTHSTAR_PREVIEW !== "1") {
    notFound();
  }
  return <ImmersiveShell>{children}</ImmersiveShell>;
}
