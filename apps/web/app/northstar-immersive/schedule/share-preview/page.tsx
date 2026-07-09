"use client";

/** 沉浸式 · 排期区 /share-preview —— 原生重建(Z5)。内容组件在 immersive/schedule 组。 */

import { Suspense } from "react";
import { ScheduleSharePreview } from "@/components/northstar/immersive/schedule/schedule-share-preview";

// Suspense 边界:ScheduleSharePreview 用 useQueryParam(useSearchParams)读 ?post=。
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ScheduleSharePreview />
    </Suspense>
  );
}
