"use client";

/**
 * 北极星 · 沉浸式页框(GalleryFrame)—— 现为透明 pass-through。
 *
 * 历史:曾用一条作用域受限的 CSS 兜底,把 schedule/kit 与 assets/_zone 各自定义、
 * 未接 context 的 DemoStateBar「漏出来的」画廊三态开关藏掉。
 *
 * 2026-07-08:三处 DemoStateBar(create/_create-ui、assets/_zone、schedule/kit)
 * 已各自 `useInsideImmersive()` 早退,与 _shared / analytics / campaign 同规矩 ——
 * 画廊 chrome 在源头就不出现,CSS 兜底作废,连同它一起删掉(不再靠脆弱的几何 hack)。
 *
 * 保留本组件仅为让 34 个引用点无痛过渡;它现在只是透明包裹。跨区链接改跳由外壳的
 * useKeepInsideImmersive 承担,与本组件无关。后续可把它从各页 inline 掉再移除。
 */

import * as React from "react";

export function GalleryFrame({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
