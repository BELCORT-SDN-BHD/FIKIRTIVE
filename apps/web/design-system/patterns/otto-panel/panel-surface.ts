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
import { CANVAS_HREF, CREATE_NAV_HREF } from "@fikirtive/core/navigation";

/** 这一面自己已经有一个 Otto,面板不再来第二个。 */
const SURFACES_WITH_THEIR_OWN_OTTO: readonly string[] = [
  /** 创作前厅 —— 页面正中就是「Create with Otto」那只输入框。
   *
   *  2026-09-04 走查 P1-8:在**清空浏览器存储**的全新会话里打开 `/create`,面板自己弹开,
   *  于是屏幕上并排两个 Otto 入口 —— 一个是这一面自己的创作输入框,另一个是面板,而且面板
   *  里装着上一场关于标签文案的旧对话。两个入口一个页面,商家不知道该对哪一个说话。
   *
   *  判据与画布那条**一模一样**:「这一面自己已经有一个 Otto」。这不动面板的默认开合
   *  (Founder 2026-08-18 Q3-A「首开默认开」原样有效),只是把它从这两面挪开。
   *  `/create/canvas` 前缀落在这一条里,下面那一条仍然单列 —— 它的理由不同(画板自带
   *  始终可见的 Otto 卡),而 `some()` 对重叠无所谓。 */
  CREATE_NAV_HREF,
  CANVAS_HREF,
];

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
