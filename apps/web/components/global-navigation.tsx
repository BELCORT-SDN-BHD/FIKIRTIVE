"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  APPLICATION_SHELL_CARVE_OUTS,
  MERCHANT_NAV_REDIRECTS,
  NAVIGATION_OWNED_SURFACES,
  everyNavDestination,
  navLabel,
} from "@fikirtive/core/navigation";
import { NavigationRail, type RailAccount } from "@/components/navigation/rail/NavigationRail";
import { MerchantTopBar } from "@/components/navigation/MerchantTopBar";
import { navMatchesLocation, splitLocation } from "@/components/navigation/rail/rail-tree";
import { OttoPanelMount } from "@/components/otto/panel/OttoPanelMount";
import { useOttoPanelControls } from "@/components/otto/panel/OttoPanelShell";
import { getMyAccount } from "@/lib/account-actions";
import { createLatestReadGate, subscribeBalanceRefresh } from "@/lib/balance-refresh";

/**
 * #801 — 这个文件不再自己写一份导航树。树在 `@fikirtive/core` 的 `MERCHANT_NAV` 里,这里
 * 只负责商家壳的行为:哪些地址算商家表面、余额取数、把导轨与 Otto 面板接到一起。画法本身
 * 在 `components/navigation/rail/NavigationRail.tsx`(W2-10)。
 *
 * W2-11(切换总票,规格书 §5.1、§5.3):壳换成单层导轨(手动折叠 240px↔64px,存
 * localStorage),旧的三层响应式导轨 —— 1024 以下的 off-canvas 抽屉(`mobileOpen` /
 * backdrop / `translate-x-full`)、1024–1279 的图标层 + `SectionTabs` 横向页签兜底、
 * `<details>` 手搓的 `NavigationGroup` / `IdentityMenu` —— 随本票一并删除。旧壳制造的三份
 * 高亮规则、三份分组展开法、一份专管两个汉堡打架的测试,现在只有一份:
 * `components/navigation/rail/rail-tree.ts` 的 `activeNavHref`(最长匹配者独赢)。
 */

/** Every path prefix the merchant shell owns. Derived from the registry, so a new
 *  destination can never land on a page with no rail around it. `/profile` is a shell
 *  surface reachable from the identity menu rather than a nav destination of its own. */
const MERCHANT_SURFACE_PATHS: readonly string[] = [
  ...new Set([
    ...everyNavDestination().map((item) => splitLocation(item.href).path),
    ...NAVIGATION_OWNED_SURFACES.map((surface) => splitLocation(surface.href).path),
  ]),
];

/**
 * B0-28's seat-less share link (`app/schedule/share-preview/page.tsx`) — a carve-out out of
 * `/schedule`'s own subtree, not another shell surface.
 *
 * W2-11 wires `SHELL_ROUTES.schedule` (`/schedule`) into `MERCHANT_NAV` for real, which means
 * prefix matching alone would swallow `/schedule/share-preview` as a merchant surface for free —
 * drawing a nav rail, an identity menu, and a SIGN-OUT button around a post shown to a reader
 * who has no account and no session, on a page whose whole premise is that there is nothing
 * here to press (`lib/__tests__/share-preview-page.test.ts` planted this exact tripwire for
 * this day). It stays outside the wall for the same reason in `lib/auth-wall-ledger.ts`
 * (`schedule/share-preview`, `exact`) — the two ledgers answer different questions (who needs a
 * session vs. who gets the shell drawn around them) so they are not merged, but they agree here.
 */
export function isMerchantSurface(pathname: string): boolean {
  const path = splitLocation(pathname).path;
  const isAtOrBelow = (href: string) => {
    const base = splitLocation(href).path.replace(/\/$/, "");
    return path === base || path.startsWith(`${base}/`);
  };
  if (MERCHANT_NAV_REDIRECTS.some((route) => isAtOrBelow(route.from))) return false;
  if (
    APPLICATION_SHELL_CARVE_OUTS.some((href) => isAtOrBelow(href))
  ) return false;
  return MERCHANT_SURFACE_PATHS.some((href) => navMatchesLocation(pathname, href));
}

/**
 * FRONT-A14 —— 顶栏面包屑写不写出 child surface 那一层。
 *
 * `MerchantTopBar` 自己的默认答案是「亮着的那一格叫什么」,所以 `/analysis` 上它写的是
 * 「Workspace › Home」。已批准的设计要的是「Workspace › Home / Analysis」
 * (design-system/patterns/founder-home/HomeAnalysisReference.tsx 的夹具就是这么画的,
 * 它靠 `topBarLabel` 传进去)。生产从来没传过这个 prop —— 这就是那处差异。
 *
 * 补的是**接线**,不是设计源:字从导航权威源的 `breadcrumbLabel` 读
 * (`NAVIGATION_OWNED_SURFACES`),壳里一个地名都不手打。没有 `breadcrumbLabel` 的
 * child surface(`/billing`、`/profile`、`/settings/connections`)返回 undefined,
 * 面包屑照旧只写 owner 那格的名字 —— 已批准的 Settings pattern 要的就是这样。
 *
 * 最长匹配者独赢,与 `activeNavHref` 同一条规则:child surface 的地址天然比 owner 的长。
 */
export function shellTopBarLabel(pathname: string): string | undefined {
  const surface = NAVIGATION_OWNED_SURFACES
    .filter((item) => item.breadcrumbLabel && navMatchesLocation(pathname, item.href))
    .reduce<(typeof NAVIGATION_OWNED_SURFACES)[number] | null>(
      (longest, item) => (!longest || item.href.length > longest.href.length ? item : longest),
      null,
    );
  return surface ? `${navLabel(surface.ownerKey)} / ${surface.breadcrumbLabel}` : undefined;
}

/**
 * Utility bar 里的 Ask Otto 必须挂在 `OttoPanelMount` 之内才够得着
 * `useOttoPanelControls()`(那个 context 由 `OttoPanelShell` 往下发,只喂给它的后代)。
 *
 * 面板没有挂在这一面时(见 `panel-surface.ts` 的「这一面自己已经有一个 Otto」名单,今天
 * 是画布与 `/create`)`controls` 是 `null` —— 这不是一个错误,是「这一面自己已经有一个
 * Otto」的意思本身,所以 `onAskOtto` 传 `undefined`,`MerchantTopBar` 就不画这颗按钮
 * (判官 P1-A:此前传的是 `() => controls?.togglePanel()`,按钮仍然画出来,按下去却是一次
 * 空动作 —— 一颗建了没用的死按钮)。
 *
 * 余额从父层(`MerchantShellContent`)当 prop 收下来,不在这里自己取:画布与非画布之间
 * 那次 `OttoPanelMount` 内部形状切换(fragment ↔ `OttoPanelShell`)会让这一层重挂,状态
 * 留在父层就不会跟着闪一下。
 */
export function MerchantShellFrame({
  children,
  pathname,
  signOutAction,
  account,
  navigationHrefOverrides,
  visibleTopLevelNavigationKeys,
  flattenedNavigationGroupKeys,
  topBarLabel,
  profileHref,
  creditsHref,
  showSignOutAction,
}: {
  children: React.ReactNode;
  pathname: string;
  signOutAction: () => Promise<void>;
  account: RailAccount | null;
  navigationHrefOverrides?: Readonly<Record<string, string>>;
  visibleTopLevelNavigationKeys?: readonly string[];
  flattenedNavigationGroupKeys?: readonly string[];
  topBarLabel?: string;
  profileHref?: string;
  creditsHref?: string;
  showSignOutAction?: boolean;
}) {
  const controls = useOttoPanelControls();

  return (
    <div data-merchant-shell-frame className="flex h-dvh min-w-0 overflow-hidden bg-background text-foreground">
      <NavigationRail
        pathname={pathname}
        account={account}
        hrefOverrides={navigationHrefOverrides}
        visibleTopLevelKeys={visibleTopLevelNavigationKeys}
        flattenedGroupKeys={flattenedNavigationGroupKeys}
        creditsHref={creditsHref}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MerchantTopBar
          pathname={pathname}
          account={account}
          signOutAction={signOutAction}
          onAskOtto={controls ? () => controls.togglePanel() : undefined}
          activeLabelOverride={topBarLabel}
          profileHref={profileHref}
          showSignOutAction={showSignOutAction}
        />
        <div data-merchant-shell-content className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

export function MerchantShellContent({
  children,
  pathname,
  signOutAction,
}: {
  children?: React.ReactNode;
  pathname: string;
  signOutAction: () => Promise<void>;
}) {
  const merchantSurface = isMerchantSurface(pathname);
  const [account, setAccount] = useState<RailAccount | null>(null);

  // 导轨持着全产品唯一的余额数字,所以它要在每次结算后重读,不只是挂载时读一次(#550:
  // 曾经卡在挂载值上,直到整页刷新才追上数据库,滞后 84 秒以上)。订阅花费信号而不是轮询,
  // 让数字在一次点击之内追上真相;每条响应都先过「最新一次读」闸,慢的早读不许盖掉后来的。
  //
  // 回到标签页也重读。每一处客户端花费都会宣告(`lib/__tests__/spend-visibility-seams.
  // test.ts` 零豁免地枚举这一点),所以这不是在给没接上的表面兜底 —— 它逮的是标签页在
  // 后台时 worker 结算掉的那笔钱,那里没有一次点击可以挂宣告。
  //
  // 只在商家表面才取:没有商家的面(/login、/admin……)一条查询都不该发
  // (`otto-panel-mount.test.ts`「没有商家的面,一点 Otto 都不挂」钉的是同一条纪律)。
  useEffect(() => {
    if (!merchantSurface) return;
    let alive = true;
    const beginRead = createLatestReadGate();
    const load = () => {
      const isLatest = beginRead();
      getMyAccount().then((result) => {
        if (!alive || !isLatest() || "error" in result) return;
        setAccount({ email: result.email, displayName: result.displayName, balance: result.balance });
      }).catch(() => {});
    };
    const loadIfVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    const unsubscribe = subscribeBalanceRefresh(load);
    document.addEventListener("visibilitychange", loadIfVisible);
    return () => {
      alive = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", loadIfVisible);
    };
  }, [merchantSurface]);

  if (!merchantSurface) return <>{children}</>;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* #994(W2-7)/W2-11 —— 面板停在内容列右侧。导轨、主内容、面板是同一行里的兄弟:
          导轨宽度不随面板开合而变,主内容让给面板;没有遮罩,没有 `pointer-events: none`
          (spec §3.5 ①)。导轨必须挂在 `OttoPanelMount` 内部(而不是它旁边),才能读到
          面板的开合状态机去驱动 utility bar 的 Ask Otto 按钮。 */}
      <OttoPanelMount location={pathname}>
        <MerchantShellFrame
          pathname={pathname}
          signOutAction={signOutAction}
          account={account}
          topBarLabel={shellTopBarLabel(pathname)}
        >
          {children}
        </MerchantShellFrame>
      </OttoPanelMount>
    </div>
  );
}

export function MerchantAppShell({
  children,
  signOutAction,
}: {
  children: React.ReactNode;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  // Query-qualified nav items need the query on the location string to match against
  // (#513 A组返工·三轮 item 2). Safe without a <Suspense> boundary: app/layout.tsx already
  // calls headers() in isImpersonating() before rendering this shell, which forces the whole
  // tree to render dynamically per request — there is no static shell for useSearchParams to
  // bail out of.
  const query = useSearchParams().toString();
  const pathWithQuery = query ? `${pathname}?${query}` : pathname;

  return (
    <MerchantShellContent pathname={pathWithQuery} signOutAction={signOutAction}>
      {children}
    </MerchantShellContent>
  );
}
