/** 沉浸式 · 收件箱 /knowledge —— Otto 客服答案的依据库。 */

import { Suspense } from "react";
import { InboxKnowledge } from "@/components/northstar/immersive/crm-inbox/inbox-knowledge";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

// 深链硬加载修复:Server Component + force-dynamic,请求期 useSearchParams 拿得到深链 query,
// 直开/刷新不再空白;Suspense fallback 给骨架而非 null。
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <InboxKnowledge />
    </Suspense>
  );
}
