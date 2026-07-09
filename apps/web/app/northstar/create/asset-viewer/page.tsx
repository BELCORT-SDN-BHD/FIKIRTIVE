/* @nsPage district="创作区" page="asset-viewer" status="draft"
   sources="GOAL G1;g2a detail panel spec(2026-06-27)" approvedAt="" pr="" */
"use client";

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
