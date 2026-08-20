import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/settings` 的等待画面。
 *
 * 页面是 Server Component,要先读完账户与余额才吐第一个字节;没有这个文件的话浏览器在这段
 * 时间里什么都拿不到。骨架走 `components/ui/skeleton`,不再手搓一份 `animate-pulse` 的 div
 * (规格书 §5.6 ③ —— 手搓那些正是走查点名的一类:一份配方散在七八个文件里)。
 */
export default function SettingsLoading() {
  return (
    <main className="gb flex h-dvh flex-col bg-background" role="status" aria-live="polite">
      <div className="flex flex-1 gap-6 overflow-hidden p-[64px_28px_30px]">
        {/* 左边那条分区导航 */}
        <div className="hidden w-[190px] flex-none flex-col gap-2 sm:flex">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="mt-2 h-8 w-full rounded-[9px]" />
          <Skeleton className="h-8 w-full rounded-[9px]" />
          <Skeleton className="h-8 w-full rounded-[9px]" />
          <Skeleton className="h-8 w-full rounded-[9px]" />
        </div>
        {/* 右边的分区卡片 */}
        <div className="min-w-0 flex-1">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="mt-3 h-[168px] w-full max-w-[760px] rounded-[14px]" />
          <Skeleton className="mt-7 h-6 w-40" />
          <Skeleton className="mt-3 h-[120px] w-full max-w-[760px] rounded-[14px]" />
        </div>
      </div>
      <span className="sr-only">Loading your settings</span>
    </main>
  );
}
