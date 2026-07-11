"use client";

/**
 * 北极星 · 沉浸式产品外壳(the one persistent product shell)
 *
 * 一个常驻壳:persistent nav(左)+ 内容 pane(唯一滚动所有者,§L1)+ 常驻 Otto dock。
 * 页面之间平滑流转:内容 pane 按 pathname 换 key,做一次极轻的 fade-in(§8b 落地税则;
 * prefers-reduced-motion 下不动)。没有画廊顶栏「北极星原型 · 设计稿」水印、没有三态切换器、
 * 没有 57 项目录轨 —— 那些是设计稿 chrome,产品里不出现。
 *
 * 提供 ImmersiveProvider:insideImmersive=true 让复用的页面内容自动隐藏画廊角标;
 * openOtto(prompt?) 让任意页面「问 Otto」都能带一句预填展开常驻 dock 聊天面板。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { ImmersiveProvider } from "./_context";
import { ImmersiveNav } from "./immersive-nav";
import { ImmersiveDock, type ImmersiveDockHandle } from "./immersive-dock";
import {
  currentEscort,
  escortActedId,
  markEscortActed,
  setOttoContext,
  useOttoWorking,
  type NsOttoContext,
} from "./_store";

const GALLERY_PREFIX = "/northstar/";
const IMMERSIVE_PREFIX = "/northstar-immersive/";

/**
 * 沉浸式内保持流转:复用的画廊页里硬编码着 `/northstar/*` 交叉链接。
 * 用一个 capture 期委托监听把这些普通左键点击改跳到 `/northstar-immersive/*`,
 * 让页面之间连成流,而不跳出外壳 —— 零改动页面内容。
 * 只拦普通左键、无修饰键、同源、指向画廊前缀的链接;其余交回浏览器/Next。
 */
function useKeepInsideImmersive(rootRef: React.RefObject<HTMLElement | null>) {
  const router = useRouter();
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith(GALLERY_PREFIX)) return;
      if (anchor.getAttribute("target") === "_blank") return;
      e.preventDefault();
      e.stopPropagation();
      router.push(IMMERSIVE_PREFIX + href.slice(GALLERY_PREFIX.length));
    };
    root.addEventListener("click", onClick, true); // capture:抢在 Next Link 之前
    return () => root.removeEventListener("click", onClick, true);
  }, [rootRef, router]);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

const FADE_KF_ID = "ns-immersive-fade-kf";
const FADE_KF = `@keyframes ns-immersive-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }`;

export function ImmersiveShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const reduced = useReducedMotion();
  const dockRef = React.useRef<ImmersiveDockHandle>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  useKeepInsideImmersive(rootRef);

  // §8e 首次直播 escort 导航器。每个新鲜前台指示(escortTo)的 id 只导航一次;离开不拉回
  // (不产生新 id 就不再 push);返回续播是结构性的(store 是源)。已导航高水位线存在模块级
  // (escortActedId),不存组件 ref —— 外壳在 SPA 离开/回到路由组时会卸载重挂,ref 会归零
  // 让陈旧 escort 被当新指示重放;模块级高水位与 escortRequest 同寿命,remount 后不再拉回。
  const escort = currentEscort();
  React.useEffect(() => {
    if (!escort || escort.id <= escortActedId()) return;
    markEscortActed(escort.id);
    const surface = escort.surface.startsWith(GALLERY_PREFIX)
      ? IMMERSIVE_PREFIX + escort.surface.slice(GALLERY_PREFIX.length)
      : escort.surface;
    router.push(surface);
  }, [escort, router]);

  React.useEffect(() => {
    if (document.getElementById(FADE_KF_ID)) return;
    const el = document.createElement("style");
    el.id = FADE_KF_ID;
    el.textContent = FADE_KF;
    document.head.appendChild(el);
  }, []);

  // §L4 移动抽屉:≤680 侧栏脱离流成抽屉,由顶栏汉堡开合。换路由自动收起(点导航即跳即关),
  // Esc 也收。桌面(>680)常驻栏不受此 state 影响(纯 CSS 断点决定形态)。
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const closeDrawer = React.useCallback(() => setDrawerOpen(false), []);
  React.useEffect(() => setDrawerOpen(false), [pathname]);
  React.useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const openOtto = React.useCallback((prompt?: string, context?: NsOttoContext) => {
    // 上下文桥:带 context 就先落进共享 store(dock chip / 回复前缀读它),再展开面板。
    if (context !== undefined) setOttoContext(context);
    dockRef.current?.open(prompt);
  }, []);

  // Otto 工作态来自共享 store(otto_working / otto_idle 事件),不再硬编码 false。
  const { working: ottoWorking } = useOttoWorking();

  const ctx = React.useMemo(
    () => ({ insideImmersive: true, ottoWorking, openOtto }),
    [openOtto, ottoWorking],
  );

  const fullHref = "/northstar-immersive/otto";

  // dock 不出现的两类面:
  //  ① §O3 Otto 自己的全屏面(/otto + /global/otto-chat)—— 否则两个 Otto 同屏;
  //  ② 宪法 7 市政厅(/cityhall/admin)—— Otto 永久豁免,内部运维台不得出现 coral/dock。
  const hideDock =
    pathname === "/northstar-immersive/otto" ||
    pathname === "/northstar-immersive/global/otto-chat" ||
    pathname === "/northstar-immersive/cityhall/admin";

  // 登录闸(global gap#1):未登录的 /onboarding/login 是干净的未登录态 —— 不渲染
  // nav 的身份栏/余额/历史,也不挂常驻 Otto dock。登录提交后才进完整壳。
  const bareLayout = pathname === "/northstar-immersive/onboarding/login";
  if (bareLayout) {
    return (
      <div className="gb ns-immersive flex h-dvh flex-col bg-background text-foreground">
        <main
          className="min-h-0 flex-1 overflow-y-auto"
          style={reduced ? undefined : { animation: "ns-immersive-fade 220ms ease-out" }}
        >
          {children}
        </main>
      </div>
    );
  }

  return (
    <ImmersiveProvider value={ctx}>
      <div ref={rootRef} className="gb ns-immersive flex h-dvh flex-col bg-background text-foreground">
        {/* §L4 ≤680 顶栏:汉堡开抽屉 + 品牌回首页;>680 桌面常驻栏自带 header,故隐藏此条。 */}
        <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border px-2 min-[681px]:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="flex size-9 items-center justify-center rounded-[10px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
          >
            <Menu className="size-5" strokeWidth={2} />
          </button>
          <Link href="/northstar-immersive" className="flex min-w-0 items-center gap-2" aria-label="FIKIRTIVE home">
            <OttoAvatar size={24} mood="idle" />
            <span className="truncate text-[16px] font-bold tracking-[-0.01em] text-foreground">FIKIRTIVE</span>
          </Link>
        </div>
        <div className="flex min-h-0 flex-1">
          {/* ≤680 抽屉打开时的遮罩(点击关闭);>680 永不出现。 */}
          {drawerOpen && (
            <button
              type="button"
              aria-label="Close menu"
              tabIndex={-1}
              onClick={closeDrawer}
              className="fixed inset-0 z-[75] bg-foreground/40 min-[681px]:hidden"
            />
          )}
          <ImmersiveNav mobileOpen={drawerOpen} onCloseMobile={closeDrawer} />
          {/* 内容 pane:唯一滚动所有者;换路由 = 换 key 做一次轻 fade */}
          <main
            key={pathname}
            className="min-w-0 flex-1 overflow-y-auto"
            style={reduced ? undefined : { animation: "ns-immersive-fade 220ms ease-out" }}
          >
            {children}
          </main>
        </div>
        {/* dock 常驻挂载:在 hideDock 的 3 条路由上只做视觉隐藏(display:none),
            不卸载 —— 保住聊天草稿 / 已发消息等 dock 内部 state(§状态不因换页丢失)。 */}
        <div className={hideDock ? "hidden" : undefined}>
          <ImmersiveDock ref={dockRef} fullHref={fullHref} />
        </div>
      </div>
    </ImmersiveProvider>
  );
}
