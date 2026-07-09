/**
 * 北极星 · 沉浸式深链详情页骨架(hard-load / 软导航过渡时的 Suspense fallback）
 *
 * searchParams 详情页(asset-viewer / media-editor / campaign detail / schedule composer）
 * 直开或刷新时,内容组件走 useSearchParams —— 必须被 <Suspense> 包着。此前 fallback={null}
 * 让硬加载在解析前是一整块空白;换成这个轻骨架:直开也先有版面,参数到达即被真实内容替换。
 *
 * 纯 markup、零 client hook —— 可被 Server Component 页直接引用。
 */
export function DeepLinkFallback() {
  return (
    <div className="mx-auto w-full max-w-[1100px] animate-pulse px-6 py-8" aria-hidden>
      <div className="h-4 w-24 rounded bg-muted" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="aspect-video w-full rounded-2xl bg-muted" />
          <div className="h-5 w-2/3 rounded bg-muted" />
          <div className="h-4 w-1/2 rounded bg-muted" />
        </div>
        <div className="space-y-3">
          <div className="h-9 w-full rounded-xl bg-muted" />
          <div className="h-9 w-full rounded-xl bg-muted" />
          <div className="h-24 w-full rounded-xl bg-muted" />
        </div>
      </div>
    </div>
  );
}
