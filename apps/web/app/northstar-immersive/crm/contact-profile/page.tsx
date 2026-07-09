/** 沉浸式 · CRM 区 /contact-profile —— contacts 行 / conversation「查看客户」的去处。 */

import { Suspense } from "react";
import { CrmContactProfile } from "@/components/northstar/immersive/crm-inbox/crm-contact-profile";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

// 深链硬加载修复:Server Component + force-dynamic,请求期 useSearchParams 拿得到深链 query,
// 直开/刷新不再空白;Suspense fallback 给骨架而非 null。
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <CrmContactProfile />
    </Suspense>
  );
}
