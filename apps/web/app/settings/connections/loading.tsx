import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/settings/connections` 的等待画面。骨架走 `components/ui/skeleton`,不手搓
 * `animate-pulse`(规格书 §5.6 ③)。
 */
export default function ConnectionsLoading() {
  return (
    <main className="gb flex h-dvh flex-col bg-background" role="status" aria-live="polite">
      <div className="flex-1 overflow-hidden p-5">
        <div className="mx-auto w-full max-w-[720px]">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-2 h-5 w-full max-w-[28rem]" />
          {/* 诚实说明句那一块 */}
          <Skeleton className="mt-6 h-[72px] w-full rounded-[14px]" />
          {/* Publishing 三行 */}
          <Skeleton className="mt-7 h-5 w-28" />
          <Skeleton className="mt-2 h-[168px] w-full rounded-[14px]" />
          {/* Messaging 一行 */}
          <Skeleton className="mt-7 h-5 w-28" />
          <Skeleton className="mt-2 h-[64px] w-full rounded-[14px]" />
        </div>
      </div>
      <span className="sr-only">Loading your connections</span>
    </main>
  );
}
