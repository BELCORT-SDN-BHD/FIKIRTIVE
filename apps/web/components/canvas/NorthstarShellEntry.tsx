import "server-only";

import { notFound } from "next/navigation";
import { ImmersiveShell } from "@/components/northstar/immersive/immersive-shell";
import type { ShellIdentity } from "@/components/northstar/immersive/immersive-nav";
import { getMyProfileNames } from "@/lib/profile-names";

/**
 * 北极星外壳的受控入口(#609 · 2026-08-02 Founder 裁决「假身份栏换真登录用户」)。
 *
 * 位置在 fenced tree 之外(与 ImmersiveCanvasEntry 同一处受控 adapter),所以可以直接读
 * 认证会话;北极星路由与组件仍然一行后端都不 import(scripts/check-northstar-imports.sh)。
 *
 * 未登录不是错误态:预览壳允许未登录浏览(#615 后壳内假登录页已退场,真登录在 /login)。
 * 所以这里**不重定向**,只把身份解析成 null,导航据此显示 Sign in —— 壳不冒充任何人。
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
  // Layouts and pages can be evaluated independently while streaming. Repeat the preview
  // gate here so a hidden production route cannot touch runtime data first.
  if (process.env.NODE_ENV === "production" && process.env.NORTHSTAR_PREVIEW !== "1") {
    notFound();
  }
  const names = await getMyProfileNames();
  const identity: ShellIdentity | null = "error" in names ? null : resolveShellIdentity(names);

  return <ImmersiveShell identity={identity}>{children}</ImmersiveShell>;
}
