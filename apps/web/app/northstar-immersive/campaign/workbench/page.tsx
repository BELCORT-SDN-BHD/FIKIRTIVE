"use client";

/** 沉浸式 · Campaign 区 /workbench —— 四项表单结构化入口(O-12),原生重建。 */

import { Suspense } from "react";
import { CampaignWorkbench } from "@/components/northstar/immersive/campaign/campaign-workbench";

// Suspense 边界:CampaignWorkbench 用 useQueryParam(useSearchParams)读 ?goal=。
export default function Page() {
  return (
    <Suspense fallback={null}>
      <CampaignWorkbench />
    </Suspense>
  );
}
