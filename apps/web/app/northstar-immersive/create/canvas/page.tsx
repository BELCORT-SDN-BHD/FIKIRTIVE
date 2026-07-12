/**
 * 沉浸式 · 创作区 /canvas —— 旗舰。原生内容组件直接挂进常驻外壳(不再套 GalleryFrame)。
 * 页内 `/northstar/*` 交叉链接由外壳 useKeepInsideImmersive 自动改跳沉浸式路由
 * (canvas 对象 → asset-viewer / media-editor 的流靠它连起来)。
 */

import { Suspense } from "react";
import { CanvasPage } from "@/components/northstar/create/canvas-page";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

// [cx-canvas-runtime] 深链硬加载修复:Server Component + force-dynamic,请求期 useSearchParams
// 拿得到 ?audience=/?persona=,直开/刷新不再空白;Suspense fallback 给骨架而非 null。
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <CanvasPage />
    </Suspense>
  );
}
