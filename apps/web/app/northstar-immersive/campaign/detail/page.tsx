"use client";

/** 沉浸式 · Campaign 区 /detail?id= —— 详情容器页(7 tabs,D1 物理载体),原生重建。 */

import { Suspense } from "react";
import { CampaignDetail } from "@/components/northstar/immersive/campaign/campaign-detail";

// Suspense 边界:CampaignDetail 用 useQueryParam(useSearchParams)读 ?id=。
export default function Page() {
  return (
    <Suspense fallback={null}>
      <CampaignDetail />
    </Suspense>
  );
}
