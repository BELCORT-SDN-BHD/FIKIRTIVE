import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/settings/connections` 的等待画面。
 *
 * 第⑦段(FRONT-A11)判官 [P2-2]:这份骨架原本还画着换皮**前**的外壳 —— 整页滚、
 * 定宽居中、两栏 grid、四张 Card。真页面已经搬到 `SettingsShell` 的新几何上
 * (页头一整条在最上面、左轨 220px、内容列自己滚),骨架和真页面对不上,加载完就会跳一下,
 * 而这一跳正好发生在商家第一眼看这一面的时候。
 *
 * 所以这里照 `app/settings/loading.tsx` 的形状改。唯一的差别在内容列:`/settings` 的表单
 * 是 `max-w-2xl` 窄列,而 Connections 的服务列表是**整宽** `py-8`(见 `connections/page.tsx`),
 * 骨架跟着它走,不去替那一面收窄。
 */
export default function ConnectionsLoading() {
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
          <div className="w-full py-8">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="mt-2 h-4 w-72 max-w-full" />
            <div className="mt-5 flex flex-col gap-5">
              {["one", "two", "three"].map((key) => (
                <div key={key} className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-lg" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-44 max-w-full" />
                  </div>
                  <Skeleton className="h-9 w-20" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only">Loading your connections</span>
    </main>
  );
}
