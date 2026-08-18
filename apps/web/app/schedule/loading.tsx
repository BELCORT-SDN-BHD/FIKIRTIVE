import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/schedule` 与它下面的 Analytics 页签共用的等待画面。
 *
 * 用 `ui/skeleton` 而不是再手搓一个自己闪的灰方块(规格书 §5.6 ③ / §7.1 shadcn 那条):
 * 骨架的配方只有一份,不然每加一页就多一种「还在加载」的画法。
 */
export default function ScheduleLoading() {
  return (
    <div className="mx-auto w-full max-w-[920px] px-7 py-6" aria-busy="true">
      <Skeleton className="h-9 w-40" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="h-7 w-28 rounded-full" />
      </div>
      <Skeleton className="mt-6 h-[72px] w-full rounded-[16px]" />
      <div className="mt-4 flex flex-col gap-2">
        <Skeleton className="h-16 w-full rounded-[14px]" />
        <Skeleton className="h-16 w-full rounded-[14px]" />
        <Skeleton className="h-16 w-full rounded-[14px]" />
      </div>
      <span className="sr-only">Loading your schedule</span>
    </div>
  );
}
