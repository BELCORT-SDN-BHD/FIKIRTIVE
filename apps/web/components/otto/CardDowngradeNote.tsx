"use client";

/**
 * CardDowngradeNote —— 「你要的那件事我给不了」那一句,**一份**。
 *
 * ── 为什么它存在(复审 P1-A,2026-09-15)────────────────────────────────────────
 *
 * #580 立的规矩是「降级永不静默」,可那一句从前只长在 `OttoPlanCard`(抽屉里那张卡,
 * 画布布局下默认折起)。而 FC-4 那 33 credits 是在**画布**上丢的:商家点名要那张图当首帧、
 * 片子里又有 @ 到的演员 ⇒ 服务端如实把角色换成参考图并写下那一句,可他面前的
 * `OttoTurnCard` 从来不读 `downgraded`/`downgradeNote` —— 他在这张卡上按下
 * `Generate · N credits` 之前一个字都读不到。整包那张 `PackCard` 同理,连回执都没有。
 *
 * 三张卡同一个 `cardId`、同一条钱路(`runPlanApproval`),所以披露也必须是同一句。
 * 与 `CardReferenceReceipt` 同一条理由:抄成三份,哪天一份先烂掉,商家在三个地方读到的
 * 就是三件事 —— 而先烂掉的那一份恰好是他真正在看的那张卡。
 *
 * 这里只渲染,不判断:什么算降级、那句话怎么写,都由服务端那张 payload 说了算
 * (`packages/otto/src/skills/propose.helpers.ts`)。
 *
 * 披露 ≠ 拦截:Founder 的规矩是**批准之前说出来**,不是拒绝批准。所以这一块从不碰
 * `planCardGate.approvable` —— 商家读完那一句,仍然可以决定照做。
 */

import { cn } from "@/lib/utils";

/** Fallback disclosure for a card that is flagged downgraded but predates the
 *  server-built note — silence is the one thing this state may never be. */
export const DOWNGRADE_FALLBACK_NOTE =
  "Some of what you asked for isn't available here — the details above are what you'll get.";

export function CardDowngradeNote({
  downgraded,
  note,
  className,
}: {
  /** 服务端那张卡自己认不认这件事。`false`/缺席 ⇒ 一个字都不说(不许拿降级染没降级的卡)。 */
  downgraded?: boolean;
  /** 服务端写下的那一句。老卡没有它时退回 `DOWNGRADE_FALLBACK_NOTE` —— 可以少一句精确,
   *  不可以一个字都不说。 */
  note?: string;
  /** 只给间距用,三张卡各自的排版不同;颜色与字号是这一句的身份,不从外面改。 */
  className?: string;
}) {
  if (!downgraded) return null;
  return (
    <div className={cn("text-[0.75rem] leading-4 text-[var(--warning-soft-foreground)]", className)}>
      {note || DOWNGRADE_FALLBACK_NOTE}
    </div>
  );
}

export default CardDowngradeNote;
