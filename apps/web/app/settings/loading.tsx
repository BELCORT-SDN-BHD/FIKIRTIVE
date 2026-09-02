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
    <main className="gb min-h-dvh bg-background px-5 py-8 sm:px-8 sm:py-10" role="status" aria-live="polite">
      <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="hidden flex-col gap-3 lg:flex">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-2 h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="flex min-w-0 max-w-4xl flex-col gap-8">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-9 w-52" />
            <Skeleton className="h-5 w-full max-w-xl" />
          </div>
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
      <span className="sr-only">Loading your settings</span>
    </main>
  );
}
