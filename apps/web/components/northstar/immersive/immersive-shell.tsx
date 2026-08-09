"use client";

/**
 * 创作旗舰面的外壳(the Create surface shell)
 *
 * #801(2026-08-08 Founder 裁决):**画布也是 creation 板块的,而且是主要一个卖点** ——
 * 它不下线,它接进主导航。原来的「六扇门」自有导航因此**整条退场**:那六扇门里,Home 与
 * Canvas 变成主导航第一格 Create,另外四扇(Library / 品牌与商品资料 / 买积分账单 / 设置)
 * 主导航本来就有。留着第二套导航,就是留着两份会各自漂移的「说的」。
 *
 * 现在这层壳只做两件事:
 *   ① 内容 pane —— 唯一滚动所有者(§L1),换路由做一次极轻 fade-in
 *      (§8b;prefers-reduced-motion 下不动)。
 *   ② <1024 的自有顶栏 —— 52px 在流内,汉堡开的是**全局抽屉**(useOpenGlobalNavigation,
 *      #747 同一套交接):一屏只有一个抽屉入口,不叠罗汉。≥1024 全局导轨常驻,顶栏隐去。
 *
 * #609:右下那颗真 Otto 按钮留着 —— Otto 是随处可用的助手。画布页自带真输入框,那一页不挂。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import {
  useGlobalNavigationOpen,
  useOpenGlobalNavigation,
} from "@/components/global-navigation";

/** 真 Otto 对话的家(线上产品本体);壳里任何一个 Otto 入口都落到这里。 */
const REAL_OTTO_HREF = "/otto";

/** 创作旗舰面的首页 —— 顶栏品牌回这里,与主导航 Create 同一个目的地。 */
const CREATE_HOME_HREF = "/northstar-immersive";

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

  // Null outside the merchant shell (e.g. a unit test rendering this in isolation) —
  // there is no global drawer to open there, so the trigger must not render.
  const openGlobalNavigation = useOpenGlobalNavigation();
  const globalNavigationOpen = useGlobalNavigationOpen();

  React.useEffect(() => {
    if (document.getElementById(FADE_KF_ID)) return;
    const el = document.createElement("style");
    el.id = FADE_KF_ID;
    el.textContent = FADE_KF;
    document.head.appendChild(el);
  }, []);

  // 画布页自带真输入框(#600 合体内核),再挂一颗按钮就是两个 Otto 同屏。
  const hideOttoButton = pathname === "/northstar-immersive/create/canvas";

  return (
    <div className="gb ns-immersive flex h-dvh flex-col bg-background text-foreground">
      {/* <1024 顶栏:汉堡开**全局**抽屉 + 品牌回创作首页。≥1024 全局导轨常驻,故隐藏此条。
          抽屉开着时整条收起(#747 r2):抽屉贴同一条左边缘,顶栏留在原地就会压在它上面。 */}
      {openGlobalNavigation && !globalNavigationOpen && (
        <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border px-2 lg:hidden">
          <button
            type="button"
            onClick={openGlobalNavigation}
            aria-label="Open navigation"
            className="flex size-9 items-center justify-center rounded-[10px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
          >
            <Menu className="size-5" strokeWidth={2} />
          </button>
          <Link href={CREATE_HOME_HREF} className="flex min-w-0 items-center gap-2" aria-label="FIKIRTIVE home">
            <OttoAvatar size={24} mood="idle" />
            <span className="truncate text-[16px] font-bold tracking-[-0.01em] text-foreground">FIKIRTIVE</span>
          </Link>
        </div>
      )}
      {/* 内容 pane:唯一滚动所有者;换路由 = 换 key 做一次轻 fade */}
      <main
        key={pathname}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
        style={reduced ? undefined : { animation: "ns-immersive-fade 220ms ease-out" }}
      >
        {children}
      </main>
      {/* 一颗真 Otto 按钮:跳真对话。没有小窗、没有编造的经营事实、没有假消息流。 */}
      {!hideOttoButton && (
        <Link
          href={REAL_OTTO_HREF}
          aria-label="Ask Otto"
          className="fixed right-4 bottom-4 z-[70] flex size-12 items-center justify-center rounded-full border border-border bg-card shadow-[var(--shadow-md)] transition-transform duration-[160ms] ease-out hover:bg-accent active:scale-[0.96]"
        >
          <OttoAvatar size={26} mood="idle" />
        </Link>
      )}
    </div>
  );
}
