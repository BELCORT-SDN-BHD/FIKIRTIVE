"use client";

/**
 * CardApprovalRef —— 一次失败的批准旁边那个**可复制的短号**,一份。
 *
 * ── 为什么它存在(Codex staging 走查 CRE-STG-P2-004,2026-09-04)────────────────
 *
 * 走查按下 `Generate · 1 credit` 两次,两次都读到同一句话,而那句话「gives no reason,
 * incident ID, or safe recovery action」。三方 —— 商家的屏幕、服务器日志、走查报告 ——
 * 没有一个共同的把手,所以谁都没法把这三件事对起来。
 *
 * 这一块就是那个把手,而且它刻意只是**一个短号**:
 *   · 号码由那次动作**自己的身份**算出来(`diagnosticRef(cardId)`),不是新造的 id ——
 *     一次失败的批准恰恰是「什么都没存下来」的那一刻,新 id 没有地方可存;
 *   · 服务端在 `console.error` 里写的是同一串(同一个函数算的),所以支持那一侧搜得到;
 *   · 号码之外一个字都不多说:原因是那句人话的活(措辞的单一权威在 `gen-failure.ts`),
 *     而 URL、路径、堆栈、引擎名一律不上商家的屏幕。
 *
 * 它长在卡面那块**持久**的错误位里,不是 toast —— 走查报告特别记了一句「not reliably
 * persistent」:一个看得见三秒的号码等于没有号码。
 *
 * 两张卡(聊天里的 `OttoPlanCard`、画布上始终可见的 `OttoTurnCard`)读的是这一个组件:
 * 抄成两份,哪天一份先烂掉,商家在两个地方读到的就是两件事。
 */

export function CardApprovalRef({ refId }: { refId: string | null }) {
  if (!refId) return null;
  return (
    <span className="mt-1 block text-[0.6875rem] opacity-80">
      Reference <code className="font-mono select-all">{refId}</code> — quote this if you ask us about it.
    </span>
  );
}

export default CardApprovalRef;
