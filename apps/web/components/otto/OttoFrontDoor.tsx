"use client";
import React, { useRef, useState } from "react";
import { OttoAvatar } from "@/components/fk";
import { Button } from "@/components/fk";
import { ottoTurn, createEmptyCoworkThread } from "@/lib/otto-client-actions";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";

interface GoalTile {
  label: string;
  hint: string;
  goalKey: "sell-product" | "announce-sale" | "get-followers" | "make-video";
  icon: React.ReactNode;
}

function IconShoppingBag() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" x2="21" y1="6" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}
function IconTag() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
      <path d="M7 7h.01" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconClapperboard() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
  onStreamStart?: (thread: ChatThreadDTO, pending: { text: string; goalKey?: string }) => void;
}

export function OttoFrontDoor({
  projectId,
  entities,
  userName,
  onThreadStarted,
  ottoStreamEnabled,
  onStreamStart,
}: OttoFrontDoorProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Synchronous latch: two fast clicks / Enter+tile both pass the async `busy` check
  // before the re-render, and each would start a NEW thread (no threadId). Mirror
  // OttoConversation.send()'s busyRef guard so the front door can't duplicate campaigns.
  const startingRef = useRef(false);

  const firstName = userName.split(".")[0];
  const greeting = `Hi ${firstName} — what should we make today?`;

  async function start(opts: { goalKey?: GoalTile["goalKey"] }) {
    const msgText = opts.goalKey
      ? (GOAL_TILES.find((g) => g.goalKey === opts.goalKey)?.label ?? text.trim())
      : text.trim();
    if (!msgText || busy || startingRef.current) return;
    startingRef.current = true;
    setBusy(true);
    setError(null);
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
        onStreamStart(thread, { text: msgText, ...(opts.goalKey ? { goalKey: opts.goalKey } : {}) });
        return;
      }

      const res = await ottoTurn({
        projectId,
        text: msgText,
        entityIds: [],
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
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      start({});
    }
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-8) var(--space-6)",
        overflow: "auto",
      }}
    >
      <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-6)" }}>
        {/* Otto avatar + greeting */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-4)", textAlign: "center" }}>
          <OttoAvatar size={76} state={busy ? "thinking" : "idle"} />
          <div>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: "var(--weight-bold)",
                fontSize: "var(--text-2xl)",
                color: "var(--text-strong)",
                letterSpacing: "var(--tracking-tight)",
                margin: "0 0 var(--space-2)",
                lineHeight: "var(--leading-snug)",
              }}
            >
              {greeting}
            </h1>
            <p style={{ fontSize: "var(--text-base)", color: "var(--text-muted)", margin: 0, lineHeight: "var(--leading-normal)" }}>
              Tell me in your own words, or pick a goal below. No experience needed — I&apos;ll guide you through it.
            </p>
          </div>
        </div>

        {/* Composer */}
        <div
          style={{
            width: "100%",
            background: "var(--surface-card)",
            borderRadius: "var(--radius-xl)",
            border: "1.5px solid var(--border-default)",
            boxShadow: "var(--shadow-md)",
            overflow: "hidden",
          }}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
            placeholder="Describe what you want to make…"
            rows={3}
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              resize: "none",
              padding: "var(--space-4) var(--space-5)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-base)",
              color: "var(--text-body)",
              background: "transparent",
              lineHeight: "var(--leading-relaxed)",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "var(--space-3) var(--space-4)",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !text.trim()}
              onClick={() => start({})}
            >
              {busy ? "Starting…" : "Let's go"}
            </Button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              width: "100%",
              padding: "var(--space-3) var(--space-4)",
              borderRadius: "var(--radius-md)",
              background: "var(--error-100)",
              color: "var(--error-700)",
              fontSize: "var(--text-sm)",
            }}
          >
            {error}
          </div>
        )}

        {/* Goal chips */}
        <div style={{ width: "100%" }}>
          <div
            style={{
              fontSize: "var(--text-xs)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--text-faint)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-caps)",
              marginBottom: "var(--space-3)",
              textAlign: "center",
            }}
          >
            Or pick a goal
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "var(--space-3)",
            }}
          >
            {GOAL_TILES.map((goal) => (
              <button
                key={goal.goalKey}
                disabled={busy}
                onClick={() => start({ goalKey: goal.goalKey })}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "var(--space-2)",
                  padding: "var(--space-4)",
                  background: "var(--surface-card)",
                  border: "1.5px solid var(--border-subtle)",
                  borderRadius: "var(--radius-lg)",
                  cursor: busy ? "not-allowed" : "pointer",
                  textAlign: "left",
                  transition: "var(--transition-control)",
                  opacity: busy ? 0.6 : 1,
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div style={{ color: "var(--brand)" }}>{goal.icon}</div>
                <div>
                  <div
                    style={{
                      fontWeight: "var(--weight-semibold)",
                      fontSize: "var(--text-sm)",
                      color: "var(--text-strong)",
                      marginBottom: 2,
                    }}
                  >
                    {goal.label}
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    {goal.hint}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Trust line */}
        <p
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-faint)",
            textAlign: "center",
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/otto.svg" width={16} height={16} alt="" style={{ display: "inline", verticalAlign: "middle" }} />
          Otto plans and makes it — you approve before anything costs money.
        </p>
      </div>
    </div>
  );
}

export default OttoFrontDoor;
