import { notFound } from "next/navigation";
import { NorthstarShell } from "@/components/northstar/_shell";

/**
 * 北极星原型路由组外壳(PROGRAM.md §二 方案 A)
 *
 * 门禁(仿 skin-preview 先例):prod 默认 404,对客不可见;
 * staging 第一级设 NORTHSTAR_PREVIEW=1 → founder 逐页点、逐页批;本地 dev 永远可见。
 * 本路由组零后台:no server actions / no db / no auth(scripts/check-northstar-imports.sh 看守)。
 */

export const metadata = { title: "北极星原型 · 设计稿" };

export default function NorthstarLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env.NORTHSTAR_PREVIEW !== "1") {
    notFound();
  }
  return <NorthstarShell>{children}</NorthstarShell>;
}
