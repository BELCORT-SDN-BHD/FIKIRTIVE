"use client";

/**
 * 创作旗舰面的外壳(the Create surface shell)
 *
 * #801(2026-08-08 Founder 裁决):**画布也是 creation 板块的,而且是主要一个卖点** ——
 * 它不下线,它接进主导航。原来的「六扇门」自有导航因此**整条退场**:那六扇门里,Home 与
 * Canvas 变成主导航第一格 Create,另外四扇(Library / 品牌与商品资料 / 买积分账单 / 设置)
 * 主导航本来就有。留着第二套导航,就是留着两份会各自漂移的「说的」。
 *
 * 现在这层壳只做一件事:内容 pane —— 唯一滚动所有者(§L1),换路由做一次极轻 fade-in
 * (§8b;prefers-reduced-motion 下不动)。
 *
 * W2-11(切换总票,规格书 §5.1):`<1024` 的自有顶栏退场——它原来的活是给全局抽屉开一个
 * 入口(#747),而全局抽屉本身随移动端整层一起删除了(新导轨是单层 240px↔64px,不再按
 * 宽度分形态)。商家壳现在只有一条导轨,任何宽度下都在,画布页不必再自建一条汉堡通道。
 *
 * #994(W2-7):右下那颗 Otto 按钮从这里退场。它做的事(「Otto 随处可用」)没有变,做事的
 * 东西换了:商家壳现在统一挂一块 Otto 面板,收起时就是那颗可拖、松手吸边的圆形 launcher
 * (`components/otto/panel/`)。行为从**跳转 `/otto`** 改成**就地开面板** —— 商家不再被从
 * 正在做的事上带走。#609 那条「画布页自带真输入框,那一页不挂」原样保留,只是判定挪到了
 * `panel-surface.ts`(壳只能有一个地方决定挂不挂)。
 */

import * as React from "react";
import { usePathname } from "next/navigation";

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

  React.useEffect(() => {
    if (document.getElementById(FADE_KF_ID)) return;
    const el = document.createElement("style");
    el.id = FADE_KF_ID;
    el.textContent = FADE_KF;
    document.head.appendChild(el);
  }, []);

  return (
    <div className="gb ns-immersive flex h-dvh flex-col bg-background text-foreground">
      {/* 内容 pane:唯一滚动所有者;换路由 = 换 key 做一次轻 fade */}
      <main
        key={pathname}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
        style={reduced ? undefined : { animation: "ns-immersive-fade 220ms ease-out" }}
      >
        {children}
      </main>
    </div>
  );
}
