"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { merchantNavLinks, SHELL_ROUTES } from "@fikirtive/core/navigation";
import type { RailAccount } from "@/components/navigation/rail/NavigationRail";
import { navMatchesLocation, splitLocation } from "@/components/navigation/rail/rail-tree";
import { R22DashboardShell } from "@/components/r22/R22DashboardShell";
import { OttoPanelMount } from "@/components/otto/panel/OttoPanelMount";
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
    ...merchantNavLinks().map((item) => splitLocation(item.href).path),
    ...Object.values(SHELL_ROUTES),
    "/profile",
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
const SHARE_PREVIEW_PATH = "/schedule/share-preview";

export function isMerchantSurface(pathname: string): boolean {
  if (navMatchesLocation(pathname, SHARE_PREVIEW_PATH)) return false;
  return MERCHANT_SURFACE_PATHS.some((href) => navMatchesLocation(pathname, href));
}

export function MerchantShellContent({
  children,
  pathname,
  signOutAction,
  ottoVariant = "r22",
}: {
  children?: React.ReactNode;
  pathname: string;
  signOutAction: () => Promise<void>;
  /** R22 is the production shell. Legacy exists only so the retained panel contract can be tested in isolation. */
  ottoVariant?: "legacy" | "r22";
}) {
  const merchantSurface = isMerchantSurface(pathname);
  const standaloneCanvas = navMatchesLocation(pathname, SHELL_ROUTES.canvas);
  const standaloneSettings = navMatchesLocation(pathname, SHELL_ROUTES.preferences);
  const visualFixture =
    process.env.NODE_ENV !== "production" &&
    new URLSearchParams(pathname.split("?", 2)[1] ?? "").get("fixture") === "r22";
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
    if (!merchantSurface || standaloneCanvas || standaloneSettings || visualFixture) return;
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
  }, [merchantSurface, standaloneCanvas, standaloneSettings, visualFixture]);

  if (!merchantSurface) return <>{children}</>;
  // R22 Canvas 是 dashboard shell 的兄弟 surface。打开项目后,全局导轨与全局 Otto
  // 都退出 viewport;Canvas 自己持有项目顶栏、Otto 状态、Conversation 与 composer。
  if (standaloneCanvas || standaloneSettings) return <>{children}</>;

  return (
    <OttoPanelMount location={pathname} variant={ottoVariant}>
      <R22DashboardShell location={pathname} account={account} signOutAction={signOutAction}>
        {children}
      </R22DashboardShell>
    </OttoPanelMount>
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
