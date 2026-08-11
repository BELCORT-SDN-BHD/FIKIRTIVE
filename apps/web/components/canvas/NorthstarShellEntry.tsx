import "server-only";

import { redirect } from "next/navigation";
import { ImmersiveShell } from "@/components/northstar/immersive/immersive-shell";
import { requireOwner } from "@/lib/auth-guard";

/**
 * 创作旗舰面外壳的受控入口。
 *
 * 位置在 fenced tree 之外(与 ImmersiveCanvasEntry 同一处受控 adapter),所以可以直接读
 * 认证会话;创作路由与 northstar 组件仍然一行后端都不 import。
 *
 * #606(D7 · T7):这里以前**不重定向** —— 未登录只把身份解析成 null,让导航显示 Sign in,
 * 因为当时 `/northstar-immersive/onboarding/login` 那页假登录本来就要能在未登录下打开。
 * 那一页已随那一刀删除,预览开关也删了,这个路由组只剩两条真产品路由。所以未登录不再是一种
 * 可以继续渲染的形态:认不出人就送去 `/login`,壳一个字节的内容都不交出去。
 *
 * #801:身份栏随「六扇门」自有导航一起退场 —— 商家的名字、邮箱、余额与 Sign out 只在全局
 * 导轨里写一次。所以这里不再解析身份,只留那道**没放宽的**登录闸:守卫照旧先跑,认不出人
 * 照旧 redirect("/login")。
 */
export async function NorthstarShellEntry({ children }: { children: React.ReactNode }) {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  return <ImmersiveShell>{children}</ImmersiveShell>;
}
