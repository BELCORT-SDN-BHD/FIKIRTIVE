"use client";
import React, { useState, useEffect } from "react";
import { formatElapsed, QUEUE_WAIT_NOTE } from "@/lib/progress-format";
import { ChevronDown, ClipboardList, Film, Image as ImageIcon, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { coworkVaryCard, cancelGenJob } from "@/lib/cowork-actions";
import { CHAT_SPEND_NOTE, creditsLabel } from "@/lib/credit-format";
import { ErrorWithTopUp } from "@/components/exits/Exits";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { type ChainedApproval } from "./approval-chain";
import { runPlanApproval } from "./plan-approval";
import { CardApprovalRef } from "./CardApprovalRef";
// Founder 2026-09-05「加进确认卡」—— 三格控件(张数／形状／精修)。两张确认卡共用这一份,
// 抄成两份必有一份先烂(改了什么、按什么价,两处会各说各的)。
// 清单 A5(P2-013)—— 「Change something」那张小表单与它送回对话的那句话,同住一处
// (哪一格能就地改的判据只有一份)。
import { CardChangeForm, CardOptionControls, cardSpecChips, changeRequestSeed } from "./CardOptionControls";
import { runStateOfCard } from "@/lib/otto-status-helpers";
import type { EntityDTO } from "@/lib/types";
import type { CardState } from "@/lib/otto-inject-helpers";
// The ONE contract layer: runtime parse + the ONE price-guarantee predicate. The render
// gate and approve() both read this — they cannot disagree any more (#580 复审 r2 P1-1).
import { guaranteedCredits, planCardGate, type OttoPlanCardPayload } from "./plan-card-contract";
// Codex QA-CRE-FE9-013 —— 参考回执那一块。两张确认卡共用这一份,抄成两份必有一份先烂。
import { CardReferenceReceipt } from "./CardReferenceReceipt";
// #774 判官 r2 P1 —— 卡上那行「引擎会被告知这些照片是谁」的措辞,与真正送出去的名字
// 共用同一个纯函数(同一把长度尺),所以卡说的不可能比做的多。走**子路径**而不是包根:
// `@fikirtive/core` 的桶文件带出 `node:crypto`(hash.ts),那会被拖进客户端包。
import { approvedEntitiesNote } from "@fikirtive/core/reference-budget";
// #996 (W2-9): 面板最窄 320px。版式跟着卡自己那只盒子走(容器查询),不跟视口走;
// 每一个 credits 数字走 CardMoney —— 句子可以换行,数字不行。
import { CardMoney, CARD_ACTIONS_CLASS, CARD_ROOT_CLASS, CARD_SPLIT_ROW_CLASS } from "./card-narrow";

/** What a successful approve hands up. Carries the EXACT card it happened on plus the
 *  SERVER's own result — the parent never has to infer either from a closure or from a
 *  module-level broadcast (#580 复审 r1 P1-4). */
export interface PlanApproveOutcome {
  /** The card the merchant actually clicked. */
  cardId: string;
  /** The resume parked again (chained needs_approval) and this is the server's COMPLETE
   *  still-pending set; null when this resume ran to completion. */
  chained: ChainedApproval | null;
}

export interface OttoPlanCardProps {
  cardId: string;
  payload: unknown;
  entities: EntityDTO[];
  threadId: string;
  projectId: string;
  /** The generation job id — present once the card is approved and a job is queued. */
  genJobId?: string | null;
  cardState: CardState;
  pendingApproval: boolean;
  /** Called after a successful approve, with the exact card id and the server's result
   *  (#498 round-4 chained needs_approval rides along so the parent can mark the new
   *  card ids pendingApproval and render them). */
  onApproved: (outcome: PlanApproveOutcome) => void;
  /**
   * 「Change something」那张小表单按下 Send 之后走的那一条路（清单 A5 / P2-013）。
   *
   * 收到的是**商家写的那句话连同这张卡的原话**（`changeRequestSeed` 拼的那一份），
   * 调用方照旧把它放进输入框 —— 仍是从前那**一条**对话路，没有第二条。
   */
  onChangeSomething: (seed: string) => void;
  /**
   * 商家在这张卡上改完三格之后，服务端重铸出来的**整张卡**（复审 r1 P1-1）。
   *
   * 它必须往上走,不能停在这个组件里:同一个 cardId 今天有两处确认位(这张抽屉卡、画布上
   * 那张 `OttoTurnCard`),画布形态下抽屉只是 CSS 隐藏而非卸载 —— 两处各留一份「重铸后的
   * payload」,就是同一张卡上一处写着新价、另一处仍按旧价出按钮。批准请求不带价(服务端
   * 从库里那张卡重建),所以陈旧那一侧按下去照旧按新价预扣。唯一的收口是让两处读**同一份**
   * payload:父组件改写这条消息的 metadata.payload,两张卡下一帧一起换。
   */
  onOptionsChanged: (cardId: string, payload: unknown) => void;
  /** Called after a fresh-card retry spawns a new card (failed state only). */
  onRetry?: () => void;
  /** Called after a successful cancel + refund so the parent can refresh. */
  onCancelled?: () => void;
}

/** Fallback disclosure for a card that is flagged downgraded but predates the
 *  server-built note — silence is the one thing this state may never be. */
export const DOWNGRADE_FALLBACK_NOTE =
  "Some of what you asked for isn't available here — the details above are what you'll get.";

/** Shown instead of a plan when the durable payload can't be read as one, or carries no
 *  price we can vouch for. Never a blank card and never a guessed price: a plan with no
 *  guaranteed price is not approvable. */
export const UNREADABLE_PLAN_NOTE =
  "I can't read this plan any more — ask me to put it together again and I'll make a fresh one.";

/** Shown when SOME fields of an otherwise readable plan were malformed. The card is
 *  incomplete, so it is disclosed AND withheld from approval — a card that admits it
 *  didn't read itself fully must not be the one the merchant pays on (r2 P1-2). */
export const PARTIAL_PLAN_NOTE =
  "Some details of this plan didn't come through, so I won't run it as it stands — ask me to put it together again and I'll make a fresh one.";

/** The plan card — Otto's "Here's what I'll make" with the one total and the approve gate.
 *  Approve resumes the parked generate via ottoApprove (the metered spend path). */
export function OttoPlanCard({
  cardId,
  payload,
  threadId,
  genJobId,
  cardState,
  pendingApproval,
  onApproved,
  onChangeSomething,
  onOptionsChanged,
  onRetry,
  onCancelled,
}: OttoPlanCardProps) {
  // ONE gate for this card: runtime parse at the DTO boundary (no `as` cast) plus the
  // ONE price-guarantee predicate. Everything below — what renders, and whether approve()
  // may spend — reads this same object, so the display and the spend can't disagree
  // (#580 复审 r1 P1-1 / r2 P1-1).
  // Founder 2026-09-05「加进确认卡」—— 改完三格之后服务端重铸的那张卡不停在这里:它顺着
  // `onOptionsChanged` 走回父组件,写进这条消息的 metadata.payload,再从 `payload` 这个
  // prop 流回来。所以两处确认位读的是同一份,库里那一份永远压过手里这一份(复审 r1 P1-1)。
  const gate = planCardGate(payload);
  const p: OttoPlanCardPayload = gate.value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Codex staging CRE-STG-P2-004 —— 失败那一句旁边的可复制短号(服务端日志里是同一串)。
   *  与 `error` 同生同灭:它不是一条独立的状态,而是那一次失败的一部分。 */
  const [errorRef, setErrorRef] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "no-api">("idle");
  /** 清单 A5(P2-013)—— 「Change something」那张小表单开着没有。默认关:卡面第一眼
   *  是「要不要买」,不是「怎么改」。 */
  const [changeOpen, setChangeOpen] = useState(false);
  /** #498: set when THIS approve's resume parked again on more approvals (chained
   *  needs_approval) — the story didn't end with this card, and hiding that is the
   *  same silent death one click deeper. Holds the SERVER's localized receipt
   *  (fallbackReply) verbatim; null when no chained pause was observed OR the model
   *  narrated its own text (round-5: the parent injects that narration into the
   *  chat live via its narrationMessageId — see pollAndInjectResults). */
  const [chainedReceipt, setChainedReceipt] = useState<string | null>(null);

  useEffect(() => {
    if (cardState !== "working") {
      queueMicrotask(() => setElapsed(0));
      return;
    }
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [cardState]);

  const isVideo = p.kind === "video";
  // The one number the merchant decides on — the real charge in CREDITS (= what startGen
  // reserves). There is no USD→credits fallback any more: the record-only engine cost
  // divided by $0.10 was never a quote, and guessing one is how an unpriced card got an
  // approve button (#580 复审 r2 P1-1). Guaranteed or absent, nothing in between.
  const credits = gate.credits;
  // The follow-on video estimate rides the SAME predicate — an estimate we can't vouch
  // for is not shown as a number, so the two-step total is never half-guessed.
  const videoCredits = guaranteedCredits({ estimatedCredits: p.videoStep?.estimatedCredits });
  const isTwoStep = !isVideo && videoCredits !== null;
  // 清单 A5（P2-013）—— 供应商提示词（seedream/seedance 那段送去执行的原话）。它住在
  // 下面的 Advanced details 里（默认收起），不再占着卡面主视图的第一行。老卡没有它就
  // 整块不出现：这一块只念卡上真有的那段字，绝不编一句“A short video”充数。
  const providerPrompt = p.structuredPrompt ?? "";
  // The spec the merchant reads, built server-side from what execution really honours.
  // The card renders it VERBATIM — it derives no spec of its own any more, because two
  // derivations of one fact is exactly how the card came to promise things the
  // generator never received (#580 复审 r1 P1-2).
  // 终检 r4：精修那一格补在末尾（`cardSpecChips`，与开关共用一个名字）—— 打开精修价会变,
  // 规格条不说它,商家就看得见贵了却看不出贵在哪。它不参与算钱。
  const specChips = cardSpecChips(p);
  const referenceNamesNote = approvedEntitiesNote(p.approvedEntities ?? []);
  // The card's honest run state. `working` maps to "queued": the card knows a job was
  // created, not that it started — so it must not say "making this now" (P1-3).
  const runState = runStateOfCard(cardState);

  // Two ways this card can know it was stopped, and it needs both (#602 T3). The local flag is
  // this press, right now, before any durable message exists; `runState` is the DURABLE answer,
  // which is what a reload — or another tab — has to go on. Only the local one existed before, so
  // the cancelled face survived exactly until the page was refreshed, and then the same card came
  // back red with a "Try again" button on it.
  const [locallyCancelled, setLocallyCancelled] = useState(false);
  const cancelled = locallyCancelled || runState === "cancelled";
  // 这一刻卡上是不是真的渲染着那三格。小表单据此决定说不说那句指路话 —— 它自己不重判
  // 一遍（重判就是第二份判据），而 `CardOptionControls` 在没有 `options` 时自己返回 null。
  const optionsOnCard = runState === "waiting" && !cancelled && gate.approvable && !!p.options;

  async function cancel() {
    if (!genJobId || busy || cancelled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await cancelGenJob({ jobId: genJobId });
      if (!res || "error" in res) { setError("error" in res ? res.error : "Couldn't cancel."); return; }
      if ("alreadyStarted" in res) {
        setError("It already started — can't cancel at this point.");
        return;
      }
      setLocallyCancelled(true);
      onCancelled?.();
    } catch {
      setError("Couldn't cancel — please try again.");
    } finally {
      setBusy(false);
      // In a finally on purpose (#550): a successful cancel REFUNDS the hold, and an
      // "already started" or transport failure leaves the outcome unknown — either way the
      // displayed balance can no longer be trusted.
      notifyBalanceRefresh();
    }
  }

  async function retry() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await coworkVaryCard({ cardId });
      if (res && "error" in res) { setError(res.error); return; }
      onRetry?.();
    } catch {
      setError("Couldn't queue a retry — please try again.");
    } finally {
      setBusy(false);
      // coworkVaryCard queues a NEW paid generation; a transport failure cannot prove it
      // didn't reserve, so announce on every exit (#550).
      notifyBalanceRefresh();
    }
  }

  /** The merchant's approval, in ONE press (#896). The button carries the price, so the
   *  press IS the approval — there is no second "are you sure" screen showing the same
   *  number a second time. Everything money-shaped below is untouched: same approval
   *  chain, same idempotency, same server actions, same fail-closed gate.
   *
   *  THE ACTION ITSELF lives in `plan-approval.ts` now, because the canvas's always-visible
   *  Otto card carries a second Generate button for the same card (走查 P0-3) and two copies
   *  of a spend path is exactly how one of them drifts (§7.3). This function keeps the gate,
   *  the busy flag and the wording; the spend is that one shared call. */
  async function approve() {
    // Fail closed on the SAME gate the render used: a plan we couldn't read, couldn't
    // price, or couldn't read in full renders no approve button — and may not start a
    // spend either, whatever path got here.
    if (busy || cardState !== "idle" || !gate.approvable) return;
    setBusy(true);
    setError(null);
    setErrorRef(null);
    const outcome = await runPlanApproval({ threadId, cardId, pendingApproval, payload: p });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error);
      setErrorRef(outcome.ref);
      return;
    }
    // #498 P1b (round-4): an ottoApprove resume can park AGAIN on further
    // approval(s). Surface the server's localized receipt here, and hand the
    // chained card ids UP via onApproved so the parent marks them
    // pendingApproval and renders them — their clicks must resume the RunState
    // (ottoApprove), never coworkGenerate. (This card's own generation DID
    // start; onApproved stays correct either way.)
    //
    // #591 / P1-4: the parked step-trace above also has to stop asking for a click
    // that already happened — but it learns that from the parent's NEW pending set
    // (derived from `chained` right here), not from a module-level broadcast that
    // hid every waiting panel on the page.
    if (outcome.chained) setChainedReceipt(outcome.chained.fallbackReply);
    onApproved({ cardId, chained: outcome.chained });
  }

  function handleCopy() {
    if (!p.structuredPrompt) return;
    if (!navigator.clipboard) {
      setCopyState("no-api");
      return;
    }
    navigator.clipboard.writeText(p.structuredPrompt).then(
      () => {
        setCopyState("copied");
        setTimeout(() => setCopyState("idle"), 2000);
      },
      () => {
        setCopyState("no-api");
      }
    );
  }

  /**
   * 「Change something」—— 清单 A5(P2-013)之后它开的是**卡上那张小表单**,不再是
   * 「把供应商提示词整段塞回输入框」。从前那一下把一坨机器措辞丢给商家自己改,而他
   * 真正想改的(形状、时长、声音、参考)在那段字里根本认不出来。
   */
  function handleChangeSomething() {
    setChangeOpen((open) => !open);
  }

  /** 表单按下 Send:商家那句话连同这张卡的原话,走**既有**那一条对话路。 */
  function submitChange(note: string) {
    setChangeOpen(false);
    onChangeSomething(changeRequestSeed(note, p));
  }

  /** 读不懂 / 读不全的卡上那颗「Ask again」—— 那种卡没有可改的一格,照旧把原话送回去。 */
  function handleAskAgain() {
    onChangeSomething(p.structuredPrompt ?? "");
  }

  // A payload we can't read (or can't price) is disclosed as such. It never renders as a
  // plan with a guessed price and an approve button next to it.
  // `credits === null` is redundant with `!gate.readable` at run time — it is spelled out
  // so the compiler narrows `credits` to a number for the whole render below, instead of
  // being talked past with a `!`.
  if (!gate.readable || credits === null) {
    return (
      <div className={CARD_ROOT_CLASS} style={{ maxWidth: 480 }}>
        <div className="rounded-[14px] border border-border bg-secondary p-[13px]">
          <div className="mb-[9px] flex items-center gap-[7px]">
            <ClipboardList size={15} className="text-muted-foreground" />
            <span className="text-[0.8125rem] font-bold text-foreground">A plan I can&rsquo;t read</span>
          </div>
          <div className="text-[0.8125rem] text-muted-foreground">{UNREADABLE_PLAN_NOTE}</div>
          <div className="mt-3">
            <Button variant="secondary" size="sm" className="rounded-[11px]" onClick={handleAskAgain}>
              Ask again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className={CARD_ROOT_CLASS} style={{ maxWidth: 480 }}>
      {/* Card variant="tint": bg-accent (--brand-tint=#F4F4F3), border, rounded-[18px], p-6 */}
      <div className="rounded-[14px] border border-border bg-secondary p-[13px]">
        <div className="mb-[9px] flex items-center gap-[7px]">
          <ClipboardList size={15} className="text-foreground" />
          <span className="text-[0.8125rem] font-bold text-foreground">
            Here&rsquo;s what I&rsquo;ll make
          </span>
        </div>

        <div className="flex items-start gap-[9px] rounded-[14px] bg-card px-[14px] py-3">
          {/* Icon avatar: --brand-soft in .fk.gb-skin = #ECECEA (neutral) → bg-accent; --on-brand-soft = ink → text-foreground */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-accent text-foreground">
            {isVideo ? <Film size={15} /> : <ImageIcon size={15} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[0.8125rem] font-bold text-foreground">
              {isVideo ? "A short video" : isTwoStep ? "Starting picture for your video" : "An image"}
            </div>
            {/* 清单 A5(P2-013)—— 主视图这一行是**给商家读的**那句话。供应商提示词
                (seedream/seedance 那段原话)已经收进下面的 Advanced details:它是送去
                执行的机器措辞,摆在卡面第一行既占掉整张卡的第一眼,又让商家误以为那是
                他该改的字。老卡没有 `goal`(服务端至今不写这一格)⇒ 这一行不出现,
                标题与规格条自己说得清楚,绝不拿提示词顶上来充数。 */}
            {p.goal && (
              <div className="whitespace-pre-wrap break-words text-[0.75rem] text-muted-foreground">
                {p.goal}
              </div>
            )}
          </div>
        </div>

        {/* #580 — the full spec, in the merchant's words, exactly as the server built it
            from what execution really honours. Rendered verbatim: the card adds nothing
            and drops nothing, so it cannot promise what the generator won't receive.
            An older card with no specChips shows no spec rather than a guessed one. */}
        {specChips.length > 0 && (
          <div className="mt-[9px] flex flex-wrap gap-[6px]">
            {specChips.map((chip) => (
              <span
                key={chip}
                className="rounded-[7px] border border-border bg-card px-[7px] py-[2px] font-mono text-[11px] text-muted-foreground"
              >
                {chip}
              </span>
            ))}
          </div>
        )}

        {/* #774 —— 引擎认人用的那几个名字,商家在花钱之前就看得见。卡上写的这几个字
            就是付费提示词里那几个字:名字冻结在这张卡上,批准之后谁也改不动它,worker
            只认这一份(改名不会偷偷换掉已经批准的指令)。老卡没有这份快照 → 不显示这行,
            而不是猜一个。 */}
        {/* Codex QA-CRE-FE9-013 —— 人物那一行下面,是媒体参考的逐项回执(缩略图、真实名字、
            来源画布)。从前这里只有人物,商家从 Library 挑的那张产品图在卡上一个字都没有。
            回执缺一件时这一块自己说出来缺哪一件,而 Generate 由 gate.approvable 关掉。 */}
        <CardReferenceReceipt
          approvedEntitiesNote={referenceNamesNote}
          mediaReferences={p.mediaReferences ?? []}
          missing={gate.missingReferenceReceipts}
        />

        {/* A payload that carried malformed fields is disclosed, not quietly patched —
            and, since r2 P1-2, not approvable either (see the button block below). */}
        {gate.malformedFields.length > 0 && (
          <div className="mt-[9px] text-[0.75rem] text-[var(--warning-soft-foreground)]">
            {PARTIAL_PLAN_NOTE}
          </div>
        )}

        {/* #580 — a downgrade is never silent. If the plan couldn't honour what was
            asked for, the card says so before the merchant spends. */}
        {p.downgraded && (
          <div className="mt-[9px] text-[0.75rem] text-[var(--warning-soft-foreground)]">
            {p.downgradeNote || DOWNGRADE_FALLBACK_NOTE}
          </div>
        )}

        {/* Founder 2026-09-05「加进确认卡」—— 张数／形状／精修就长在这里,**批准之前**可以改。
            ⑦段退役直出 composer 之后这三格无处可选,而这张卡是唯一的花钱入口。改一格 = 服务端
            重铸这张卡($0),新的价随新卡回来 —— 界面一分钱都不自己算,所以卡面那个数与真正
            离开余额的那个数只可能是同一个。已排队/已完成/已取消的卡不再出现这三格。 */}
        {optionsOnCard && (
          <CardOptionControls
            threadId={threadId}
            cardId={cardId}
            payload={p}
            disabled={busy}
            onChanged={(next) => onOptionsChanged(cardId, next)}
          />
        )}

        {/* 清单 A5（P2-013）—— 供应商提示词（seedream/seedance 那段送去执行的原话）收进
            这里，默认收起。它不是商家该逐字读的东西：走查里那段机器措辞占着卡面第一行，
            商家读不懂又以为得在它上面改（旧的「Change something」正是把它塞回输入框）。
            收起不等于藏起 —— 它就在卡上，一下点开，Copy 也还在。 */}
        {providerPrompt && (
          <details className="group mt-3 rounded-[11px] border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-[11px] px-3 py-2 text-[0.75rem] text-muted-foreground [&::-webkit-details-marker]:hidden">
              <span>Advanced details</span>
              <ChevronDown size={14} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t border-border px-3 py-2">
              <div className="text-[0.75rem] text-muted-foreground/70">
                {isVideo ? "The prompt sent to the video engine" : "The prompt sent to the image engine"}
              </div>
              <div className="mt-1 whitespace-pre-wrap break-words text-[0.75rem] text-muted-foreground">
                {providerPrompt}
              </div>
              <Button
                type="button"
                variant="link"
                onClick={handleCopy}
                className={`mt-1 h-auto w-auto p-0 text-[0.75rem] underline ${
                  copyState === "copied" ? "text-[var(--success-soft-foreground)]" : "text-muted-foreground/70"
                }`}
              >
                {copyState === "copied" ? "Copied" : copyState === "no-api" ? "Long-press to copy" : "Copy"}
              </Button>
            </div>
          </details>
        )}

        <div className="mt-4 border-t border-border pt-4">
          {isTwoStep && videoCredits !== null ? (
            <div>
              <div className="mb-1 text-[0.75rem] text-muted-foreground">
                Two-step plan
              </div>
              <div className="font-mono text-[11.5px] text-muted-foreground">
                Step 1 of 2 &mdash; <CardMoney>~{creditsLabel(credits)}</CardMoney> now
              </div>
              <div className="mt-1 text-[0.875rem] text-muted-foreground">
                Then the video &mdash; <CardMoney>~{creditsLabel(videoCredits)}</CardMoney>
              </div>
              {/* Codex E2E-CRE-PAV-004 —— 第二步的卡由服务端接力铸出(冻结计划在 `videoStep.next`),
                  所以这里可以照实说下一步会自己出现。没有冻结计划的老卡不说这句:那种卡上
                  第二步确实还得靠对话继续,承诺一件不会发生的事比不说更糟。 */}
              {p.videoStep?.next ? (
                <div className="mt-1 text-[0.75rem] text-muted-foreground">
                  Once this picture is made, the video comes back for you to confirm on its own.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="font-mono text-[11.5px] text-muted-foreground">
              About <CardMoney>{creditsLabel(credits)}</CardMoney>
            </div>
          )}
        </div>

        {/* Cancelled is asked FIRST (#602 T3). The two states arrive on the same durable message,
            so whichever is tested first wins — and a merchant's own decision must never be dressed
            up as a failure with a "Try again" button attached to it. */}
        {cancelled ? (
          <div className="mt-4 text-[0.875rem] text-muted-foreground">
            Canceled — you weren&rsquo;t charged.
          </div>
        ) : runState === "failed" ? (
          <div className="mt-4">
            <div className="text-[0.875rem] font-semibold text-foreground">
              😕 This one didn&rsquo;t come through — and you weren&rsquo;t charged.
            </div>
            <div className={`mt-3 ${CARD_ACTIONS_CLASS}`}>
              <Button variant="default" size="sm" className="rounded-[11px]" disabled={busy} onClick={retry}>
                {busy ? "Queuing…" : "Try again"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="rounded-[11px]"
                disabled={busy}
                aria-expanded={changeOpen}
                onClick={handleChangeSomething}
              >
                Change something
              </Button>
            </div>
          </div>
        ) : runState === "done" ? (
          <div className="mt-4">
            <div className="text-[0.875rem] font-semibold text-[var(--success-soft-foreground)]">
              ✓ Done
            </div>
            {/* Spend-traceability line — pure copy, no charge logic. */}
            <div className="mt-2 text-[0.75rem] text-muted-foreground/70">
              ✓ You approved this — it used <CardMoney>{creditsLabel(credits)}</CardMoney>.
            </div>
          </div>
        ) : runState === "queued" ? (
          <div className="mt-4">
            <div className={CARD_SPLIT_ROW_CLASS}>
              {/* P1-3: the card knows a job exists, not that it started (the thread DTO
                  folds QUEUED and GENERATING into one "working"). So it says queued —
                  the one thing that is true either way — instead of "making this now". */}
              <span className="text-[0.875rem] font-semibold text-[var(--success-soft-foreground)]">
                ✓ Approved — in the queue · {formatElapsed(elapsed)} · {QUEUE_WAIT_NOTE}
              </span>
              {genJobId && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={cancel}>
                  {busy ? "Canceling…" : "Cancel"}
                </Button>
              )}
            </div>
            {/* Spend-traceability line — pure copy, no charge logic. */}
            <div className="mt-2 text-[0.75rem] text-muted-foreground/70">
              ✓ You approved this — it used <CardMoney>{creditsLabel(credits)}</CardMoney>.
            </div>
          </div>
        ) : !gate.approvable ? (
          // r2 P1-2: the card read itself only partially. It still shows what it managed
          // to read (above) and says so (PARTIAL_PLAN_NOTE), but the path to spending on
          // it does not exist — no confirm step, no approve button, and approve() refuses.
          <div className={`mt-4 ${CARD_ACTIONS_CLASS}`}>
            <Button variant="secondary" size="sm" className="rounded-[11px]" onClick={handleAskAgain}>
              Ask again
            </Button>
          </div>
        ) : (
          // ONE press (#896, Founder 2026-08-13). The price is on the button, so pressing it
          // IS the approval — the old "Review cost" step showed this same number again and
          // charged nothing, which is a click that buys the merchant nothing.
          <div className={`mt-4 ${CARD_ACTIONS_CLASS}`}>
            <Button variant="default" size="sm" className="rounded-[11px]" disabled={busy} onClick={approve}>
              {busy ? "Starting…" : `Generate · ${creditsLabel(credits)}`}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-[11px]"
              disabled={busy}
              aria-expanded={changeOpen}
              onClick={handleChangeSomething}
            >
              Change something
            </Button>
          </div>
        )}

        {/* 清单 A5（P2-013）—— 「Change something」打开的那张小表单。
            两个状态给得出它：等确认的卡（能就地改的三格就在上面）与失败的卡（那三格不再渲染，
            人话那一行是唯一的出路）。提交走 `onChangeSomething` —— 仍是从前那**一条**对话路。 */}
        {changeOpen && !cancelled && (
          <CardChangeForm
            payload={p}
            optionsOnCard={optionsOnCard}
            disabled={busy}
            onSubmit={submitChange}
          />
        )}

        {/* #498 (round-4): chained needs_approval after THIS approve — the honest
            "not done yet" state, shown as the SERVER's localized receipt verbatim
            (no hardcoded-English copy; the same text is durable in the thread).
            The remaining parked cards keep their own approve gates (no spend
            logic here). */}
        {chainedReceipt && (
          <div className="mt-2 text-[0.75rem] text-muted-foreground">
            {chainedReceipt}
          </div>
        )}

        {error ? (
          // #979:钱不够那一句以前就停在这里 —— 一段写着「Top up in Billing.」却点不动的字。
          // 商家在批准按钮上撞到它、已经决定要付钱了,还得自己去找 Billing 在哪(beta 录像
          // 10:32,原地停了 40 秒)。`ErrorWithTopUp` 只认服务端那一份 CTA 字面量,别的错误
          // 原样渲染,不会凭空长出充值链接。
          <Alert role="alert" variant="destructive" density="compact" className="mt-2">
            <AlertDescription>
              <ErrorWithTopUp text={error} />
              {/* CRE-STG-P2-004 —— 短号住在这块**持久**的 Alert 里(不是 toast):走查那两次
                  失败之后卡面上什么都不剩,商家除了「再试一次」没有第二个动作。它可选中、
                  可复制,与服务端日志里那一行同一串。 */}
              <CardApprovalRef refId={errorRef} />
            </AlertDescription>
          </Alert>
        ) : (
          <div className="mt-3 flex items-center gap-[6px] text-[0.75rem] text-muted-foreground/70">
            <ShieldCheck size={15} /> Otto only makes this after you approve. {CHAT_SPEND_NOTE}
          </div>
        )}
      </div>
    </div>
  );
}

export default OttoPlanCard;
