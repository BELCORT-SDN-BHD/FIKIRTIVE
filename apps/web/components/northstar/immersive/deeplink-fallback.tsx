import { Skeleton } from "@/components/ui/skeleton";

/**
 * 北极星 · 沉浸式深链详情页骨架(hard-load / 软导航过渡时的 Suspense fallback）
 *
 * searchParams 详情页(asset-viewer / media-editor / campaign detail / schedule composer）
 * 直开或刷新时,内容组件走 useSearchParams —— 必须被 <Suspense> 包着。此前 fallback={null}
 * 让硬加载在解析前是一整块空白;换成这个轻骨架:直开也先有版面,参数到达即被真实内容替换。
 *
 * 纯 markup、零 client hook —— 可被 Server Component 页直接引用。骨架走 `ui/skeleton`,
 * 不手搓 `animate-pulse` 的 div(W2-12 #997,规格书 §5.6 ③)。
 */
export function DeepLinkFallback() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8" aria-hidden>
      <Skeleton className="h-4 w-24" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Skeleton className="aspect-video w-full rounded-2xl" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-9 w-full rounded-xl" />
          <Skeleton className="h-9 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
