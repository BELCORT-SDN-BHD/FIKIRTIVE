import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/schedule` 与它下面的 Analytics 页签共用的等待画面。
 *
 * 用 `ui/skeleton` 而不是再手搓一个自己闪的灰方块(规格书 §5.6 ③ / §7.1 shadcn 那条):
 * 骨架的配方只有一份,不然每加一页就多一种「还在加载」的画法。
 */
export default function ScheduleLoading() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-5 py-6 md:px-8 lg:py-8" aria-busy="true">
      <div className="flex items-start gap-4 border-b border-border pb-5">
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <Skeleton className="mt-5 h-24 w-full rounded-[var(--radius-card)]" />
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
        <Skeleton className="h-[360px] w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-[280px] w-full rounded-[var(--radius-card)]" />
      </div>
      <span className="sr-only">Loading your schedule</span>
    </div>
  );
}
