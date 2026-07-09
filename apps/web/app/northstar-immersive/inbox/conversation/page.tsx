/** 沉浸式 · 收件箱 /conversation —— 一条线程全文,连回客户档案。 */

import { Suspense } from "react";
import { InboxConversation } from "@/components/northstar/immersive/crm-inbox/inbox-conversation";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

// 深链硬加载修复:Server Component + force-dynamic,请求期 useSearchParams 拿得到深链 query,
// 直开/刷新不再空白;Suspense fallback 给骨架而非 null。
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <InboxConversation />
    </Suspense>
  );
}
