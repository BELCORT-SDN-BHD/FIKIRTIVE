import "server-only";

import { redirect } from "next/navigation";
import { ImmersiveShell } from "@/components/northstar/immersive/immersive-shell";
import type { ShellIdentity } from "@/components/northstar/immersive/immersive-nav";
import { getMyProfileNames } from "@/lib/profile-names";

/**
 * 北极星外壳的受控入口(#609 · 2026-08-02 Founder 裁决「假身份栏换真登录用户」)。
 *
 * 位置在 fenced tree 之外(与 ImmersiveCanvasEntry 同一处受控 adapter),所以可以直接读
 * 认证会话;北极星路由与组件仍然一行后端都不 import。
 *
 * #606(D7 · T7):这里以前**不重定向** —— 未登录只把身份解析成 null,让导航显示 Sign in,
 * 因为当时 `/northstar-immersive/onboarding/login` 那页假登录本来就要能在未登录下打开。
 * 那一页已随本刀删除,预览开关也删了,这个路由组只剩两条真产品路由。所以未登录不再是一种
 * 可以继续渲染的形态:身份解析不出来就送去 `/login`,壳一个字节的内容都不交出去。
 */

/** 商家自己的名字优先;没设过就退回工作区名;都没有就用邮箱,绝不填样板名。 */
export function resolveShellIdentity(names: {
  displayName: string;
  workspaceName: string;
  email: string;
}): ShellIdentity {
  const name = names.displayName.trim() || names.workspaceName.trim() || names.email;
  return { name, email: names.email };
}

export async function NorthstarShellEntry({ children }: { children: React.ReactNode }) {
  const names = await getMyProfileNames();
  if ("error" in names) redirect("/login");
  const identity: ShellIdentity = resolveShellIdentity(names);

  return <ImmersiveShell identity={identity}>{children}</ImmersiveShell>;
}
