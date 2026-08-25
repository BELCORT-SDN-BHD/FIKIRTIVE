/**
 * `/billing` 的等待画面 —— 此前**整个不存在**。
 *
 * 这一页是 `force-dynamic`,而且一次 `Promise.all` 三路读:账户、credit pack 货架、消费总览。
 * 三路里最慢的那一路决定商家要等多久,这段时间里没有任何回应 —— 它还是侧栏
 * 「Billing & credits」直接指过来的一扇门(`merchantNavLinks()` 里有它)。
 *
 * 这一页的版式写在 inline style 上,没有一份可以复用的 class(它是换壳前的写法,不在 R22
 * 的 CSS 体系里)。所以这里只能把那几个数字照抄一遍:`maxWidth 560 / margin 0 auto /
 * padding 24`、h1 30px、副标题 16px 距顶 6px 距底 24px —— 与 `page.tsx` 逐个对齐。
 * 抄来的数字会漂移,所以真要根治得等这一页也进 R22 的 CSS 体系;在那之前,有一张形状对的
 * 等待画面,好过一段什么都没有的空白。
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function BillingLoading() {
  return (
    <div
      className="gb"
      data-r22-skeleton
      role="status"
      aria-busy="true"
      style={{ flex: 1, overflow: "auto", minHeight: "100dvh", padding: 24 }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <Skeleton style={{ height: 36, width: 156 }} className="rounded-[8px]" />
        <Skeleton style={{ height: 20, width: 288, marginTop: 8, marginBottom: 24 }} className="rounded-[6px]" />

        {/* 余额那张卡 */}
        <Skeleton style={{ height: 108 }} className="w-full rounded-[var(--radius-card)]" />

        {/* credit pack 货架 */}
        <Skeleton style={{ height: 20, width: 132, marginTop: 28 }} className="rounded-[6px]" />
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          {[0, 1, 2].map((pack) => (
            <Skeleton key={pack} style={{ height: 76 }} className="w-full rounded-[var(--radius-card)]" />
          ))}
        </div>

        {/* 消费记录 */}
        <Skeleton style={{ height: 20, width: 116, marginTop: 28 }} className="rounded-[6px]" />
        <Skeleton style={{ height: 220, marginTop: 12 }} className="w-full rounded-[var(--radius-card)]" />
      </div>
      <span className="sr-only">Loading billing and credits</span>
    </div>
  );
}
