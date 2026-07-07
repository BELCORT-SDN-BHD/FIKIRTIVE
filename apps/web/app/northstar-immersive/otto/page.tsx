"use client";

/**
 * 沉浸式 · 全屏 Otto 工作面 /otto —— 复用画廊 otto-chat 全页,套进常驻外壳。
 * 全屏页与右下角常驻 dock 是同一个 Otto 的两个入口(shell 注入的 fullHref 跳这里)。
 * 页内 `/northstar/*` 交叉链接由外壳 useKeepInsideImmersive 自动改跳沉浸式路由。
 */

import GalleryPage from "@/app/northstar/global/otto-chat/page";
import { GalleryFrame } from "@/components/northstar/immersive/schedule-assets-ads/gallery-frame";

export default function Page() {
  return (
    <GalleryFrame>
      <GalleryPage />
    </GalleryFrame>
  );
}
