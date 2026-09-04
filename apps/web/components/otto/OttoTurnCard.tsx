"use client";

/**
 * OttoTurnCard —— 画布左上角那张**始终可见**的 Otto 卡片。
 *
 * 规格：`docs/specs/creation-engine.md`（验收 CREATE-A1：画布路径的判定落在 Otto 确认卡片上）。
 * 设计源：`apps/web/design-system/patterns/canvas/CanvasReference.tsx` 的 `CurrentTurn`
 * （needs-confirmation 一节逐条对齐：件数与类型 + 规格行 + 价格 + 参考行 + 一排按钮）。
 * 触发：2026-09-04 staging 走查 P0-3 / P0-4 / P1-1。
 *
 * ## 它修的三件事
 *
 * 1. **确认卡回到看得见的地方（P0-3）**。从前 Otto 写「你会在上面看到两张卡」，而那两张
 *    带 Generate 按钮的卡在默认折起的 Conversation 抽屉里 —— 上面什么都没有。现在同一张卡
 *    的确认摘要就在这张卡里，一按就走。
 *
 *    **钱路语义一个字没变**：按钮走的是 `plan-approval.ts` 那一份共享动作（与抽屉里那张
 *    `OttoPlanCard` 完全同一条路、同一个 cardId/threadId 身份、同一条先披露后扣的规矩），
 *    价格与规格行取自这张卡自己的 payload，本组件不算钱、不猜价、不生成任何新 id。
 *    价格担保不住（`planCardGate` 不放行）的卡在这里**不出现按钮** —— 与抽屉里同一个门。
 *
 * 2. **真进度（P0-4）**。状态词与那句进度话由 `lib/otto-canvas-turn.ts` 从**已有的**信号派生
 *    （data-step 的工具标签 / data-status 的三句叙述 / 卡片自己的 CardState），这里只渲染。
 *
 * 3. **正文是人话（P1-1）**。原始 Markdown 交给 `OttoMarkdown`（与抽屉里同一个渲染器），
 *    并且只认真的 TEXT —— `🖼 result` 那种内部占位串由 `canvasTurnText` 挡在外面。
 *
 * 4. **一张脸只说一件事（Codex QA-CRE-004）**。状态词与正文由 `lib/otto-canvas-turn.ts` 从
 *    **同一个**来源投影：这一轮最新的那个事件。所以「绿灯 Ready 配着上一轮那句失败」这种
 *    自相矛盾的脸，在这一层没有地方生出来 —— 它连两个状态源都没有。
 */

import React, { useState } from "react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { OttoMarkdown } from "./parts/OttoMarkdown";
import { creditsLabel } from "@/lib/credit-format";
import { CANVAS_OTTO_CORNER_ATTR } from "@/lib/canvas-fit-padding";
import { approvedEntitiesNote } from "@fikirtive/core/reference-budget";
import { planCardGate } from "./plan-card-contract";
// Codex QA-CRE-FE9-013 —— 参考回执那一块。抽屉里那张卡读的是同一个组件。
import { CardReferenceReceipt } from "./CardReferenceReceipt";
import { runPlanApproval } from "./plan-approval";
import { CardApprovalRef } from "./CardApprovalRef";
import type { PlanApproveOutcome } from "./OttoPlanCard";
import type { CanvasTurnStatus } from "@/lib/otto-canvas-turn";

/** 一张等确认的卡，这张 Otto 卡需要知道的全部。 */
export interface CanvasConfirmCard {
  cardId: string;
  threadId: string;
  payload: unknown;
  pendingApproval: boolean;
}

export interface OttoTurnCardProps {
  status: CanvasTurnStatus;
  /** Otto 最近说的那段话（已过滤内部占位串）；没有就显示引导句。 */
  text: string | null;
  /** 正文是不是还在流。 */
  streaming: boolean;
  /** 等商家确认的卡，按对话顺序。 */
  confirmCards: readonly CanvasConfirmCard[];
  onApproved: (outcome: PlanApproveOutcome) => void;
  /** 「Change」把这张卡的原话塞回输入框，让商家改了再来。 */
  onChangeSomething: (seed: string) => void;
}

export const CANVAS_TURN_EMPTY_TEXT = "Tell Otto what you want to create or change.";

export function OttoTurnCard({
  status,
  text,
  streaming,
  confirmCards,
  onApproved,
  onChangeSomething,
}: OttoTurnCardProps) {
  return (
    <div
      aria-label="Otto current turn"
      {...{ [CANVAS_OTTO_CORNER_ATTR]: "" }}
      className="pointer-events-auto absolute left-4 top-4 w-[280px] rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="flex items-center gap-2 text-xs font-semibold">
          <OttoAvatar size={22} state={status.busy ? "thinking" : "idle"} />
          Otto
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={`size-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </div>
      <div className="px-3 py-3">
        {/* 正文。滚动而不是硬截三行:走查记到第四行会溢出卡片的圆角下缘,而截断本身也让
            商家读不完 Otto 刚说的话。上限跟着设计稿的对话抽屉走(max-h-[260px])。 */}
        <div className="max-h-[168px] overflow-y-auto text-sm leading-5 text-foreground">
          {text ? (
            <OttoMarkdown text={text} streaming={streaming} />
          ) : (
            <p className="text-muted-foreground">{CANVAS_TURN_EMPTY_TEXT}</p>
          )}
        </div>
        {status.detail ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground"
          >
            {status.busy ? <Spinner className="size-3.5 text-brand" aria-hidden /> : null}
            <span>{status.detail}</span>
          </p>
        ) : null}
        {confirmCards.map((card) => (
          <CanvasConfirmRow
            key={card.cardId}
            card={card}
            onApproved={onApproved}
            onChangeSomething={onChangeSomething}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 一张卡的确认位。设计稿 `CanvasReference.tsx:270` 的 needs-confirmation 一节。
 *
 * 门与钱都不是这里的判断：`planCardGate` 决定这张卡能不能被批准（读不懂 / 报不出价 /
 * 只读懂一半的卡，这里和抽屉里一样**不出按钮**），`runPlanApproval` 是那一次动作本身。
 */
function CanvasConfirmRow({
  card,
  onApproved,
  onChangeSomething,
}: {
  card: CanvasConfirmCard;
  onApproved: (outcome: PlanApproveOutcome) => void;
  onChangeSomething: (seed: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Codex staging CRE-STG-P2-004 —— 失败那一句旁边的可复制短号(服务端日志里同一串)。 */
  const [errorRef, setErrorRef] = useState<string | null>(null);
  const gate = planCardGate(card.payload);
  const p = gate.value;
  const credits = gate.credits;
  // 读不懂或担保不住价格的卡不在这里出现 —— 抽屉里那张会把原因说清楚（UNREADABLE_PLAN_NOTE
  // / PARTIAL_PLAN_NOTE），这张 280px 的卡不复述第二遍，更不会给它一颗按钮。
  if (!gate.approvable || credits === null) return null;

  const isVideo = p.kind === "video";
  const count = p.params?.count ?? 1;
  // 规格行**逐字**取自卡自己的 specChips（服务端按执行真正认的东西建的那一份）。
  // 走查 P1-2：Otto 曾口头宣称「两张卡都改成 1080p 了」而卡上仍是 720p —— 商家按下去
  // 之前看到的必须是卡自己说的话，不是聊天气泡里的说法。
  const spec = (p.specChips ?? []).join(" · ");
  const referenceNote = approvedEntitiesNote(p.approvedEntities ?? []);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setErrorRef(null);
    const outcome = await runPlanApproval({
      threadId: card.threadId,
      cardId: card.cardId,
      pendingApproval: card.pendingApproval,
      payload: p,
    });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error);
      setErrorRef(outcome.ref);
      return;
    }
    onApproved({ cardId: card.cardId, chained: outcome.chained });
  }

  return (
    <div aria-label="Generation confirmation" className="mt-3 border-t border-border pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">
            {count} {isVideo ? "video" : "image"}{count > 1 ? "s" : ""}
          </p>
          {spec ? <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{spec}</p> : null}
        </div>
        <strong className="shrink-0 text-sm tabular-nums text-foreground">{creditsLabel(credits)}</strong>
      </div>
      {/* Codex QA-CRE-FE9-013 —— 参考回执逐项列出:人物那一句在前,媒体参考(缩略图 + 真实
          名字 + 来源画布)在后。与抽屉里那张卡共用同一个组件,两处不可能说出两件事。
          (缺回执的卡走不到这里 —— `gate.approvable` 在上面就把整块按钮位收掉了。) */}
      {referenceNote || (p.mediaReferences?.length ?? 0) > 0 ? (
        <div className="mt-2 rounded-[var(--radius)] bg-muted px-2 py-1.5">
          <CardReferenceReceipt
            approvedEntitiesNote={referenceNote}
            mediaReferences={p.mediaReferences ?? []}
            missing={gate.missingReferenceReceipts}
          />
        </div>
      ) : null}
      {/* CRE-STG-P2-004 —— 失败留在卡上(不是 toast),而且带着那个可复制的短号:走查那两次
          点击之后卡面上什么都不剩,商家除了「再试一次」没有第二个动作。短号与抽屉里那张卡
          共用同一个组件(`CardApprovalRef`),两处不可能长出两种写法。 */}
      {error ? (
        <div role="alert" className="mt-2 text-xs text-destructive">
          <span className="block">{error}</span>
          <CardApprovalRef refId={errorRef} />
        </div>
      ) : null}
      <div className="mt-3 flex justify-end gap-1.5">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => onChangeSomething(p.structuredPrompt ?? "")}
        >
          Change
        </Button>
        <Button type="button" size="xs" disabled={busy} onClick={() => void confirm()}>
          {busy ? <Spinner data-icon="inline-start" aria-hidden /> : null}
          Generate · {creditsLabel(credits)}
        </Button>
      </div>
    </div>
  );
}

export default OttoTurnCard;
