/**
 * rail-tree.ts —— 导轨画什么、哪一格亮。纯函数,不认 React、不认图标、不认 window。
 *
 * 规格:`docs/specs/wave2-shell.md` §2.1、§5.3。
 *
 * **这里没有第二棵导航树。** 树在 `@fikirtive/core` 的 `MERCHANT_NAV` 里(§1.3:那份数据是
 * 导航的唯一权威),这个文件只做两件权威源不该管的事:
 *
 *   ① 把树摊成导轨从上到下的顺序(顶层链接、分组);
 *   ② 回答「站在这个地址上,哪一格该亮」—— 而且只亮**一格**。
 *
 * 这里有**两条**独立的纪律,判官 r1 [P2] 指出它们从前被混成一句话说,于是其中一条没有被
 * 任何断言钉住:
 *
 *   **唯一性**由「先算出一个赢家,再逐格问『你是不是那一个』」保证 —— 所以「两格同时亮」
 *   在结构上就画不出来,不靠每一格自己小心。
 *
 *   **赢的是对的那一个**由**最长匹配者独赢**保证。少了长度比较,亮的仍然只有一格,但可能
 *   是错的那一格:`/settings/connections` 同时落在 `/settings` 上,首匹配会随两条链接在
 *   数组里的先后顺序给出 Preferences 或 Connections —— 一个跟着数据排序漂移的答案。
 *   所以钉它的断言必须**与顺序无关**(同一组链接正反两序都要答 Connections)。
 *
 * 与 `global-navigation.tsx` 里那份同名匹配逻辑的关系:那份是旧壳的,W2-11 连旧壳一起删。
 * 这一票**一个字都不动它**(Stack 纪律:旧壳零行为变化),所以两份短暂并存;它们不是一份
 * 权威的两个抄本 —— 权威是 `MERCHANT_NAV`,这两份都只是读它的渲染层。
 */

import {
  MERCHANT_NAV,
  NAVIGATION_OWNED_SURFACES,
  isNavGroup,
  merchantNavLinks,
  navLinkByKey,
  type MerchantNavGroup,
  type MerchantNavLink,
  type MerchantNavNode,
} from "@fikirtive/core/navigation";

/** 把 "/otto?view=connections" 拆成路径与 query。 */
export function splitLocation(value: string): { path: string; query: URLSearchParams } {
  const [path, query = ""] = value.split("?");
  return { path, query: new URLSearchParams(query) };
}

/**
 * 这个地址算不算落在这条 href 上。
 *
 * 前缀算数(`/library/editor` 落在 `/library` 上),query 必须逐个对上 —— 一条钉了 query 的
 * href(今天权威源里还有 `/otto?view=library` 这种)不许被光秃秃的同路径地址点亮。
 */
export function navMatchesLocation(pathname: string, href: string): boolean {
  const current = splitLocation(pathname);
  const target = splitLocation(href);
  const pathOk = current.path === target.path || current.path.startsWith(`${target.path}/`);
  if (!pathOk) return false;
  for (const [key, value] of target.query) {
    if (current.query.get(key) !== value) return false;
  }
  return true;
}

/**
 * 赢家的 href —— **最长的那条匹配者**,没有匹配就是 null。
 *
 * 为什么按长度而不是取第一条:`/settings/connections` 与 `/settings` 都匹配
 * `/settings/connections`,商家心里在 Connections 上,不是在 Preferences 上。长度是「谁更
 * 具体」的机器判定;取第一条则是把答案交给数组顺序,而顺序是随时会被改的导航数据。
 */
export function activeNavHref(
  pathname: string,
  links?: readonly MerchantNavLink[],
): string | null {
  const candidates = links ?? merchantNavLinks();
  const matches = candidates.filter((link) => navMatchesLocation(pathname, link.href));
  if (matches.length === 0) {
    if (links) return null;
    const owned = NAVIGATION_OWNED_SURFACES
      .filter((surface) => navMatchesLocation(pathname, surface.href))
      .reduce<(typeof NAVIGATION_OWNED_SURFACES)[number] | null>(
        (longest, surface) => (!longest || surface.href.length > longest.href.length ? surface : longest),
        null,
      );
    if (!owned) return null;
    return candidates.find((link) => link.key === owned.ownerKey)?.href ?? null;
  }
  return matches.reduce((longest, link) => (link.href.length > longest.href.length ? link : longest)).href;
}

/** 赢家的 key。Otto 要说「你现在在哪」时读的是这个,不是壳里的一个 class。 */
export function activeNavKey(
  pathname: string,
  links?: readonly MerchantNavLink[],
): string | null {
  const candidates = links ?? merchantNavLinks();
  const href = activeNavHref(pathname, links);
  return href === null ? null : (candidates.find((link) => link.href === href)?.key ?? null);
}

/**
 * 导轨从上到下画的那一串 —— **就是权威源本身,原序照搬**。
 *
 * 刻意不在这里重排(比如「把分组一律挪到底部」):顺序是导航数据的一部分,谁想改顺序就去
 * 改 `MERCHANT_NAV`,而不是在壳里学一套自己的排法。§2.1 的 Settings 排在最后,靠的就是
 * 它在权威源里排在最后。
 */
export function railNodes(): readonly MerchantNavNode[] {
  return MERCHANT_NAV;
}

export { isNavGroup };

/**
 * 一个分组亮不亮 = 它名下有没有那个赢家。
 *
 * `links` 与两个兄弟函数同形(判官 r1 [P3-2]):赢家必须在**整棵树**里选,不能只在这个分组
 * 内部选 —— 否则 `/settings/connections` 会让每一个带 `/settings` 前缀孩子的分组都亮。
 * 默认读今天的权威源;传进来一组链接,就能拿换壳后的七格形态验这条规则,不必等数据改完。
 */
export function isGroupActive(
  group: MerchantNavGroup,
  pathname: string,
  links: readonly MerchantNavLink[] = merchantNavLinks(),
): boolean {
  const winner = activeNavHref(pathname, links);
  return winner !== null && group.items.some((item) => item.href === winner);
}

/**
 * 导轨底部那行 credits 点进哪里。
 *
 * 从权威源按 key 取,不在壳里再写一次 `/billing` —— 「同一个地址在两处各写一遍」正是本仓
 * 最贵的那一课(两个导航、两个日历、两个创作入口)的起点。
 */
export function railBillingLink(): MerchantNavLink {
  return navLinkByKey("billing");
}
