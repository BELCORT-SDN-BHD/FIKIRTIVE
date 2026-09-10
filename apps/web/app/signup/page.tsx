import { permanentRedirect } from "next/navigation";

/**
 * SIGNIN-A4 —— 注册页退役（docs/specs/sign-in.md §1「九问」第 2 问与 §2 验收表 A4）。
 *
 * 登录照 Linear：只有 `/login` 一扇门，陌生人和老用户走同一条路，第一次来就开好账号。所以
 * 这里不再有第二个「注册」页；旧链接（邮件、书签、外部站点）不能断，所以是 308 永久转向而
 * 不是删掉路由 —— 删掉会让旧链接落到 404，商家读到的是「这个产品没了」。
 *
 * 目的地故意不带过来：`?from=` 是登录墙塞进来的站内相对路径，`/login` 自己会从登录墙那一次
 * 转向里重新拿到它（apps/web/proxy.ts）。在这里转发一个未经这一页校验的查询串，等于给一个
 * 已经退役的地址留一条参数通道。
 */
export const dynamic = "force-dynamic";

export default function RetiredSignupPage(): never {
  permanentRedirect("/login");
}
