/** 沉浸式 · Campaign 区 /workbench —— 四项表单结构化入口(O-12),原生重建。 */

import { Suspense } from "react";
import { CampaignWorkbench } from "@/components/northstar/immersive/campaign/campaign-workbench";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

// 深链硬加载修复:Server Component + force-dynamic,请求期 useSearchParams(useQueryParam)
// 拿得到 ?goal=,直开/刷新不再空白;Suspense fallback 给骨架而非 null。
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <CampaignWorkbench />
    </Suspense>
  );
}
