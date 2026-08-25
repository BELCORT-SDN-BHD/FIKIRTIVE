import { ImmersiveShell } from "@/components/northstar/immersive/immersive-shell";
// 双声部 scoped token 层(Wave C · C-D · f1-tokens):蓝人手声部 + 手感工具类,只作用于
// `.gb.ns-immersive` 根容器,全局 token 值不动、live 产品不受影响。见 design-rules §2 修正案。
import "./immersive-tokens.css";

/**
 * Create 外壳路由组 —— 一个真能上手开的产品外壳,不是页面画廊。
 *
 * #606(D7 · T7):预览开关与它守着的 mock 页一起删掉了。这个路由组现在只剩两条**真**
 * 路由(Create 与 Canvas),在生产上正式对客;把人挡在外面的只有登录 —— 登录墙
 * (apps/web/proxy.ts)一道,受控入口自己的 requireOwner() 一道,双保险。
 *
 * W2-5:目录从 `app/northstar-immersive/` 改名成 `app/create/` —— `northstar-immersive`
 * 是内部代号,不该出现在商家的地址栏里。旧地址一条都不 404(见 `app/northstar-immersive/`
 * 那三条重定向)。
 *
 * 外壳的身份栏与沉浸式 Canvas 的真实 runtime 只能通过 fenced tree 外的受控 adapter
 * (components/canvas/*Entry)进入；路由与 northstar 组件不得直接 import server actions /
 * db / auth。
 *
 * #609:外壳入口要读认证会话(身份栏 = 真登录用户),所以这一段整体动态渲染。
 */

export const metadata = { title: "Create · Fikirtive" };
export const dynamic = "force-dynamic";

export default function CreateLayout({ children }: { children: React.ReactNode }) {
  // `/create` 与 `/create/canvas` 的受控 Entry 各自执行真正的 server principal gate。
  // Layout 只持视觉 pane,这样非 production 的显式 R22 parity fixture 可以在正式 route
  // 上渲染,而 production 请求仍会在 Entry 内 fail closed。
  return <ImmersiveShell>{children}</ImmersiveShell>;
}
