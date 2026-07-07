import { notFound } from "next/navigation";
import { ImmersiveShell } from "@/components/northstar/immersive/immersive-shell";

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
