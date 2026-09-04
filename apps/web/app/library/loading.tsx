import { Skeleton } from "@/components/ui/skeleton";

/**
 * Library 的加载态(规格书 §5.6:新路由的 loading 一律走 `ui/skeleton`,不手搓)。
 *
 * 骨架照着已批准的 Library pattern 画:同一个页头(标题 + 说明)、同一排一级页签、
 * 同一条筛选栏,底下同一副五列瀑布网格。形状对不上的骨架会让内容一到就跳一下,那比没有
 * 骨架更吵;设计的 essential states 也明写 loading 要保住 grid geometry,不用整页 spinner。
 *
 * (`components/ui/skeleton` 与 `design-system/primitives/skeleton` 今天是同一份配方 ——
 * 同样的 `animate-pulse rounded-md bg-accent`,画出来一个像素不差;这里保留 `ui/` 那条
 * import 只为不惊动 #986 的路由围栏。)
 */
export default function LibraryLoading() {
  return (
    <div className="flex h-[calc(100dvh-2.75rem)] flex-col bg-background">
      <div className="shrink-0 px-6 pt-5">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-2 h-4 w-72" />
        <div className="mt-5 flex gap-2 border-b border-border pb-2.5">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-20" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
        <Skeleton className="mb-3 h-5 w-24" />
        <div className="[column-count:5] [column-gap:0.5rem]">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="mb-2 aspect-[4/5] w-full rounded-lg" />
          ))}
        </div>
        <span className="sr-only">Loading library</span>
      </div>
    </div>
  );
}
