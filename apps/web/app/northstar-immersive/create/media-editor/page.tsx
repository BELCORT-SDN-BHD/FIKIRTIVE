"use client";

/**
 * 沉浸式 · 创作区 /media-editor(抽帧 / 媒体编辑)—— 复用画廊媒体编辑页,套进常驻外壳。
 * 页内 `/northstar/*` 交叉链接由外壳 useKeepInsideImmersive 自动改跳沉浸式路由。
 */

import GalleryPage from "@/app/northstar/create/media-editor/page";
import { GalleryFrame } from "@/components/northstar/immersive/schedule-assets-ads/gallery-frame";

export default function Page() {
  return (
    <GalleryFrame>
      <GalleryPage />
    </GalleryFrame>
  );
}
