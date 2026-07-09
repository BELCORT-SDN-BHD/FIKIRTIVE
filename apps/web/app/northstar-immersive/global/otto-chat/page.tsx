"use client";

/**
 * 沉浸式 · 全局 `/otto-chat` —— 原生重建,与 `/otto` 同一份全屏工作面(同一条 ottoStream)。
 * 页内硬编码的 `/northstar/global/otto-chat` 交叉链接被外壳改跳到这里。§O3:dock 由外壳隐藏。
 */

import { OttoFullscreen } from "@/components/northstar/immersive/otto-fullscreen";

export default function Page() {
  return <OttoFullscreen />;
}
