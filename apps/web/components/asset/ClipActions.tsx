"use client";
/**
 * #922 缺口 A —— 「改这条片子 / 把这条片子接下去」,商家自己可以点的那一面。
 *
 * 住在详情面板里,所以素材库与画布**同时**拿到它:画布视频卡上的 "Detail" 打开的正是
 * 这一个面板(`components/canvas/FlowCanvas.tsx` 引的是同一个 DetailPanel)。一个入口
 * 两个面,不是两份实现。
 *
 * 三拍,与分镜卡逐帧重做那一块同一个形状:
 *   ① 按一个动作键 —— 展开一个文本框问「要改什么 / 接下来发生什么」。**$0**。
 *   ② 按 "Get a price" —— 服务端铸一张与 Otto 路完全同形的卡(官方句式冻结在卡上,
 *      画幅钉成跟着他那条片子走)。仍然 **$0**:没有 GenJob、没有预扣、没有幂等占位。
 *   ③ 按 "Confirm" —— 走的是既有的 `coworkGenerate(cardId)`,那是这条路上**唯一**
 *      花钱的一步,幂等域仍是那张卡自己的 `cowork:<cardId>`。
 *
 * 商家在按下 ③ 之前看得见卡上冻结的那一整段字 —— 批准的与引擎收到的是同一份。
 */
import { useId, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { creditsLabel } from "@/lib/credit-format";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { proposeClipActionCard, type ClipActionCard } from "@/lib/clip-actions";
import { coworkGenerate } from "@/lib/cowork-actions";
import { CLIP_ENTRY_ACTIONS, CLIP_ENTRY_COPY, type ClipEntryAction } from "@/lib/clip-action-entry";

export function ClipActions({
  generationId,
  disabled = false,
  disabledReason,
}: {
  generationId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [action, setAction] = useState<ClipEntryAction | null>(null);
  const [wording, setWording] = useState("");
  const [card, setCard] = useState<ClipActionCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const wordingId = useId();

  function reset() {
    setAction(null);
    setWording("");
    setCard(null);
    setError(null);
    setStarted(false);
  }

  async function getPrice(): Promise<void> {
    if (disabled || busy || !action) return;
    setBusy(true);
    setError(null);
    try {
      const result = await proposeClipActionCard({ generationId, action, wording });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setCard(result);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (disabled || busy || !card) return;
    setBusy(true);
    setError(null);
    try {
      // 客户端这一份 `prompt` 是**接受即丢弃**的副本:锚定卡的提示词只能来自卡本身
      // (#775 判官 r3 —— `buildGenRequestFromCard` 对官方句式的卡忽略客户端那一段)。
      // 送的是屏幕上那一份,所以它与卡一致;就算不一致,作数的也仍然是卡。
      const result = await coworkGenerate({
        cardId: card.cardId,
        prompt: card.structuredPrompt,
        entityIds: [],
        variantSel: {},
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setStarted(true);
      notifyBalanceRefresh();
    } finally {
      setBusy(false);
    }
  }

  if (started) {
    return (
      <>
        <Separator />
        <div className="px-4 py-3">
          <Alert variant="success" density="compact" role="status">
            <AlertTitle>Video started</AlertTitle>
            <AlertDescription>
              <span>It&apos;ll land in your library when it&apos;s done.</span>
              <Button variant="ghost" size="sm" onClick={reset}>Do another</Button>
            </AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  return (
    <>
      <Separator />
      <div className="flex flex-col gap-3 px-4 py-3">
        {action === null ? (
          <div className="flex flex-wrap gap-2">
            {/* #922 —— 画哪几个键由 core 的下架名单说了算,不在这里另列一份。 */}
            {CLIP_ENTRY_ACTIONS.map((key) => (
              <Button
                key={key}
                variant="ghost"
                size="sm"
                disabled={disabled}
                title={disabledReason}
                onClick={() => { setAction(key); setError(null); }}
              >
                {CLIP_ENTRY_COPY[key].cta}
              </Button>
            ))}
          </div>
        ) : card === null ? (
          <FieldGroup className="gap-3">
            <Field data-disabled={busy || disabled}>
              <FieldLabel htmlFor={wordingId}>{CLIP_ENTRY_COPY[action].heading}</FieldLabel>
              <Textarea
                id={wordingId}
                aria-label={CLIP_ENTRY_COPY[action].heading}
                value={wording}
                onChange={(e) => setWording(e.target.value)}
                rows={2}
                placeholder={CLIP_ENTRY_COPY[action].placeholder}
                disabled={busy || disabled}
                // 定高框,不随打字长高(同 #920 对四处 composer 的处置)。
                className="field-sizing-fixed min-h-0 resize-none"
              />
              <FieldDescription>No charge until you confirm.</FieldDescription>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="default"
                size="sm"
                disabled={disabled || busy || wording.trim().length === 0}
                onClick={() => void getPrice()}
                aria-live="polite"
              >
                {busy && <Spinner data-icon="inline-start" aria-hidden="true" />}
                {busy ? "Checking price…" : "Get a price"}
              </Button>
              <Button variant="ghost" size="sm" disabled={disabled || busy} onClick={reset}>
                Cancel
              </Button>
            </div>
          </FieldGroup>
        ) : (
          <>
            {/* 卡上冻结的那一整段 —— 批准的与引擎收到的是同一份,所以按之前就摊开给他看。 */}
            <span className="text-[12px] font-medium text-muted-foreground">What we&apos;ll ask for</span>
            <p className="m-0 whitespace-pre-wrap text-[13px] leading-[1.5] text-foreground">
              {card.structuredPrompt}
            </p>
            {card.specChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {card.specChips.map((chip) => <Badge key={chip}>{chip}</Badge>)}
              </div>
            )}
            {card.downgradeNote && (
              <span className="text-[12px] text-muted-foreground">{card.downgradeNote}</span>
            )}
            <span className="text-[13px] text-foreground">
              {CLIP_ENTRY_COPY[action].confirmLead} — {creditsLabel(card.estimatedCredits)}? This will spend
              real credits.
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="default"
                size="sm"
                disabled={disabled || busy}
                onClick={() => void confirm()}
                aria-live="polite"
              >
                {busy && <Spinner data-icon="inline-start" aria-hidden="true" />}
                {busy ? (action === "edit" ? "Starting edit…" : "Starting continuation…") : "Confirm"}
              </Button>
              <Button variant="ghost" size="sm" disabled={disabled || busy} onClick={reset}>
                Cancel
              </Button>
            </div>
          </>
        )}
        {error && (
          <Alert variant="destructive" density="compact" role="alert">
            <AlertTitle>Couldn&apos;t complete this action</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </>
  );
}

export default ClipActions;
