"use client";

/**
 * 沉浸式 · Campaign 区 /workbench —— 复用画廊页内容,套进常驻外壳(nav + Otto dock + 流转)。
 * 页内 `/northstar/*` 交叉链接由外壳 useKeepInsideImmersive 自动改跳沉浸式路由。
 */

import GalleryPage from "@/app/northstar/campaign/workbench/page";
import { GalleryFrame } from "@/components/northstar/immersive/schedule-assets-ads/gallery-frame";

export default function Page() {
  return (
    <GalleryFrame>
      <GalleryPage />
    </GalleryFrame>
  );
}
