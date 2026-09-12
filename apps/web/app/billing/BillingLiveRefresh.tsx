"use client";

import { useEffect } from "react";
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
 */
export function BillingLiveRefresh(): null {
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    const refreshIfVisible = () => {
      if (!alive) return;
      if (document.visibilityState === "visible") router.refresh();
    };
    const unsubscribe = subscribeBalanceRefresh(refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      alive = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [router]);

  return null;
}

export default BillingLiveRefresh;
