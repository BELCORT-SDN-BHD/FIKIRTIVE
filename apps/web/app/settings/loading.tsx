import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/settings` 的等待画面。
 *
 * 页面是 Server Component,要先读完账户与余额才吐第一个字节;没有这个文件的话浏览器在这段
 * 时间里什么都拿不到。骨架走 `components/ui/skeleton`,不再手搓一份 `animate-pulse` 的 div
 * (规格书 §5.6 ③ —— 手搓那些正是走查点名的一类:一份配方散在七八个文件里)。
 *
 * 第⑦段(FRONT-A11):骨架跟着 `SettingsShell` 的新几何走 —— 页头一整条在最上面、左轨
 * 220px、内容列 `max-w-2xl`。骨架和真页面对不上,加载完就会跳一下。
 */
export default function SettingsLoading() {
  return (
    <main
      className="gb flex h-full min-w-0 flex-col overflow-hidden bg-background"
      role="status"
      aria-live="polite"
    >
      <div className="shrink-0 border-b border-border px-5 py-6 sm:px-7">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-3 h-4 w-56" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="shrink-0 border-b border-border px-4 py-6 lg:w-[220px] lg:border-b-0 lg:border-r">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-3 h-10 w-full" />
          <Skeleton className="mt-7 h-4 w-24" />
          <Skeleton className="mt-3 h-10 w-full" />
          <Skeleton className="mt-1 h-10 w-full" />
          <Skeleton className="mt-1 h-10 w-full" />
        </div>
        <div className="flex min-w-0 flex-1 overflow-y-auto px-5 sm:px-7">
          <div className="mx-auto w-full max-w-2xl py-8">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-9 w-full" />
            <Skeleton className="mt-2 h-4 w-80" />
            <Skeleton className="mt-7 h-9 w-32" />
          </div>
        </div>
      </div>
      <span className="sr-only">Loading your settings</span>
    </main>
  );
}
