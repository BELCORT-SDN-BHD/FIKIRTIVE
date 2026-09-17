"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { coworkVaryCard } from "@/lib/cowork-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";

/**
 * 「再来一张」这件事的**唯一**一份回执合同（R3-F29）。
 *
 * 同一个服务端动作（`coworkVaryCard`）今天挂在两颗键上：结果卡上的「Make another」
 * （`OttoResult.tsx`）与失败卡上的「Try again」（`OttoPlanCard.tsx`）。从前两处各写各的
 * 回执：前者转圈、亮「Added」两秒半、出错给一句人话；后者**什么都不设** —— 服务端 200、
 * 对话里真的多了一张卡，可屏幕上一个字都没变。staging c0d25917（2026-09-17）走查里商家
 * 因此一分钟按一次、连按四次，拿到四张一模一样的克隆卡。
 *
 * 两份合同就是这么烂的（§7.3）：抄成两份，必有一份先忘了改。所以这里把「在飞 / 加好了 /
 * 没成」三种回执连同它们的字与时长收成一处，两颗键读同一份。
 *
 * **这条路不动钱**：`coworkVaryCard` 只把旧卡的 payload 原样克隆成一张**未生成**的新卡
 * （`apps/web/lib/cowork-actions.ts` 的 `coworkVaryCard`：无 startGen、无 GenJob、无排队、
 * 无账本行；staging 那四次按压实测 0 条 GenJob、0 条 CreditLedger）。真正扣钱的是商家随后
 * 在那张新卡上按下的 Generate，走它自己那把 `cowork:<新卡 id>` 幂等键。
 */

/** 「Added」在屏幕上留多久（毫秒）。两处同一段时长 —— 两颗键不该一颗闪一颗停。 */
export const VARY_CONFIRM_MS = 2500;
/** 在飞时按钮上的字。 */
export const VARY_BUSY_LABEL = "Queuing…";
/** 成交之后按钮上的字。 */
export const VARY_ADDED_LABEL = "Added";
/** 成交之后按钮下面那一行人话（`role="status"`，读屏也听得见）。 */
export const VARY_ADDED_NOTE = "Added another card to this conversation.";
/** 连服务端都没够着时的那句人话（服务端自己说得出原因时就用它那句）。 */
export const VARY_FAILED_NOTE = "Couldn't queue another — please try again.";

/** 一次按压的结果。`null` = 这一下落在飞行途中，原地不动。 */
export type VaryOutcome = { ok: true } | { error: string };

export interface VaryCardFeedback {
  /** 这一下还在飞：按钮该禁用、该写 `VARY_BUSY_LABEL`。 */
  busy: boolean;
  /** 刚成交，确认还在屏幕上（`VARY_CONFIRM_MS` 之后自己收起来）。 */
  added: boolean;
  /**
   * 送一张克隆卡出去。**已经在飞就返回 `null`**：不打第二趟，因此不会再多一张克隆卡 ——
   * 判据是一个 ref 而不是 `busy` 这个 state，同一帧里连按两下时 state 还没换过来。
   */
  run: (cardId: string) => Promise<VaryOutcome | null>;
}

export function useVaryCard(): VaryCardFeedback {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const inFlight = useRef(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
    },
    [],
  );

  const run = useCallback(async (cardId: string): Promise<VaryOutcome | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    setAdded(false);
    if (confirmTimer.current !== null) {
      clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
    try {
      const res = await coworkVaryCard({ cardId });
      if (res && "error" in res) return { error: res.error };
      setAdded(true);
      confirmTimer.current = setTimeout(() => {
        confirmTimer.current = null;
        setAdded(false);
      }, VARY_CONFIRM_MS);
      return { ok: true };
    } catch {
      return { error: VARY_FAILED_NOTE };
    } finally {
      inFlight.current = false;
      setBusy(false);
      // 余额那一声留着，但**理由换了**：这条路自己不动钱（见上面的模块说明），所以它不是
      // 「结算完成」的宣告，而是保守的一侧 —— 这颗键与真正会扣钱的 Generate 长在同一张卡面上，
      // 多读一次余额最多白跑一趟。`lib/__tests__/spend-visibility-seams.test.ts` 的 SPEND_ACTIONS
      // 今天仍把 `coworkVaryCard` 算作付费入口（那张网是钱的围栏，不在本票写集）。
      notifyBalanceRefresh();
    }
  }, []);

  return { busy, added, run };
}
