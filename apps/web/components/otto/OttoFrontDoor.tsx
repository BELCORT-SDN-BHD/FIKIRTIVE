"use client";
import React, { useEffect, useRef, useState } from "react";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Button } from "@/components/ui/button";
import { ottoTurn, createEmptyCoworkThread } from "@/lib/otto-client-actions";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { activeMentionQuery, resolveSentEntityIds } from "@/lib/otto-mentions";
import { QuickBrief } from "@/components/otto/QuickBrief";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";
import { ottoGreetingName } from "@/lib/otto-greeting";
import { CHAT_SPEND_NOTE } from "@/lib/credit-format";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";

interface GoalTile {
  label: string;
  hint: string;
  goalKey: "sell-product" | "announce-sale" | "get-followers" | "make-video";
  icon: React.ReactNode;
}

function IconShoppingBag() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" x2="21" y1="6" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}
function IconTag() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
      <path d="M7 7h.01" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconClapperboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1-.3 2.1.3 2.4 1.3Z" />
      <path d="m6.2 5.3 3.1 3.9" />
      <path d="m12.4 3.4 3.1 4" />
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

const GOAL_TILES: GoalTile[] = [
  {
    label: "Sell a product",
    hint: "Show off one thing you make",
    goalKey: "sell-product",
    icon: <IconShoppingBag />,
  },
  {
    label: "Announce a sale",
    hint: "Get people in this week",
    goalKey: "announce-sale",
    icon: <IconTag />,
  },
  {
    label: "Get more followers",
    hint: "Grow your audience",
    goalKey: "get-followers",
    icon: <IconUsers />,
  },
  {
    label: "Make a video",
    hint: "A short clip for social",
    goalKey: "make-video",
    icon: <IconClapperboard />,
  },
];

export interface OttoFrontDoorProps {
  projectId: string;
  entities: EntityDTO[];
  userName: string;
  onThreadStarted: (thread: ChatThreadDTO) => void;
  /** Founder streaming flag. When true, the first message streams (see onStreamStart). */
  ottoStreamEnabled?: boolean;
  /** Streaming path: an empty thread was created; hand its first message up so
   *  OttoChatStream streams it in on mount. Used only when ottoStreamEnabled. */
  onStreamStart?: (thread: ChatThreadDTO, pending: { text: string; goalKey?: string; entityIds?: string[] }) => void;
  /** When set (e.g. from Discover), pre-fills the composer. */
  seedText?: string;
  /** Called once the seed has been applied so the parent can clear it — otherwise a stale
   *  seed re-fills an unrelated NEW conversation later (F29). */
  onSeedConsumed?: () => void;
}

export function OttoFrontDoor({
  projectId,
  entities,
  userName,
  onThreadStarted,
  ottoStreamEnabled,
  onStreamStart,
  seedText,
  onSeedConsumed,
}: OttoFrontDoorProps) {
  const [text, setText] = useState("");
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Synchronous latch: two fast clicks / Enter+tile both pass the async `busy` check
  // before the re-render, and each would start a NEW thread (no threadId). Mirror
  // OttoConversation.send()'s busyRef guard so the front door can't duplicate campaigns.
  const startingRef = useRef(false);

  const greeting = `Hi ${ottoGreetingName(userName)} — what should we make today?`;

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
      // Note: when ottoStreamEnabled is true, onStreamStart MUST be provided (OttoView
      // always passes it); if somehow absent the code falls through to the classic ottoTurn path.
      if (ottoStreamEnabled && onStreamStart) {
        const created = await createEmptyCoworkThread({ projectId, title: msgText });
        if ("error" in created) {
          setError(created.error);
          return;
        }
        const thread: ChatThreadDTO = {
          id: created.id,
          projectId,
          title: msgText.slice(0, 80),
          updatedAt: new Date().toISOString(),
          messages: [],
        };
        // F30: carry the resolved @mention entityIds into the first streamed message — the
        // classic ottoTurn path below already passes them, so the streaming path must too or
        // the thread's first turn silently loses entity conditioning.
        onStreamStart(thread, { text: msgText, ...(opts.goalKey ? { goalKey: opts.goalKey } : {}), ...(entityIds.length ? { entityIds } : {}) });
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
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      void start({});
    }
  }

  // leading-[1.5] — design-baseline body line-height (Analytics standard)
  return (
    <div className="otto-front-door gb flex flex-1 flex-col items-center justify-center overflow-auto px-6 py-8 leading-[1.5]">
      <style>{`
        @media (max-width: 480px) {
          .otto-goal-grid { grid-template-columns: 1fr !important; }
          .otto-front-door-inner { padding: 1rem 1rem !important; }
        }
      `}</style>
      <div className="otto-front-door-inner flex w-full max-w-[560px] flex-col items-center gap-6">
        {/* Otto avatar + greeting */}
        <div className="flex flex-col items-center gap-4 text-center">
          <OttoAvatar size={64} state={busy ? "thinking" : "idle"} />
          <div>
            <h1 className="m-0 mb-2 text-[1.5rem] font-bold tracking-[-0.02em] text-foreground" style={{ lineHeight: 1.2 }}>
              {greeting}
            </h1>
            <p className="m-0 text-[0.875rem] text-muted-foreground leading-normal">
              Tell me in your own words, or pick a goal below. No experience needed — I&apos;ll guide you through it.
            </p>
          </div>
        </div>

        {/* Composer */}
        <div className="relative w-full">
          {mentionSuggestions.length > 0 && (
            <div
              role="listbox"
              className="absolute bottom-full left-0 mb-1 w-64 overflow-hidden rounded-[14px] border border-border bg-card z-50"
              style={{ boxShadow: "0 18px 40px rgba(20 18 14 / 0.10), 0 6px 14px rgba(20 18 14 / 0.07)" }}
            >
              {mentionSuggestions.map((e, i) => (
                <button
                  key={e.id}
                  role="option"
                  aria-selected={i === mentionHighlight}
                  onMouseDown={(ev) => { ev.preventDefault(); selectMention(e); }}
                  className="block w-full cursor-pointer border-none px-3 py-2 text-left text-[0.875rem] text-foreground"
                  style={{
                    background: i === mentionHighlight ? "var(--muted)" : "transparent",
                  }}
                >
                  @{e.name}
                </button>
              ))}
            </div>
          )}
          <div
            className="w-full overflow-hidden rounded-[14px] border border-border bg-card"
            style={{ borderWidth: "1.5px", boxShadow: "0 8px 20px rgba(20 18 14 / 0.08), 0 2px 6px rgba(20 18 14 / 0.06)" }}
          >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            disabled={busy}
            placeholder="Describe what you want to make…"
            rows={3}
            className="w-full resize-none border-none bg-transparent px-5 py-4 text-[0.90625rem] text-foreground outline-none leading-[1.5]"
          />
          <div className="flex items-center justify-end border-t border-border px-4 py-3">
            <Button
              variant="default"
              size="sm"
              disabled={busy || !text.trim()}
              onClick={() => void start({})}
            >
              {busy ? "Starting…" : "Let's go"}
            </Button>
          </div>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="w-full rounded-[14px] bg-error-soft px-4 py-3 text-[0.875rem] text-[var(--error-soft-foreground)]"
          >
            {error}
          </div>
        )}

        {/* Goal chips */}
        <div className="w-full">
          <div className="mb-3 text-center text-[0.8125rem] font-semibold text-muted-foreground/70">
            Or pick a goal
          </div>
          <div
            className="otto-goal-grid grid gap-2"
            style={{ gridTemplateColumns: "1fr 1fr" }}
          >
            {GOAL_TILES.map((goal) => (
              <button
                key={goal.goalKey}
                disabled={busy}
                onClick={() => start({ goalKey: goal.goalKey })}
                className="flex flex-col items-start gap-[11px] rounded-[13px] border border-border bg-card py-[11px] px-[13px] text-left shadow-sm transition-colors duration-150"
                style={{
                  cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {/* Coral-soft chip: bg-brand-soft (coral tint) + coral icon color.
                    Under .gb, --brand is coral — NOT --accent (which is neutral gray).
                    Inversion trap: keeping var(--brand-soft) here would render gray. */}
                <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-brand-soft" style={{ color: "#B23A12" }}>
                  {goal.icon}
                </div>
                <div>
                  <div className="mb-0.5 text-[0.875rem] font-semibold text-foreground">
                    {goal.label}
                  </div>
                  <div className="text-[0.75rem] text-muted-foreground">
                    {goal.hint}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Quick brief */}
        <QuickBrief projectId={projectId} />

        {/* Trust line */}
        <p className="m-0 flex items-center gap-2 text-center text-[0.71875rem] text-muted-foreground/70">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/otto.svg" width={16} height={16} alt="" style={{ display: "inline", verticalAlign: "middle" }} />
          Otto plans and makes it — you approve before Otto makes anything. {CHAT_SPEND_NOTE}
        </p>
      </div>
    </div>
  );
}

export default OttoFrontDoor;
