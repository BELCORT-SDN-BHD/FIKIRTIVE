import { Skeleton } from "@/components/ui/skeleton";

/**
 * Library 的加载态(规格书 §5.6:新路由的 loading 一律走 `ui/skeleton`,不手搓)。
 *
 * 骨架的形状照着 `OttoStuff` 画:同一个 880px 栏宽、同一行标题 + 说明 + Add,底下同一副
 * 网格。形状对不上的骨架会让内容一到就跳一下,那比没有骨架更吵。
 */
export default function LibraryLoading() {
  return (
    <div className="flex min-h-dvh flex-col p-6">
      <div className="mx-auto w-full max-w-[880px]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-5 w-[min(28rem,80vw)]" />
          </div>
          <Skeleton className="h-8 w-20 shrink-0" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-48 rounded-[14px]" />
          ))}
        </div>
        <span className="sr-only">Loading library</span>
      </div>
    </div>
  );
}
