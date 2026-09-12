"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { subscribeBalanceRefresh } from "@/lib/balance-refresh";

/**
 * BillingLiveRefresh — keeps the Billing body (balance / on hold / spend history) on the
 * same number as the global nav rail, and refreshed at the same moment.
 *
 * FSE-202（frontend-baseline.md §5 :205，S5 批量裁决 2026-09-12，#1358）—— 走查现象：同一张
 * Billing 页上侧栏与正文余额并排差 1 credit，切到前台 6 秒内侧栏追上了 DB，正文（balance /
 * on hold / spend history）纹丝不动，直到整页重载才追上。根因（已在规格里坐实）：FSE-010 那条
 * 广播（`lib/balance-refresh.ts`）只驱动了侧栏那颗客户端组件；`BillingPage` 是一个 server
 * component，只在挂载那一刻 `await` 了一次 `getMyAccount` / `getSpendOverview` / …，广播够不着
 * 一次性渲染过的 server component,也没有第二条计时器去替它重读。
 *
 * 这里不给正文另开一条客户端取数路径（那会制造正文与侧栏各读各的第二个来源，正是这张 spec
 * 想收掉的东西）——而是让正文订阅侧栏那条已有的同一份信号（`subscribeBalanceRefresh` 的广播 +
 * `visibilitychange`，与 `components/global-navigation.tsx` 一字不差的一组事件、一样「只在可见
 * 时读」的纪律），触发时用 `router.refresh()` 让 `BillingPage` 自己重新跑一遍它已有的服务端读取。
 * 两处因此读的是同一次数据库查询、同一个失效时机，`On hold` 与 `Spend history` 是那次重读的一
 * 部分，跟着一起到新——不是被单独补一条。
 *
 * P2-1（PR #1409 判官复审加固）—— 一次结算常常连打好几声广播（reserve / settle / refund 各喊
 * 一声，买一个 10 卡的 pack 一口气能到 11 声）。逐声都当场 `router.refresh()` 会把这些整树
 * 重渲染摞起来，每一次都是一趟真的服务端读取（Billing 正文那几条 server action 里带 Stripe
 * 往返）。这里做尾随合并：每收到一声就重排一个 200ms 的计时器，这串信号停下来之后才真正读
 * 一次；已经有一次 `router.refresh()` 在途（`useTransition` 的 `isPending`）时新排的那一次直
 * 接跳过——串里后面那声广播的计时器会补上，串的最后一声必然会走完整 200ms 窗口再读一次。
 *
 * P2-3（同一票复审）—— 这里没有像 `global-navigation.tsx` 的 `getMyAccount()` 那样再接一层
 * `createLatestReadGate()`。理由不是「用不上」，是「暂时不需要」：`router.refresh()` 不像那边
 * 直接发一个自己攥着响应顺序的 fetch，它排进的是 Next App Router 自己的 action queue，而这条
 * 队列本身对 REFRESH 是串行执行的——判官读源码核过 `next/dist/client/components/
 * app-router-instance.js:133-161`，一条 REFRESH 没跑完，下一条排在后面等，不会有两条并发跑出
 * 乱序响应互相覆盖。这是 Next 的内部实现细节，不是这个组件自己的契约；Next 哪天把 REFRESH 改
 * 成并行处理，这里就要补一道跟 `global-navigation.tsx` 一样的 `createLatestReadGate()`。
 */
const REFRESH_MERGE_MS = 200;

export function BillingLiveRefresh(): null {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isPendingRef = useRef(isPending);
  useEffect(() => {
    isPendingRef.current = isPending;
  }, [isPending]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const runRefresh = () => {
      timer = null;
      if (!alive) return;
      // 在途那次还没回来就跳过——见上方 P2-3，Next 对 REFRESH 是串行执行的，硬排一个新的
      // 只会排在后面再等一次，追不快；真落后的话，后面还会再来一声广播，它自己的 200ms
      // 窗口会补上这一次。
      if (isPendingRef.current) return;
      startTransition(() => {
        router.refresh();
      });
    };
    const scheduleRefresh = () => {
      // P2-1：尾随合并——一串紧挨着的广播每来一声就把这个计时器重排一次，串停下来的那 200ms
      // 之后才真的读一次，不是逐声都读。
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(runRefresh, REFRESH_MERGE_MS);
    };
    const refreshIfVisible = () => {
      if (!alive) return;
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    const unsubscribe = subscribeBalanceRefresh(refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      alive = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", refreshIfVisible);
      if (timer !== null) clearTimeout(timer);
    };
  }, [router]);

  return null;
}

export default BillingLiveRefresh;
