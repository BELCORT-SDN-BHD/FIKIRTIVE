import { permanentRedirect } from "next/navigation";

/** SIGNIN-A4 —— 重置密码页随密码退役（docs/specs/sign-in.md §2 验收表 A4）。旧链接转到
 *  唯一的门 `/login`；理由与 `app/signup/page.tsx` 同一条。 */
export const dynamic = "force-dynamic";

export default function RetiredResetPasswordPage(): never {
  permanentRedirect("/login");
}
