"use client";

/**
 * 沉浸式 · 资产区 /templates —— 复用画廊页内容,套进常驻外壳(nav + Otto dock + 流转)。
 * 页内 `/northstar/*` 交叉链接由外壳 useKeepInsideImmersive 自动改跳沉浸式路由
 * (library/templates/discover 素材 → canvas 的流靠它连起来)。
 */

import GalleryPage from "@/app/northstar/assets/templates/page";
import { GalleryFrame } from "@/components/northstar/immersive/schedule-assets-ads/gallery-frame";

export default function Page() {
  return (
    <GalleryFrame>
      <GalleryPage />
    </GalleryFrame>
  );
}
