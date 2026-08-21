/**
 * panel-surface.ts — 哪些面挂这块面板。一个纯函数,好让「不许两个 Otto 同屏」变成断言。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.2 末段;票 #994(W2-7)挂载项。
 *
 * 默认是**挂**:Otto 的自我介绍就是「beside you on every page」
 * (`packages/core/src/navigation.ts` 的 `OTTO_ASSISTANT.does`)。这里只列一个例外,
 * 「这一面自己已经有一个 Otto」:
 *
 *   画布 —— 页面自带真输入框。今天那颗 `fixed right-4 bottom-4` 的 Otto 按钮就是因为
 *   这个原因在画布上不画(`immersive-shell.tsx` 的 `hideOttoButton`,#609);
 *   按钮换成 launcher,这条理由一个字都没变。
 *
 * W2-11(切换总票):`/otto` 那条例外撤了。旧的整屏 Otto 壳(`OttoApp`/`OttoNav`/`OttoView`)
 * 不再被任何路由渲染 ——`/otto` 缩成了一张纯重定向表(`apps/web/app/otto/page.tsx`),
 * 从不出现在浏览器里,`ottoPanelMountsOn("/otto")` 结果因此不再重要:面板挂不挂在一条
 * 永远重定向掉的地址上,商家永远看不见。
 */
import { CANVAS_HREF } from "@fikirtive/core/navigation";

/** 这一面自己已经有一个 Otto,面板不再来第二个。 */
const SURFACES_WITH_THEIR_OWN_OTTO: readonly string[] = [CANVAS_HREF];

/** 传进来的可能带 query(`MerchantShellContent` 拿到的就是 path+query),只看路径那一段。 */
function pathOf(location: string): string {
  return location.split("?")[0] ?? "";
}

/**
 * 这一面该不该挂 Otto 面板。
 *
 * `startsWith(path + "/")` 而不是纯相等:`/otto` 与它底下的任何一条子路由是同一块壳。
 */
export function ottoPanelMountsOn(location: string): boolean {
  const path = pathOf(location);
  return !SURFACES_WITH_THEIR_OWN_OTTO.some(
    (own) => path === own || path.startsWith(`${own}/`),
  );
}
