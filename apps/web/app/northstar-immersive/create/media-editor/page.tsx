/**
 * 沉浸式 · 创作区 /media-editor(Crop / Trim 双把手 / Extract frame)——
 * 原生内容组件直接挂进常驻外壳(不再套 GalleryFrame)。
 * canvas 对象 Trim / Extract → 这里(?asset=id 深链)。
 */

import { Suspense } from "react";
import { MediaEditorPage } from "@/components/northstar/create/media-editor-page";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

// [cx-canvas-runtime] 深链硬加载修复:Server Component + force-dynamic,请求期 useSearchParams
// 拿得到 ?asset=,直开/刷新不再空白;Suspense fallback 给骨架而非 null。
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <MediaEditorPage />
    </Suspense>
  );
}
