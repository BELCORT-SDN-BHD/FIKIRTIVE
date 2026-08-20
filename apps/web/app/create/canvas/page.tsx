/**
 * 沉浸式 · 创作区 /canvas —— 旗舰。原生内容组件直接挂进常驻外壳(不再套 GalleryFrame)。
 * 项目/会话/余额与 Canvas action 只经 fenced tree 外的受控 Entry 进入；
 * 此路由文件不直接 import auth、DB 或 server actions。
 */

import { Suspense } from "react";
import {
  ImmersiveCanvasEntry,
  type ImmersiveCanvasSearchParams,
} from "@/components/canvas/ImmersiveCanvasEntry";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

// [cx-canvas-runtime] 深链硬加载修复:Server Component + force-dynamic,请求期 useSearchParams
// 拿得到 ?audience=/?persona=,直开/刷新不再空白;Suspense fallback 给骨架而非 null。
export const dynamic = "force-dynamic";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<ImmersiveCanvasSearchParams>;
}) {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <ImmersiveCanvasEntry searchParams={searchParams} />
    </Suspense>
  );
}
