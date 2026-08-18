/**
 * Create `/create` —— 创作旗舰面(#609 · 2026-08-02 Founder 裁决;W2-5 改名搬家)。
 *
 * 旧的沉浸式首页是一屏样板经营数据(写死余额、编造的决策队列)。裁决把它砍掉,换成真的
 * 三件套:开工输入框 + 新建画布 + 商家自己的画布列表。数据只经 fenced tree 外的受控 Entry
 * 按认证身份读;此路由文件不直接 import auth、DB 或 server actions。
 *
 * W2-5(规格书 §2.2 / Q6-A):这一面的地址从内部代号 `/northstar-immersive` 改成 `/create`
 * (旧地址永久重定向,见 `app/northstar-immersive/`),同时把原来各占一个导航格的 Templates
 * 与 Discover 收编成页面下方的两个区段(`#templates` / `#ideas`)。页面本身仍然只是把两个
 * 受控 Entry 摆上来 —— 一个都不多。
 */

import { Suspense } from "react";
import { NorthstarHomeEntry } from "@/components/canvas/NorthstarHomeEntry";
import { CreateBrowseEntry } from "@/components/create/CreateBrowseEntry";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = "force-dynamic";

/** 下半页还在读商家自己的画布与产品时的占位。ui/skeleton 一个配方,不再手搓 shimmer。 */
function BrowseSectionsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[768px] px-5 pt-16 pb-5" aria-hidden>
      <Skeleton className="h-5 w-28" />
      <Skeleton className="mt-2 h-4 w-72" />
      <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        <Skeleton className="h-28 w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-28 w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-28 w-full rounded-[var(--radius-card)]" />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <>
      <Suspense fallback={<DeepLinkFallback />}>
        <NorthstarHomeEntry />
      </Suspense>
      <Suspense fallback={<BrowseSectionsSkeleton />}>
        <CreateBrowseEntry />
      </Suspense>
    </>
  );
}
