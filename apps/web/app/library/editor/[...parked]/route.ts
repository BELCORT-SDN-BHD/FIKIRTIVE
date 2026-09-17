import { parkedSubpathRedirect } from "@/lib/parked-route-redirect";

/**
 * 手工剪辑器停放之后,它前缀底下**其余**每一条旧地址 —— 和 `app/library/editor/route.ts`
 * 一样回 Create,一条真的 307(R3-F11)。
 *
 * 这个前缀底下从来只有 `page.tsx` 一个文件(R3-F10 把它换成了 `route.ts`),所以
 * `/library/editor/<任何一段>` 此前直开撞的是 Next 自带的裸 404 —— 没有导轨、没有一条回去
 * 的路。去处与权威表 `MERCHANT_NAV_REDIRECTS` 里 `/library/editor` 那一行逐字同一个。
 *
 * 这条前缀上「必须是 Route Handler」最硬:头上的 `app/library/loading.tsx` 是 `/library` 与
 * `/library/[id]` 两张**真页面**要的骨架,挪不走也删不得;只要它在,这个 segment 里的
 * `redirect()` 就只答得出 200 + 一屏骨架(实测全文在 `lib/parked-route-redirect.ts`)。
 */
export function GET(request: Request) {
  return parkedSubpathRedirect(new URL(request.url).pathname);
}
