"use client";

/**
 * 沉浸式 · 全局 /notifications —— 复用画廊通知页(审批队列 + Otto 时间线),套进常驻外壳。
 * 页内 `/northstar/*` 交叉链接由外壳 useKeepInsideImmersive 自动改跳沉浸式路由
 * (「View in chat」→ /otto-chat、审批落定后的收据行 → assets/library、schedule/plan)。
 */

import GalleryPage from "@/app/northstar/global/notifications/page";
import { GalleryFrame } from "@/components/northstar/immersive/schedule-assets-ads/gallery-frame";

export default function Page() {
  return (
    <GalleryFrame>
      <GalleryPage />
    </GalleryFrame>
  );
}
