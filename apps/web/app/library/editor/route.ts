import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { parkedRouteRedirect } from "@/lib/parked-route-redirect";

/**
 * `/library/editor` —— 手工剪辑台在 Beta 停放,旧书签 307 回 Create
 * (规格 `docs/specs/wave2-shell.md` §2.5;去处从 `MERCHANT_NAV_REDIRECTS` 那一行读)。
 *
 * 改成 Route Handler 的原因在这条路由上最硬:头上的 `app/library/loading.tsx` 是 `/library`
 * 与 `/library/[id]` 两张**真页面**要的骨架(已批准的 Library pattern 明写 loading 要保住
 * grid geometry),挪不走也删不得;而只要它在,这个 segment 里的 `redirect()` 就只答得出
 * HTTP 200 + 一屏骨架。Route Handler 不进渲染,边界摆在哪里都影响不到它。
 * 实测与变异记录全文在 `lib/parked-route-redirect.ts`。
 */
export function GET() {
  return parkedRouteRedirect(SHELL_ROUTES.edit);
}
