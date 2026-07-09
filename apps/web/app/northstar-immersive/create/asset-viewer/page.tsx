"use client";

/**
 * 沉浸式 · 创作区 /asset-viewer —— 原生内容组件直接挂进常驻外壳(不再套 GalleryFrame)。
 * canvas 对象 Full screen → 这里(?asset=id 深链);Back 单层回 canvas。
 */

import { AssetViewerPage } from "@/components/northstar/create/asset-viewer-page";

export default function Page() {
  return <AssetViewerPage />;
}
