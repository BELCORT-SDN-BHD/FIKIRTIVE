/**
 * 沉浸式 · Home —— 极简真首页(#609 · 2026-08-02 Founder 裁决)。
 *
 * 旧的沉浸式首页是一屏样板经营数据(写死余额、编造的决策队列)。裁决把它砍掉,换成真的
 * 三件套:开工输入框 + 新建画布 + 商家自己的画布列表。数据只经 fenced tree 外的受控 Entry
 * 按认证身份读;此路由文件不直接 import auth、DB 或 server actions。
 */

import { Suspense } from "react";
import { NorthstarHomeEntry } from "@/components/canvas/NorthstarHomeEntry";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <NorthstarHomeEntry />
    </Suspense>
  );
}
