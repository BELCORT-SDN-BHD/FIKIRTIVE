"use client";

/**
 * 沉浸式 · 创作区 /asset-viewer —— 原生内容组件直接挂进常驻外壳(不再套 GalleryFrame)。
 * canvas 对象 Full screen → 这里(?asset=id 深链);Back 单层回 canvas。
 */

import { Suspense } from "react";
import { AssetViewerPage } from "@/components/northstar/create/asset-viewer-page";

// [cx-canvas-runtime] Suspense 边界:AssetViewerPage 用 useSearchParams 读 ?asset= 深链 id。
export default function Page() {
  return (
    <Suspense fallback={null}>
      <AssetViewerPage />
    </Suspense>
  );
}
