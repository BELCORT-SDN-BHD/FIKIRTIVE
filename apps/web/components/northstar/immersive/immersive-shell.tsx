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
import { usePathname, useRouter } from "next/navigation";
import { ImmersiveProvider } from "./_context";
import { ImmersiveNav } from "./immersive-nav";
import { ImmersiveDock, type ImmersiveDockHandle } from "./immersive-dock";
import { useOttoWorking } from "./_store";

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
  const reduced = useReducedMotion();
  const dockRef = React.useRef<ImmersiveDockHandle>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  useKeepInsideImmersive(rootRef);

  React.useEffect(() => {
    if (document.getElementById(FADE_KF_ID)) return;
    const el = document.createElement("style");
    el.id = FADE_KF_ID;
    el.textContent = FADE_KF;
    document.head.appendChild(el);
  }, []);

  const openOtto = React.useCallback((prompt?: string) => {
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

  return (
    <ImmersiveProvider value={ctx}>
      <div ref={rootRef} className="gb flex h-dvh flex-col bg-background text-foreground">
        <div className="flex min-h-0 flex-1">
          <ImmersiveNav />
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
