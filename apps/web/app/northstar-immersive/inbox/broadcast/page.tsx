/** 沉浸式 · 收件箱 /broadcast —— 分群群发 + 失败重发 + 群发后跟进(Z6 Wave B)。 */

import { Suspense } from "react";
import { InboxBroadcast } from "@/components/northstar/immersive/crm-inbox/inbox-broadcast";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

// [wave-c-integration] 深链修复:接住 crm/segments「Broadcast to this group」的 ?segment=<id>。
// InboxBroadcast 现走 useSearchParams(useQueryParam)——必须被 Suspense 包着 + force-dynamic,
// 直开/刷新不再空白、参数到达即预选该分群(与 schedule/composer 的深链外壳同构)。
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <InboxBroadcast />
    </Suspense>
  );
}
