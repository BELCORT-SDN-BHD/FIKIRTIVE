/** 沉浸式 · Campaign 区 /detail?id= —— 详情容器页(7 tabs,D1 物理载体),原生重建。 */

import { Suspense } from "react";
import { CampaignDetail } from "@/components/northstar/immersive/campaign/campaign-detail";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

// 深链硬加载修复:Server Component + force-dynamic,请求期 useSearchParams(useQueryParam)
// 拿得到 ?id=,直开/刷新不再空白;Suspense fallback 给骨架而非 null。
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <CampaignDetail />
    </Suspense>
  );
}
