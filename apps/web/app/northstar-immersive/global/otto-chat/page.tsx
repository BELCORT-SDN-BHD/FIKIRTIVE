"use client";

/**
 * 沉浸式 · 全局 /otto-chat(Otto 全屏工作面)—— 复用画廊 otto-chat 全页,套进常驻外壳。
 * 页内硬编码的 `/northstar/global/otto-chat` 交叉链接会被外壳改跳到这里,与 /otto 同一份工作面。
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
