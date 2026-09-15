import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

/**
 * 手工剪辑器停放之后,它前缀底下**其余**每一条旧地址 —— 和 `app/library/editor/page.tsx`
 * 一样回 Create(R3-F11)。
 *
 * 这个前缀底下从来只有 `page.tsx` 一个文件(git 全史核过:另一个只有它自己的 `loading.tsx`),
 * 所以 `/library/editor/<任何一段>` 今天直开撞的是 Next 自带的裸 404 —— 没有导轨、没有一条
 * 回去的路。去处与权威表 `MERCHANT_NAV_REDIRECTS` 里 `/library/editor` 那一行逐字同一个。
 */
export default async function ParkedEditorSubpath() {
  redirect(SHELL_ROUTES.create);
}
