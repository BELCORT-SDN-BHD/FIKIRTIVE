import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { parkedRouteRedirect } from "@/lib/parked-route-redirect";

/**
 * `/schedule` —— 商家排期面在 Beta 停放,旧书签一律 307 回 Home(规格 `docs/specs/wave2-shell.md` §2.5)。
 *
 * 这里是 Route Handler 而不是 `page.tsx`,因为这一层有 `loading.tsx`(它今天真正的用户是
 * `/schedule/share-preview` —— 那是墙外的公开分享页,不能被这条重定向捕获,所以这条重定向也
 * 不能搬进 `layout.tsx`)。`page.tsx` + `redirect()` 在那层边界下面只答得出 HTTP 200 + 一屏骨架;
 * 理由与本机实测全文在 `lib/parked-route-redirect.ts`。
 */
export function GET() {
  return parkedRouteRedirect(SHELL_ROUTES.schedule);
}
