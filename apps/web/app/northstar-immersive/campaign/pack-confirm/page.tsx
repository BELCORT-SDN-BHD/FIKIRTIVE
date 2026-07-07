"use client";

/**
 * 沉浸式 · Campaign 区 /pack-confirm(打包确认 · 过闸花钱)—— 复用画廊页内容,套进常驻外壳。
 * 页内 `/northstar/*` 交叉链接由外壳 useKeepInsideImmersive 自动改跳沉浸式路由
 * (proposal → pack-confirm → schedule 的花钱闸口流靠它连起来)。
 */

import GalleryPage from "@/app/northstar/campaign/pack-confirm/page";
import { GalleryFrame } from "@/components/northstar/immersive/schedule-assets-ads/gallery-frame";

export default function Page() {
  return (
    <GalleryFrame>
      <GalleryPage />
    </GalleryFrame>
  );
}
