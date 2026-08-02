"use client";

/**
 * 北极星 · 沉浸式产品外壳(the one persistent product shell)
 *
 * 一个常驻壳:六扇门导航(左)+ 内容 pane(唯一滚动所有者,§L1)+ 一颗真 Otto 按钮。
 * 页面之间平滑流转:内容 pane 按 pathname 换 key,做一次极轻的 fade-in(§8b 落地税则;
 * prefers-reduced-motion 下不动)。
 *
 * #609(2026-08-02 Founder 裁决):右下那个**假 Otto 小窗**被砍除 —— 它会用样板数据编造
 * 经营事实,是最恶劣的一类假物。取而代之的是一颗按钮,跳**真对话**(线上 Otto `/otto`)。
 * 画布页自带真输入框,所以那一页不重复挂这颗按钮。
 *
 * 提供 ImmersiveProvider:insideImmersive=true 让复用的页面内容自动隐藏画廊角标;
 * openOtto() 让任意页面的「问 Otto」都落到同一条真对话上。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { ImmersiveProvider } from "./_context";
import { ImmersiveNav, type ShellIdentity } from "./immersive-nav";

const GALLERY_PREFIX = "/northstar/";
const IMMERSIVE_PREFIX = "/northstar-immersive/";

/** 真 Otto 对话的家(线上产品本体);壳里任何一个 Otto 入口都落到这里。 */
const REAL_OTTO_HREF = "/otto";

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

/* §L4 移动抽屉开合态 —— 模块级 mini 外部 store。为什么不是组件内 useState:换路由要自动
 * 收抽屉,而「pathname 一变就 setState」是 set-state-in-effect 禁的级联渲染;
 * 「adjust-during-render」被 set-state-in-render 禁;key-reset(React 官方首选)要求抽屉
 * 状态 owner 的子树整体 remount,但 mobileOpen 的消费者 ImmersiveNav 是滚动持久的常驻栏
 * (remount = 桌面导航每次换页丢滚动位)。外部 store + useSyncExternalStore 是规则背书的
 * 第三形态:effect 只向外部系统写「关」,组件经订阅读回,无级联 setState。
 * 语义与旧 `useEffect(() => setDrawerOpen(false), [pathname])` 全等:任何 pathname 变化
 * (点导航 / 浏览器后退前进)都收抽屉。开态不派生自 pathname,故
 * 「A 开抽屉 → 去 B → 后退回 A」不复活(B→A 这次变化本身已写「关」)。 */
let mobileDrawerOpen = false;
const mobileDrawerListeners = new Set<() => void>();
function writeMobileDrawer(open: boolean): void {
  if (mobileDrawerOpen === open) return;
  mobileDrawerOpen = open;
  for (const l of mobileDrawerListeners) l();
}
function subscribeMobileDrawer(cb: () => void): () => void {
  mobileDrawerListeners.add(cb);
  return () => mobileDrawerListeners.delete(cb);
}

export function ImmersiveShell({
  children,
  identity,
}: {
  children: React.ReactNode;
  /** 登录进来的这个人(外壳入口从认证会话解析后注入);未登录为 null。 */
  identity: ShellIdentity | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const reduced = useReducedMotion();
  const rootRef = React.useRef<HTMLDivElement>(null);
  useKeepInsideImmersive(rootRef);

  React.useEffect(() => {
    if (document.getElementById(FADE_KF_ID)) return;
    const el = document.createElement("style");
    el.id = FADE_KF_ID;
    el.textContent = FADE_KF;
    document.head.appendChild(el);
  }, []);

  // §L4 移动抽屉:≤680 侧栏脱离流成抽屉,由顶栏汉堡开合。换路由自动收起(点导航即跳即关),
  // Esc 也收。桌面(>680)常驻栏不受此 state 影响(纯 CSS 断点决定形态)。
  const drawerOpen = React.useSyncExternalStore(
    subscribeMobileDrawer,
    () => mobileDrawerOpen,
    () => false,
  );
  const closeDrawer = React.useCallback(() => writeMobileDrawer(false), []);
  React.useEffect(() => {
    writeMobileDrawer(false);
  }, [pathname]);
  React.useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") writeMobileDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // 页面上的「问 Otto」落到真对话。旧实现是展开假小窗并预填一句话;那个小窗已被砍除,
  // 所以这里只做一件不撒谎的事:把商家送到真的 Otto 面前。
  const openOtto = React.useCallback(() => {
    router.push(REAL_OTTO_HREF);
  }, [router]);

  const ctx = React.useMemo(() => ({ insideImmersive: true, openOtto }), [openOtto]);

  // 画布页自带真输入框(#600 合体内核),再挂一颗按钮就是两个 Otto 同屏;那一页不出现这颗按钮。
  // (#615:市政厅 /admin 与 /onboarding/login 两条路线已退场,各自的特判随之删除。)
  const hideOttoButton = pathname === "/northstar-immersive/create/canvas";

  return (
    <ImmersiveProvider value={ctx}>
      <div ref={rootRef} className="gb ns-immersive flex h-dvh flex-col bg-background text-foreground">
        {/* §L4 ≤680 顶栏:汉堡开抽屉 + 品牌回首页;>680 桌面常驻栏自带 header,故隐藏此条。 */}
        <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border px-2 min-[681px]:hidden">
          <button
            type="button"
            onClick={() => writeMobileDrawer(true)}
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
          <ImmersiveNav identity={identity} mobileOpen={drawerOpen} onCloseMobile={closeDrawer} />
          {/* 内容 pane:唯一滚动所有者;换路由 = 换 key 做一次轻 fade。
              挂 Otto 球时底部让位 72px(#615:壳层通用让位,球不再压住任何页面的底部正文)。 */}
          <main
            key={pathname}
            className={hideOttoButton ? "min-w-0 flex-1 overflow-y-auto" : "min-w-0 flex-1 overflow-y-auto pb-[72px]"}
            style={reduced ? undefined : { animation: "ns-immersive-fade 220ms ease-out" }}
          >
            {children}
          </main>
        </div>
        {/* 一颗真 Otto 按钮:跳真对话。没有小窗、没有编造的经营事实、没有假消息流。 */}
        {!hideOttoButton && (
          <Link
            href={REAL_OTTO_HREF}
            aria-label="Ask Otto"
            className="fixed right-4 bottom-4 z-[70] flex size-12 items-center justify-center rounded-full border border-border bg-card shadow-[var(--shadow-md)] transition-colors duration-[120ms] hover:bg-accent active:scale-[0.96]"
          >
            <OttoAvatar size={26} mood="idle" />
          </Link>
        )}
      </div>
    </ImmersiveProvider>
  );
}
