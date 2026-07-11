"use client";

/**
 * 沉浸式 · 全屏 Otto 工作面 `/otto` —— 原生重建(不再套画廊页)。
 * 全屏页与右下角常驻 dock 是同一条 ottoStream 的两个入口(shell 注入的 fullHref 跳这里)。
 * 左 = 这条流(可过滤) · 右 = 当前 context 摘要。§O3:本路径上 dock 由外壳隐藏。
 */

import { OttoFullscreen } from "@/components/northstar/immersive/otto-fullscreen";

export default function Page() {
  return <OttoFullscreen />;
}
