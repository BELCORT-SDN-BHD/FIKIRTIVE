/* @nsPage district="创作区" page="media-editor" status="draft"
   sources="GOAL C3/C4/D4/D5/E2/E3;区划图·创作区(抽帧)" approvedAt="" pr="" */
"use client";

import { Suspense } from "react";
import { MediaEditorPage } from "@/components/northstar/create/media-editor-page";

// [cx-canvas-runtime] Suspense 边界:MediaEditorPage 用 useSearchParams 读 ?asset= 深链 id。
export default function Page() {
  return (
    <Suspense fallback={null}>
      <MediaEditorPage />
    </Suspense>
  );
}
