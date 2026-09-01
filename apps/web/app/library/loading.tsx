import { Skeleton } from "@/components/ui/skeleton";

/**
 * Library 的加载态(规格书 §5.6:新路由的 loading 一律走 `ui/skeleton`,不手搓)。
 *
 * 骨架的形状照着 `OttoStuff` 画:同一个 1120px 栏宽、同一行标题 + 说明 + 动作,底下同一副
 * 网格。形状对不上的骨架会让内容一到就跳一下,那比没有骨架更吵。
 */
export default function LibraryLoading() {
  return (
    <div className="flex min-h-dvh flex-col px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto w-full max-w-[1120px]">
        <div className="mb-5 flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-5 w-[min(28rem,80vw)]" />
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Skeleton className="h-9 w-28 shrink-0" />
            <Skeleton className="h-9 w-16 shrink-0" />
          </div>
        </div>
        <div className="mb-4 flex flex-col gap-3 border-y border-border py-3 lg:flex-row lg:items-center lg:justify-between">
          <Skeleton className="h-9 w-[min(36rem,100%)]" />
          <Skeleton className="h-9 w-full lg:max-w-[280px]" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-3">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-[var(--radius-card)]" />
          ))}
        </div>
        <span className="sr-only">Loading library</span>
      </div>
    </div>
  );
}
