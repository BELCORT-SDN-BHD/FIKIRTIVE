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
 * 高亮唯一是一条行为纪律,不是一句形容词:`/library/editor` 只亮 Library,
 * `/settings/connections` 只亮 Connections(而不是连 Preferences 一起亮)。做法是**最长匹配
 * 者独赢** —— 先算出赢家的 href,再逐格问「你是不是那一个」,所以「两格同时亮」在结构上就
 * 不可能发生,而不是靠每一格自己小心。
 *
 * 与 `global-navigation.tsx` 里那份同名匹配逻辑的关系:那份是旧壳的,W2-11 连旧壳一起删。
 * 这一票**一个字都不动它**(Stack 纪律:旧壳零行为变化),所以两份短暂并存;它们不是一份
 * 权威的两个抄本 —— 权威是 `MERCHANT_NAV`,这两份都只是读它的渲染层。
 */

import {
  MERCHANT_NAV,
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
 * 为什么按长度:`/settings/connections` 与 `/settings` 都匹配 `/settings/connections`,
 * 商家心里在 Connections 上,不是在 Preferences 上。长度是「谁更具体」的机器判定。
 */
export function activeNavHref(
  pathname: string,
  links: readonly MerchantNavLink[] = merchantNavLinks(),
): string | null {
  const matches = links.filter((link) => navMatchesLocation(pathname, link.href));
  if (matches.length === 0) return null;
  return matches.reduce((longest, link) => (link.href.length > longest.href.length ? link : longest)).href;
}

/** 赢家的 key。Otto 要说「你现在在哪」时读的是这个,不是壳里的一个 class。 */
export function activeNavKey(
  pathname: string,
  links: readonly MerchantNavLink[] = merchantNavLinks(),
): string | null {
  const href = activeNavHref(pathname, links);
  return href === null ? null : (links.find((link) => link.href === href)?.key ?? null);
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

/** 一个分组亮不亮 = 它名下有没有那个赢家。 */
export function isGroupActive(group: MerchantNavGroup, pathname: string): boolean {
  const winner = activeNavHref(pathname);
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
