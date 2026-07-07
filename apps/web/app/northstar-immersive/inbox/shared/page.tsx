"use client";

/**
 * 沉浸式 · 收件箱客服区 /shared —— 复用画廊页内容,套进常驻外壳。
 * 页内 `/northstar/*` 交叉链接由外壳 useKeepInsideImmersive 自动改跳沉浸式路由
 * (inbox conversation → contact profile 的流靠它连起来)。
 */

import GalleryPage from "@/app/northstar/inbox/shared/page";
import { GalleryFrame } from "@/components/northstar/immersive/schedule-assets-ads/gallery-frame";

export default function Page() {
  return (
    <GalleryFrame>
      <GalleryPage />
    </GalleryFrame>
  );
}
