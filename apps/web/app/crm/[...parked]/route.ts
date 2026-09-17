import { parkedSubpathRedirect } from "@/lib/parked-route-redirect";

/**
 * CRM 前缀底下**其余**每一条地址 —— 和那十四条一样送回 Home,一条真的 307(R3-F11)。
 *
 * 那十四个路由文件各自把自己的地址送走(原委与恢复条件写在 `app/crm/page.tsx`),可是
 * `/crm/` 后面跟一段谁都没建过的路(书签被截断、外部链接多带一层、手打错一个字)落进的是
 * Next 自带的裸 404:没有导轨、没有账号菜单、没有一条回去的路 —— 壳在这个前缀上本来就不画
 * (`isMerchantSurface` 对每一条停放前缀答 false,`components/global-navigation.tsx`)。收起来的
 * 意思是「这扇门后面暂时没有东西」,不是「你走错了地方」。
 *
 * 规矩不是这一条发明的:规格书 `docs/specs/wave2-shell.md` §2.2 写的是「`/crm` 及其全部子路由
 * → `/`,全部 307 到 Home」,§2.5 写的是「每一条旧地址都 307,**永不 404**」;
 * `design-system/information-architecture/frontend-convergence-phase-1-spec.md` §4 与验收 7
 * 同一句话的另一种说法(Parked merchant surface 由 server-side destination 送到冻结 owner
 * surface,不显示 404)。
 *
 * 为什么是 Route Handler 而不是 `page.tsx`:R3-F10(PR #1460)证过一次 —— 只要这条地址头上
 * 压着一层 `loading.tsx`,`page.tsx` 里的 `redirect()` 就降级成 200 + 一屏骨架 + 客户端跳转。
 * `/crm` 今天头上没有那层边界,但兜底的这四扇门共用一种写法:一种机制、一处实测,下一个人往
 * `app/crm/` 放一张骨架时不会把这条承诺悄悄换回 200(全文在 `lib/parked-route-redirect.ts`)。
 *
 * 静态段优先于 catch-all,所以 `/crm` 与它那十四条子路由仍然各走各的文件,这里只接**没有
 * 文件**的那些。
 */
export function GET(request: Request) {
  return parkedSubpathRedirect(new URL(request.url).pathname);
}
