"use client";

/**
 * 沉浸式 · CRM 区 /contacts —— 复用画廊页内容,套进常驻外壳。
 * 页内 `/northstar/*` 交叉链接由外壳 useKeepInsideImmersive 自动改跳沉浸式路由
 * (contact → profile、inbox conversation → contact 的流靠它连起来)。
 */

import GalleryPage from "@/app/northstar/crm/contacts/page";
import { GalleryFrame } from "@/components/northstar/immersive/schedule-assets-ads/gallery-frame";

export default function Page() {
  return (
    <GalleryFrame>
      <GalleryPage />
    </GalleryFrame>
  );
}
