"use client";

/**
 * 北极星 · 沉浸式「排期 / 资产 / 广告」页框(GalleryFrame)
 *
 * 一句话:把已经建好的画廊页内容原样搬进沉浸式外壳,零重画。
 *
 * 外壳(ImmersiveShell)已经承担两件事,页框不重复:
 *  ① useKeepInsideImmersive —— capture 期委托监听把页内硬编码的 `/northstar/*`
 *     交叉链接改跳 `/northstar-immersive/*`,让页面连成流(composer→schedule、
 *     library 素材→canvas、ads performance→create 都靠它自动生效)。
 *  ② insideImmersive context —— MockNote(_shared)与 analytics/zone-kit 的
 *     DemoStateBar 各自 useInsideImmersive() 早退,产品里不出现画廊 chrome。
 *
 * 唯一缺口:排期区(schedule/kit)与资产区(assets/_zone)各自定义的 DemoStateBar
 * 尚未接 context(那两个 kit 不在本组编辑范围内)。这里用一条作用域受限的 CSS
 * 兜底,把「漏出来的」画廊三态开关藏掉 —— 只命中本页框内 position:fixed 的
 * 底部居中悬浮条(§8:那正是 DemoStateBar 的唯一签名;MockNote 与广告区三态
 * 已在 context 里 return null,不会误伤),不碰任何正文。产品里因此看不到画廊 chrome。
 *
 * 铁律沿用外壳:纯 client、零后台 import;coral 只属于 Otto。
 */

import * as React from "react";

/** 作用域受限的 style id —— 只注一次。 */
const HIDE_KF_ID = "nsi-saa-hide-demo-bar";

/**
 * 只藏本页框内「fixed + bottom-4 + left-1/2」的悬浮条 —— 那是画廊 DemoStateBar
 * 的唯一签名(schedule/kit + assets/_zone)。用属性子串选择器匹配 Tailwind
 * 原子类名(class 里字面含 `left-1/2`)。Otto dock 在外壳里、不在本框内,不受影响。
 */
const HIDE_CSS = `
[data-nsi-saa-frame] .fixed.bottom-4[class*="left-1/2"] { display: none !important; }
`;

export function GalleryFrame({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    if (document.getElementById(HIDE_KF_ID)) return;
    const el = document.createElement("style");
    el.id = HIDE_KF_ID;
    el.textContent = HIDE_CSS;
    document.head.appendChild(el);
  }, []);

  return <div data-nsi-saa-frame>{children}</div>;
}
