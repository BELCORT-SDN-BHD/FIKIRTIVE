"use client";

/**
 * 沉浸式 · 全局 /legal(privacy / terms / data-deletion)—— 复用画廊法务页组,套进常驻外壳。
 * 设计降级页:纯文本排版对齐 token,页内 tab 井切换三份文本;无 Otto、无 coral。
 */

import GalleryPage from "@/app/northstar/global/legal/page";
import { GalleryFrame } from "@/components/northstar/immersive/schedule-assets-ads/gallery-frame";

export default function Page() {
  return (
    <GalleryFrame>
      <GalleryPage />
    </GalleryFrame>
  );
}
