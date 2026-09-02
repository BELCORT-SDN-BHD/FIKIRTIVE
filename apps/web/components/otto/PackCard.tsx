"use client";
import { useState } from "react";
import { ClipboardList, Film, Image as ImageIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { ottoApprove } from "@/lib/otto-client-actions";
import { coworkGenerate } from "@/lib/cowork-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { creditsLabel } from "@/lib/credit-format";
import { TopUpNotice } from "@/components/exits/Exits";
import { runPackApprovalLoop, type PackApprovalOutcome } from "./approval-chain";
import type { CardState } from "@/lib/otto-inject-helpers";
import { packTotalCredits, canAffordPack } from "./pack-credit-math";
// r2 P1-3: the pack reads its cards through the SAME contract parser and the SAME price
// predicate as the single card. It used to hand-roll a `SlimPayload` cast and guess a
// price from the record-only USD estimate, so a pack could offer "Make all" on a total
// the server never quoted.
import { planCardGate } from "./plan-card-contract";
import { SpendConfirmation, SpendProgress } from "./spend-state";
import { cn } from "@/lib/utils";
// #996 (W2-9): 面板最窄 320px。清单行在窄版折成两行(尾段整行下沉),
// 每一个 credits 数字走 CardMoney —— 句子可以换行,数字不行。
import {
  CardMoney,
  CARD_LIST_ROW_CLASS,
  CARD_LIST_ROW_TRAIL_CLASS,
  CARD_PAD_CLASS,
  CARD_ROOT_CLASS,
} from "./card-narrow";

/** The per-card shape PackCard receives from OttoChatStream. */
export interface PackCardItem {
  cardId: string;
  payload: unknown;
  threadId: string;
  genJobId: string | null;
  cardState: CardState;
  pendingApproval: boolean;
}

/** Shown in a row whose card carries no price we can vouch for — never a guessed number. */
export const PACK_UNPRICED_ROW = "price unavailable";

/** Shown instead of the pack total + "Make all" when any card the batch would still RUN has
 *  no guaranteed price (or didn't read in full). Batch approval is all-or-nothing, so one
 *  unpriceable card takes the whole batch button with it. Cards that already ran are out of
 *  the batch, so they no longer take it down with them (#896 r2 P1). */
export const PACK_UNPRICED_NOTE =
  "I can't put a firm price on every item here, so I won't run them as a batch — ask me to put this together again and I'll make a fresh set.";

export interface PackCardProps {
  packTitle: string;
  cards: PackCardItem[];
  balanceUsd: number;
  /** Called once the loop settles with at least one successful fire (#498
   *  round-5): the loop's server-sourced outcome — what actually fired, the
   *  authoritative still-pending ids, the latest localized receipt, and any
   *  persisted narration ids — so the parent derives its state from the SAME
   *  facts (no parent-side re-derivation). */
  onApproved: (outcome: PackApprovalOutcome) => void;
}

/** Renders a group of GEN_CARD messages that share a packId as one unit.
 *  Shows a "Make all (N · X credits)" primary button that fires generation
 *  SEQUENTIALLY for each card via the same per-card paths (coworkGenerate /
 *  ottoApprove) as OttoPlanCard — no new server action.
 *
 *  Money path: unchanged. The priced button and the insufficient-balance guard
 *  fulfil the "the merchant approves the spend, knowing the price" rule — since #896
 *  in ONE press rather than two (the old second step re-showed the same number). */
export function PackCard({ packTitle, cards, balanceUsd, onApproved }: PackCardProps) {
  const [running, setRunning] = useState(false);
  /** The card the loop is firing right now. Held by id, not by index into idleCards:
   *  a per-item run fires a SUBSET, so an index would point at the wrong row (#786). */
  const [currentCardId, setCurrentCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track which cards finished in this session so we can show per-row feedback.
  const [doneCardIds, setDoneCardIds] = useState<Set<string>>(new Set());

  /** #498 round-4: the SERVER's localized receipt when an approve in this pack's
   *  loop parked again (chained needs_approval). Display copy only, verbatim. */
  const [chainedReceipt, setChainedReceipt] = useState<string | null>(null);

  // One gate per card — the same one OttoPlanCard uses. `p` is the PARSED payload
  // (malformed fields dropped and accounted for), `credits` is guaranteed or null.
  const parsedCards = cards.map((c) => {
    const gate = planCardGate(c.payload);
    return { ...c, p: gate.value, credits: gate.credits, approvable: gate.approvable };
  });

  // Only idle (not yet submitted / not already working/done) cards need firing.
  const idleCards = parsedCards.filter((c) => c.cardState === "idle");

  // #896 r2 P1 —— 价签、余额门、执行目标读的是**同一组卡**:还没跑的那些。
  // 之前总价按包里全部卡算,而按下去只跑 idle 的那些:一张已经跑过、一张还没跑,各 5 credits,
  // 按钮就写着「Make all (1 · 10 credits)」却只启动 5 —— 商家看到的价和实际发生的事是两件事,
  // 而且余额门也按那个虚高的 10 判,把一次真的付得起的批准挡在外面。
  // null ⇒ 剩下的卡里有一张报不出价,所以这一包没有可展示的总价、也没有整包批准(见页脚)。
  const totalCredits = packTotalCredits(idleCards);
  const canAfford = totalCredits !== null && canAffordPack(totalCredits, balanceUsd);

  // The items this merchant could still start ONE AT A TIME (#786). Each is judged by its
  // OWN gate — readable, priced, no malformed field — and its own price against the wallet.
  // This is what makes "or approve them individually" a fact rather than a suggestion: the
  // notice may only name that option while this list has something in it, and the per-item
  // controls below render for exactly these rows.
  const affordableIdleCards = idleCards.filter(
    (c) => c.approvable && c.credits !== null && canAffordPack(c.credits, balanceUsd),
  );

  // If all cards are non-idle (all working/done/failed), the pack is fully running.
  const allSubmitted = idleCards.length === 0;
  // The one state in which the product offers the per-item route: the batch is priced and
  // out of reach, and at least one item is not. `alternative` on the notice below is fed
  // from THIS SAME flag, so the sentence and the controls cannot disagree.
  const offerIndividual = !allSubmitted && totalCredits !== null && !canAfford && affordableIdleCards.length > 0;
  // F11: "failed" cards are non-idle too, so allSubmitted alone would show a green success footer
  // even when every card failed. Count only the non-failed (actually started) ones.
  const startedCount = parsedCards.filter((c) => c.cardState !== "failed").length;
  const showFooter = !allSubmitted || startedCount > 0 || Boolean(chainedReceipt) || Boolean(error);

  /** Fire `targets` through the pack loop. ONE body for both ways in — "Make all" hands it
   *  every idle card, a per-item approve hands it exactly one (#786) — so the two cannot
   *  drift apart: same server actions, same pending-set contract, same outcome handed up.
   *  Nothing money-shaped is added here; a subset is just a shorter list. */
  async function runCards(targets: typeof idleCards) {
    if (running || targets.length === 0) return;
    // Fail closed on the SAME gate the rows render from: a card we couldn't read, couldn't
    // price, or couldn't read in full may not start a spend, whatever path got here.
    if (targets.some((c) => !c.approvable || c.credits === null)) return;
    setRunning(true);
    setError(null);

    // #498 round-5: the loop itself is the pure runPackApprovalLoop — ONE
    // authoritative pending set (seeded from pendingApproval, updated only from
    // each server response), channel picked AT CALL TIME, and a card the server
    // re-reports pending is never settled (its approve gate survives). This
    // component only wires the real server actions and maps outcome → state.
    const outcome = await runPackApprovalLoop({
      cards: targets,
      fire: (c, pendingApproval) =>
        pendingApproval
          ? ottoApprove({ threadId: c.threadId, cardId: c.cardId })
          : coworkGenerate({
              cardId: c.cardId,
              prompt: c.p.structuredPrompt ?? "",
              entityIds: Array.isArray(c.p.entityIds) ? c.p.entityIds : [],
              variantSel: c.p.variantSel && typeof c.p.variantSel === "object" ? c.p.variantSel : {},
            }),
      onCardStart: (i) => setCurrentCardId(targets[i].cardId),
      onCardSettled: (cardId, cleared) => {
        // A re-reported-pending card gets no ✓ — it still needs its approval.
        if (cleared) setDoneCardIds((prev) => new Set(prev).add(cardId));
        // Per card, not just per pack: a ten-card pack should show the balance draining
        // as it goes rather than jumping once at the end (#550).
        notifyBalanceRefresh();
      },
    });

    setRunning(false);
    setCurrentCardId(null);
    notifyBalanceRefresh();
    if (outcome.failure) {
      const { index, message } = outcome.failure;
      // "Card 2 of 5" only means something in a batch. A single-item run says which card
      // it was by being the one the merchant just pressed.
      const where = targets.length > 1 ? `Card ${index + 1} of ${targets.length}` : null;
      setError(
        message
          ? where
            ? `${where}: ${message}`
            : message
          : where
          ? `${where} failed — please try again.`
          : "That one didn't start — please try again.",
      );
    }
    // The receipt only makes sense while something is still awaiting approval.
    setChainedReceipt(outcome.pendingCardIds.length > 0 ? outcome.fallbackReply : null);
    // F11: earlier cards in this loop were already charged + started — hand the
    // outcome up even when a later card failed, so their paid results still
    // surface (don't strand them). Nothing fired ⇒ nothing changed ⇒ no call
    // (the pending set can only move on a server response).
    if (outcome.firedCardIds.length > 0) onApproved(outcome);
  }

  /** The batch. Fails closed on the footer's own gate: no guaranteed pack total ⇒ no
   *  batch spend, whatever path got here. */
  function makeAll() {
    if (totalCredits === null) return;
    return runCards(idleCards);
  }

  return (
    <Card className={cn(CARD_ROOT_CLASS, CARD_PAD_CLASS, "w-full max-w-[520px] p-0")}>
      <CardHeader className="flex-row items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <ClipboardList size={18} aria-hidden="true" />
            <span className="truncate">{packTitle}</span>
          </CardTitle>
          <CardDescription>
            Review the items Otto prepared, then start the ones you want.
          </CardDescription>
        </div>
        <Badge variant="outline">
          {cards.length} {cards.length === 1 ? "item" : "items"}
        </Badge>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-2">
          {parsedCards.map((c, idx) => {
            const isVideo = c.p.kind === "video";
            const desc = c.p.structuredPrompt || (isVideo ? "A short video" : "An image");
            const isDone = doneCardIds.has(c.cardId) || c.cardState === "done" || c.cardState === "working";
            const isFailed = c.cardState === "failed";
            // The merchant stopped this one. Not a failure, so no dimming and no red word
            // — without its own branch it fell through to the "queued" row and sat there
            // for ever, which is the pack's version of the eternal spinner (#602 r2).
            const isCancelled = c.cardState === "cancelled";
            const isGenerating = c.cardState === "idle" && running && currentCardId === c.cardId;
            // #786 — the row-level way out the footer's notice names. Offered exactly where
            // it is promised: the batch is out of reach, but THIS item is not. (When the
            // whole batch is affordable the pack's own "Make all" is the way through, so
            // nothing is claimed and nothing is rendered — widening it to that case would
            // be a product change nobody asked for.)
            const canMakeThis = offerIndividual && affordableIdleCards.some((a) => a.cardId === c.cardId);

            return (
              <div
                key={c.cardId}
                className={cn(
                  CARD_LIST_ROW_CLASS,
                  "rounded-lg bg-muted px-3 py-2.5",
                  (isFailed || isCancelled) && "opacity-60",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-foreground">
                  {isVideo ? <Film size={17} /> : <ImageIcon size={17} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {desc}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.credits === null ? PACK_UNPRICED_ROW : <CardMoney>{creditsLabel(c.credits)}</CardMoney>}
                  </div>
                </div>
                {/* #996: 窄版这一段整条下沉到第二行(`w-full`),所以 320px 下这一行是
                    「图标 + 名字/价签」一行、「状态/按钮 + 序号」一行 —— 双列改单列。 */}
                <div className={CARD_LIST_ROW_TRAIL_CLASS}>
                  <div className="shrink-0">
                    {isCancelled ? (
                      <Badge variant="default">Canceled</Badge>
                    ) : isFailed ? (
                      <Badge variant="destructive">Failed</Badge>
                    ) : isDone ? (
                      <Badge variant="success">Started</Badge>
                    ) : isGenerating ? (
                      <Badge variant="info">
                        <Spinner aria-hidden="true" />
                        Starting
                      </Badge>
                    ) : canMakeThis && c.credits !== null ? (
                      // #896: one press, price on it. `c.credits !== null` is what
                      // `affordableIdleCards` already guarantees — spelled out so the label
                      // can name the number without a `!`.
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={running}
                        onClick={() => void runCards([c])}
                      >
                        {running && <Spinner data-icon="inline-start" aria-label="Starting item" />}
                        {running ? "Starting…" : `Make this · ${creditsLabel(c.credits)}`}
                      </Button>
                    ) : (
                      <Badge variant="default">Queued</Badge>
                    )}
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">
                    #{idx + 1}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      {showFooter && (
        <CardFooter className="flex-col items-stretch">
          <Separator />
          {!allSubmitted && totalCredits === null && (
            <Alert role="alert" variant="warning" density="compact">
              <AlertTitle>Pack price unavailable</AlertTitle>
              <AlertDescription>{PACK_UNPRICED_NOTE}</AlertDescription>
            </Alert>
          )}

          {!allSubmitted && totalCredits !== null && (
            <>
              {!canAfford && (
                // #707 gave the top-up half a real link. #786 makes the other half true: the
                // pack renders as ONE card, so "approve them individually" pointed at controls
                // that did not exist. The alternative is now named only when `offerIndividual`
                // says the rows above really carry it — TopUpNotice's own rule is "no
                // alternative unless there really is one", and this is that rule being kept.
                <TopUpNotice
                  need={`make all ${idleCards.length}`}
                  alternative={offerIndividual ? "approve them individually" : undefined}
                />
              )}

              {running ? (
                <SpendProgress
                  title="Starting your pack"
                  description={`Starting ${idleCards.length} ${idleCards.length === 1 ? "item" : "items"} one at a time.`}
                />
              ) : (
                <SpendConfirmation
                  title={
                    <span className="font-bold @max-[420px]:text-[1.125rem] @min-[420px]:text-[1.375rem]">
                      Total <CardMoney>{creditsLabel(totalCredits)}</CardMoney>
                    </span>
                  }
                  description={`${idleCards.length} ${idleCards.length === 1 ? "item" : "items"}. Each item starts after the previous one is accepted.`}
                >
                  {/* #896: the batch button already carried the count and the total, so the
                      second screen only re-read them back. One press. */}
                  <Button
                    variant="default"
                    size="sm"
                    disabled={!canAfford}
                    onClick={() => void makeAll()}
                  >
                    Make all ({idleCards.length} · {creditsLabel(totalCredits)})
                  </Button>
                </SpendConfirmation>
              )}
            </>
          )}

          {allSubmitted && !running && startedCount > 0 && (
            <Alert variant="success" density="compact">
              <AlertTitle>
                {startedCount === cards.length ? `All ${cards.length}` : `${startedCount} of ${cards.length}`} {cards.length === 1 ? "item" : "items"} started
              </AlertTitle>
            </Alert>
          )}

          {/* #498 round-4: chained needs_approval observed in this loop — the SERVER's
              localized receipt verbatim (the still-pending cards keep their own
              approve gates; no spend logic here). */}
          {chainedReceipt && (
            <Alert density="compact">
              <AlertDescription>{chainedReceipt}</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert role="alert" variant="destructive" density="compact">
              <AlertTitle>Pack wasn&apos;t completed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

export default PackCard;
