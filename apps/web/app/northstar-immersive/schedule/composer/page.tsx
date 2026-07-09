"use client";

/** 沉浸式 · 排期区 /composer —— 原生重建(Z5)。内容组件在 immersive/schedule 组。 */

import { Suspense } from "react";
import { ScheduleComposer } from "@/components/northstar/immersive/schedule/schedule-composer";

// Suspense 边界:ScheduleComposer 用 useQueryParam(useSearchParams)读 ?segment=/?post=。
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ScheduleComposer />
    </Suspense>
  );
}
