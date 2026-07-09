/**
 * 沉浸式 · 创作区 /asset-viewer —— 原生内容组件直接挂进常驻外壳(不再套 GalleryFrame)。
 * canvas 对象 Full screen → 这里(?asset=id 深链);Back 单层回 canvas。
 */

import { Suspense } from "react";
import { AssetViewerPage } from "@/components/northstar/create/asset-viewer-page";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

// [cx-canvas-runtime] 深链硬加载修复:此页是 Server Component(非 "use client"),force-dynamic
// 让请求期渲染时 useSearchParams 拿得到 ?asset=,直开/刷新不再走静态 CSR-bailout 空白;
// Suspense fallback 给骨架(而非 null),软导航过渡也先有版面。
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <AssetViewerPage />
    </Suspense>
  );
}
