"use client";
import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  CircleDollarSign,
  Clapperboard,
  ShieldCheck,
  ShoppingBag,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { ottoTurn } from "@/lib/otto-client-actions";
import { startStreamedThread } from "@/lib/otto-start-thread";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { activeMentionQuery, resolveSentEntityIds } from "@/lib/otto-mentions";
import { QuickBrief } from "@/components/otto/QuickBrief";
import { OttoMentionPopover } from "@/components/otto/OttoMentionPopover";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";
import { ottoGreeting } from "@/lib/otto-greeting";
import { CHAT_HOLD_NOTE, CHAT_SPEND_NOTE, lowBalanceForVideoMessage } from "@/lib/credit-format";
import { ExitLink } from "@/components/exits/Exits";
import { BILLING_HREF } from "@/lib/exits";
import { defaultVideoDisplayCredits, INTERNAL_PER_DISPLAY } from "@fikirtive/core/spend";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { CANVAS_OTTO_DOCK_ATTR } from "@/lib/canvas-otto-dock";
import {
  FRONT_DOOR_GOAL_LABELS, type FrontDoorGoalKey,
} from "@/lib/otto-canned-starters";

interface GoalTile {
  /** #979:标签**不在这里写** —— 点一下发出去的就是这句话本身,而那是我们的文案,不是
   *  商家的命名。唯一权威在 `lib/otto-canned-starters` 的 `FRONT_DOOR_GOAL_LABELS`,
   *  命名守卫认的就是那一份。 */
  label: string;
  hint: string;
  goalKey: FrontDoorGoalKey;
  icon: LucideIcon;
}

const GOAL_TILES: GoalTile[] = [
  {
    label: FRONT_DOOR_GOAL_LABELS["sell-product"],
    hint: "Turn one product into a campaign",
    goalKey: "sell-product",
    icon: ShoppingBag,
  },
  {
    label: FRONT_DOOR_GOAL_LABELS["announce-sale"],
    hint: "Build a promotion for this week",
    goalKey: "announce-sale",
    icon: Tags,
  },
  {
    label: FRONT_DOOR_GOAL_LABELS["get-followers"],
    hint: "Plan content that grows your audience",
    goalKey: "get-followers",
    icon: Users,
  },
  {
    label: FRONT_DOOR_GOAL_LABELS["make-video"],
    hint: "Create a short video for social",
    goalKey: "make-video",
    icon: Clapperboard,
  },
];

export interface OttoFrontDoorProps {
  projectId: string;
  /** Org spendable balance in USD — the same value the cards' afford gate reads.
   *  Drives the #791-7 early low-balance line below the composer. */
  balanceUsd?: number;
  entities: EntityDTO[];
  userName: string;
  onThreadStarted: (thread: ChatThreadDTO) => void;
  /** Streaming path: an empty thread was created; hand its first message up so
   *  OttoChatStream streams it in on mount. Used only when provided. */
  onStreamStart?: (thread: ChatThreadDTO, pending: { text: string; goalKey?: string; entityIds?: string[] }) => void;
  /** When set (e.g. from Discover), pre-fills the composer. */
  seedText?: string;
  /** Called once the seed has been applied so the parent can clear it — otherwise a stale
   *  seed re-fills an unrelated NEW conversation later (F29). */
  onSeedConsumed?: () => void;
  /** Canvas uses the same conversation action with a spatial, minimal shell. */
  layout?: "default" | "canvas";
}

export function OttoFrontDoor({
  projectId,
  balanceUsd,
  entities,
  userName,
  onThreadStarted,
  onStreamStart,
  seedText,
  onSeedConsumed,
  layout = "default",
}: OttoFrontDoorProps) {
  const [text, setText] = useState("");
  // #791-7: below one video's price, say so now. Balance arrives in USD (the same value the
  // cards' afford gate uses); cents are rounded before the 10-cent divide so 0.3/0.1 style
  // float error can't shift the number the merchant reads.
  const videoCredits = defaultVideoDisplayCredits();
  const balanceCredits =
    balanceUsd === undefined ? null : Math.round(balanceUsd * 100) / INTERNAL_PER_DISPLAY;
  const lowBalanceNotice =
    balanceCredits !== null && balanceCredits < videoCredits
      ? lowBalanceForVideoMessage(balanceCredits, videoCredits)
      : null;
  // Discover "Use in Otto": pre-fill the composer when a seed arrives (no auto-send), then tell
  // the parent to clear it (F29) so it can't leak into a later unrelated conversation. Repeat-use
  // of the same idea still works: the parent re-sets seedText ("" → prompt is a real change).
  useEffect(() => {
    if (!seedText) return;
    const frame = window.requestAnimationFrame(() => {
      setText(seedText);
      onSeedConsumed?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [seedText, onSeedConsumed]);
  const [pickedMentions, setPickedMentions] = useState<{id: string; name: string}[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const mentionListId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Synchronous latch: two fast clicks / Enter+tile both pass the async `busy` check
  // before the re-render, and each would start a NEW thread (no threadId). Guards the
  // front door so it can't duplicate conversations.
  const startingRef = useRef(false);

  // #542 — the sentence itself lives in lib/otto-greeting.ts so the tests assert against the
  // SAME string this renders, not a re-typed copy of it (round-2 review P2).
  const greeting = ottoGreeting(userName);

  const mentionSuggestions = mentionQuery !== null
    ? (entities ?? []).filter(e => e.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
    : [];

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    const caret = e.target.selectionStart ?? val.length;
    setMentionQuery(activeMentionQuery(val, caret));
    setMentionHighlight(0);
  };

  const selectMention = (entity: {id: string; name: string}) => {
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const atIdx = before.lastIndexOf("@");
    const newText = text.slice(0, atIdx) + `@${entity.name} ` + text.slice(caret);
    setText(newText);
    setPickedMentions(prev => prev.some(p => p.id === entity.id) ? prev : [...prev, {id: entity.id, name: entity.name}]);
    setMentionQuery(null);
    setMentionHighlight(0);
    setTimeout(() => textarea?.focus(), 0);
  };

  const dismissMentions = () => {
    setMentionQuery(null);
    setMentionHighlight(0);
  };

  async function start(opts: { goalKey?: GoalTile["goalKey"] }) {
    const msgText = opts.goalKey
      ? (GOAL_TILES.find((g) => g.goalKey === opts.goalKey)?.label ?? text.trim())
      : text.trim();
    if (!msgText || busy || startingRef.current) return;
    startingRef.current = true;
    setBusy(true);
    setError(null);
    const entityIds = resolveSentEntityIds(msgText, pickedMentions);
    // Only the non-streaming fallback below meters credits from HERE. The streaming branch
    // hands the first message to OttoChatStream and returns having spent nothing, so it must
    // not announce a balance change (round-2 review P2 — a "refresh" that follows no charge
    // is noise that makes the real ones less trustworthy).
    let metered = false;
    try {
      // Streaming front door: create an empty thread (no first turn, no spend), then
      // hand the first message to OttoChatStream which streams it in on mount. The
      // thread row already exists, so the route's existing-thread branch handles it.
      // Note: OttoView always provides onStreamStart; if somehow absent the code falls
      // through to the classic ottoTurn path.
      if (onStreamStart) {
        // #995:这一步(建空会话 + 乐观标题 + 交出第一句话)搬进 lib/otto-start-thread.ts,
        // 面板底部的页面 chips 走的是同一份 —— 两处各写一份,先漂的一定是 #979 的标题守卫。
        // F30: 解析出来的 @mention entityIds 一并带进第一条流式消息(下面那条经典 ottoTurn
        // 路径本来就带,流式这一条不带就等于第一轮悄悄丢了实体条件)。
        const started = await startStreamedThread({ projectId, text: msgText, goalKey: opts.goalKey, entityIds });
        if ("error" in started) {
          setError(started.error);
          return;
        }
        onStreamStart(started.thread, started.pending);
        return;
      }

      // Past this point the turn can reserve credits — even a thrown transport error cannot
      // prove it did not, so the finally must announce.
      metered = true;
      const res = await ottoTurn({
        projectId,
        text: msgText,
        entityIds,
        variantSel: {},
        simple: true,
        ...(opts.goalKey ? { goalKey: opts.goalKey } : {}),
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      // Fetch the full thread so we can render it immediately
      const fresh = await getCoworkThreadClient(res.threadId);
      if (fresh) {
        onThreadStarted(fresh);
      }
    } catch {
      setError("Couldn't reach Otto — please try again.");
    } finally {
      setBusy(false);
      startingRef.current = false;
      // In a finally on purpose (#550): once the metered call has been entered, no exit path
      // proves zero spend — success, handled error, and thrown transport failure all have to
      // re-read the balance.
      if (metered) notifyBalanceRefresh();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionSuggestions.length > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionHighlight(h => Math.max(0, h - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionHighlight(h => Math.min(mentionSuggestions.length - 1, h + 1));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        selectMention(mentionSuggestions[mentionHighlight]);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        selectMention(mentionSuggestions[mentionHighlight]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        setMentionHighlight(0);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void start({});
    }
  }

  const composer = (
    <OttoMentionPopover
      suggestions={mentionSuggestions}
      highlightedIndex={mentionHighlight}
      listId={mentionListId}
      onDismiss={dismissMentions}
      onHighlightChange={setMentionHighlight}
      onSelect={selectMention}
    >
      <InputGroup className="overflow-hidden rounded-[var(--radius-card)]">
        <InputGroupTextarea
          ref={textareaRef}
          aria-label="Describe what you want to make"
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          aria-autocomplete="list"
          aria-controls={mentionSuggestions.length > 0 ? mentionListId : undefined}
          aria-expanded={mentionSuggestions.length > 0}
          aria-activedescendant={mentionSuggestions.length > 0 ? `${mentionListId}-option-${mentionHighlight}` : undefined}
          disabled={busy}
          placeholder="Describe what you want to make…"
          rows={3}
          className="field-sizing-fixed min-h-0 w-full px-4 text-[0.90625rem] leading-[1.5]"
        />
        <InputGroupAddon align="block-end" className="justify-between border-t border-border">
          <span className="text-xs font-normal text-muted-foreground">Enter to send</span>
          <InputGroupButton
            variant="default"
            size="sm"
            motion="instant"
            disabled={busy || !text.trim()}
            onClick={() => void start({})}
          >
            {busy ? (
              <Spinner data-icon="inline-start" aria-label="Starting conversation" />
            ) : (
              <ArrowUp data-icon="inline-start" aria-hidden="true" />
            )}
            {busy ? "Starting…" : "Send"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </OttoMentionPopover>
  );

  if (layout === "canvas") {
    return (
      // 这一层是**定位框**,不是一张纸 —— 所以它不带 `gb`(2026-09-03 走查 D1 的另一半)。
      // `.gb` 是 token 根,而 token 根在 globals.css 里自己 `background-color: var(--background)`:
      // 一个 `inset-0` 的 `.gb` 就是一张铺满整块画板的不透明纸,盖在 z-index 5 的画布之上。
      // 它 `pointer-events: none`,所以 `elementFromPoint` 照样穿过去 —— 只有商家的眼睛穿不过去。
      // 实测(1440×900 生产构建):点阵底纹、工具条、板上的卡全部被它遮掉;把它设成透明,画板
      // 立刻回来。画布路由永远渲染在 `.gb.ns-immersive` 壳根里
      // (components/northstar/immersive/immersive-shell.tsx),token 本来就继承得到,这一份
      // 嵌套的 `gb` 只多做了两件坏事:铺纸,以及把沉浸壳的 scoped 覆盖
      // (`app/create/immersive-tokens.css` 的 --background / --ring / --info)重置回全局值。
      <div className="pointer-events-none absolute inset-0 z-30 leading-[1.5]">
        <div className="pointer-events-auto absolute left-4 top-4 w-[280px] rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-sm)]">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="flex items-center gap-2 text-xs font-semibold">
              <OttoAvatar size={22} state={busy ? "thinking" : "idle"} />
              Otto
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`size-1.5 rounded-full ${busy ? "bg-brand" : "bg-muted-foreground/40"}`} />
              {busy ? "Starting" : "Ready"}
            </span>
          </div>
          <p className="px-3 py-3 text-sm leading-5 text-foreground">
            Tell Otto what you want to create or change.
          </p>
        </div>

        {/* 已批准 pattern 的创作带(`.cv-creation-band`:`bottom-4 left-[300px] right-[160px]`、
            居中、`max-w-[620px]`,数字只在 globals.css 声明一次)。右边那 160px 是 pattern
            留给右下角缩放簇的角 —— 原来的 `left-[calc(50%+140px)]` 不留,于是压住它。
            这一块占掉画布底边多少高度由 NorthstarCanvasWorkspace 量出来,交给画布创作列让位
            (2026-09-03 走查 D1,病根全文在 `lib/canvas-otto-dock.ts`)。记号挂在**整块**上,
            所以下面那条报错也算进让位高度里 —— 报错一冒出来就把工具条重新盖住,是同一个缺陷
            的下一次发作。 */}
        <div
          {...{ [CANVAS_OTTO_DOCK_ATTR]: "" }}
          className="cv-creation-band pointer-events-auto"
        >
          {composer}
          {error ? (
            <Alert role="alert" variant="destructive" className="mt-2">
              <AlertTitle>Conversation couldn&apos;t start</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>
    );
  }

  // leading-[1.5] — design-baseline body line-height (Analytics standard)
  return (
    <div className="otto-front-door gb flex flex-1 flex-col items-center justify-start overflow-auto px-5 py-6 leading-[1.5]">
      {/* my-auto (not the container's justify-center) — safe centering inside a scroll
          container: auto main-axis margins take the free space when the content fits, and
          collapse to 0 when it overflows, so the top never lands above scrollTop 0. */}
      <div className="otto-front-door-inner my-auto flex w-full max-w-[600px] flex-col gap-6">
        {/* Otto avatar + greeting */}
        <div className="flex items-start gap-3">
          <OttoAvatar size={44} state={busy ? "thinking" : "idle"} />
          <div className="min-w-0 pt-0.5">
            <h1 className="text-xl font-bold leading-tight tracking-[-0.02em] text-foreground">
              {greeting}
            </h1>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              {/* #805 — Otto's in-app self-introduction says what comes back finished, not how
                  pleasant the conversation is. */}
              Tell me in your own words, or pick a goal below. No experience needed — I&apos;ll do the work and bring it back for you to approve.
            </p>
          </div>
        </div>

        {/* Composer */}
        <div className="w-full">
          {composer}
        </div>

        {error && (
          <Alert role="alert" variant="destructive">
            <AlertTitle>Conversation couldn&apos;t start</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Goal starters — merchant actions stay neutral; coral is reserved for Otto itself. */}
        <section className="flex w-full flex-col gap-3" aria-labelledby="otto-goal-heading">
          <div className="flex flex-col gap-0.5">
            <h2 id="otto-goal-heading" className="text-sm font-semibold text-foreground">
              Start with a goal
            </h2>
            <p className="text-xs text-muted-foreground">
              Otto will turn it into a plan for you to review.
            </p>
          </div>
          <div className="otto-goal-grid grid grid-cols-2 gap-2 max-[480px]:grid-cols-1">
            {GOAL_TILES.map((goal) => {
              const GoalIcon = goal.icon;
              return (
                <Button
                  key={goal.goalKey}
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => start({ goalKey: goal.goalKey })}
                  className="h-auto min-h-20 w-full justify-start gap-3 whitespace-normal p-3 text-left"
                >
                  <GoalIcon data-icon="inline-start" aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                    <span className="text-[13px] font-semibold text-foreground">
                      {goal.label}
                    </span>
                    <span className="text-xs font-normal leading-4 text-muted-foreground">
                      {goal.hint}
                    </span>
                  </span>
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Button>
              );
            })}
          </div>
        </section>

        {/* Quick brief */}
        <div className="flex flex-col gap-3">
          <Separator />
          <QuickBrief projectId={projectId} />
        </div>

        {/* #791-7: say it while they still have a choice. Below one video's price is the
            point where the next thing they ask for cannot be paid for, and being told that
            here is worth more than being stopped later. Rendered only when the balance is
            actually known — an unknown balance says nothing. */}
        {lowBalanceNotice ? (
          <Alert role="status" variant="warning" density="compact">
            <CircleDollarSign aria-hidden="true" />
            <AlertTitle>Low balance for video</AlertTitle>
            <AlertDescription>
              <span>{lowBalanceNotice}</span>
              <ExitLink href={BILLING_HREF}>Top up in Billing</ExitLink>
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Standing trust note: the approval boundary and conversation charge are related,
            but not the same promise. Keep both explicit in one readable callout. */}
        <Alert density="compact">
          <ShieldCheck aria-hidden="true" />
          <AlertTitle>You stay in control</AlertTitle>
          <AlertDescription>
            <span>Otto plans and makes it — creations start only after you confirm on the card.</span>
            <span>{CHAT_SPEND_NOTE}</span>
            {/* #791-9: the hold is named before the first turn, so the temporary balance dip
                cannot read like an accounting bug. */}
            <span>{CHAT_HOLD_NOTE}</span>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

export default OttoFrontDoor;
