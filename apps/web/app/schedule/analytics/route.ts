import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { parkedRouteRedirect } from "@/lib/parked-route-redirect";

/**
 * `/schedule/analytics` —— 表现分析归 Home,旧地址 307 进 `/analysis`
 * (规格 `docs/specs/wave2-shell.md` §2.5;去处从 `MERCHANT_NAV_REDIRECTS` 那一行读)。
 *
 * 与 `/schedule` 同一个理由改成 Route Handler:父层 `app/schedule/loading.tsx` 的 Suspense
 * 边界会让 `page.tsx` 里的 `redirect()` 降级成 200 + 骨架。全文在 `lib/parked-route-redirect.ts`。
 */
export function GET() {
  return parkedRouteRedirect(SHELL_ROUTES.analytics);
}
