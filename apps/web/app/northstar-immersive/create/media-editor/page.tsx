"use client";

/**
 * 沉浸式 · 创作区 /media-editor(Crop / Trim 双把手 / Extract frame)——
 * 原生内容组件直接挂进常驻外壳(不再套 GalleryFrame)。
 * canvas 对象 Trim / Extract → 这里(?asset=id 深链)。
 */

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
