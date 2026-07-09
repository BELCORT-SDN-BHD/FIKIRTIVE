"use client";

/**
 * 沉浸式 · 创作区 /canvas —— 旗舰。原生内容组件直接挂进常驻外壳(不再套 GalleryFrame)。
 * 页内 `/northstar/*` 交叉链接由外壳 useKeepInsideImmersive 自动改跳沉浸式路由
 * (canvas 对象 → asset-viewer / media-editor 的流靠它连起来)。
 */

import { Suspense } from "react";
import { CanvasPage } from "@/components/northstar/create/canvas-page";

// [cx-canvas-runtime] Suspense 边界:CanvasPage 用 useSearchParams 读 ?audience=/?persona=。
export default function Page() {
  return (
    <Suspense fallback={null}>
      <CanvasPage />
    </Suspense>
  );
}
