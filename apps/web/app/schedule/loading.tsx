import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/schedule` 这一段的等待画面。
 *
 * 用 `ui/skeleton` 而不是再手搓一个自己闪的灰方块(规格书 §5.6 ③ / §7.1 shadcn 那条):
 * 骨架的配方只有一份,不然每加一页就多一种「还在加载」的画法。
 *
 * R3-F10:它今天**唯一**的用户是墙外那张公开分享页 `share-preview` —— `/schedule` 与
 * `/schedule/analytics` 都是停放旧地址,已经改成 Route Handler(`route.ts`),压根不进渲染,
 * 也就不再被这层 Suspense 边界挡成 HTTP 200 + 一屏骨架(理由全文在
 * `lib/parked-route-redirect.ts`)。留着它不是遗留:分享链接是冷启动打开的,没有这一层就是
 * 一屏白。搬去 `share-preview/loading.tsx` 与留在这里今天逐像素等价,所以不搬 —— 那会是一次
 * 没人要求的改动。下一次有人往 `/schedule/` 下面加一条只做 `redirect()` 的 `page.tsx`,
 * 这层边界会把它压回 200 + 骨架;`lib/__tests__/route-redirects.test.ts` 的 R3-F10 那组当场红。
 *
 * (它画的是**商家排期日历**的形状,而今天看见它的是墙外的评审者 —— 那是一处早于本票、
 * 本票不碰的文案不合身。)
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
