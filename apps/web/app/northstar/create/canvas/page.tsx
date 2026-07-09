/* @nsPage district="创作区" page="canvas" status="draft"
   sources="GOAL §2 全表;区划图·创作区;N (Grok) canvas A/B 分叉判决「要」" approvedAt="" pr="" */
"use client";

import { Suspense } from "react";
import { CanvasPage } from "@/components/northstar/create/canvas-page";

// [cx-canvas-runtime] Suspense 边界:CanvasPage 用 useSearchParams 读 ?audience=/?persona=,
// 静态构建要求包在 Suspense 里(与 inbox/conversation 一致)。
export default function Page() {
  return (
    <Suspense fallback={null}>
      <CanvasPage />
    </Suspense>
  );
}
