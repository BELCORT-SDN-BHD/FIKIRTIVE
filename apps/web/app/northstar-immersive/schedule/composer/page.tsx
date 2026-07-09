/** 沉浸式 · 排期区 /composer —— 原生重建(Z5)。内容组件在 immersive/schedule 组。 */

import { Suspense } from "react";
import { ScheduleComposer } from "@/components/northstar/immersive/schedule/schedule-composer";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

// 深链硬加载修复:Server Component + force-dynamic,请求期 useSearchParams(useQueryParam)
// 拿得到 ?segment=/?post=,直开/刷新不再空白;Suspense fallback 给骨架而非 null。
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <ScheduleComposer />
    </Suspense>
  );
}
