"use client";
import React from "react";

/**
 * OTTO's live step-trace — the agent narrating what it's doing, Grok-style but in
 * OTTO's voice. Purely presentational: it renders a `steps[]` derived elsewhere from
 * the signals the agent already emits (stream status / message kinds). No data, no
 * spend — display only. Tokens are .gb (shadcn) vars; coral = OTTO (var(--brand)).
 */

export type TraceStepStatus = "done" | "active" | "pending";
export interface TraceStep {
  /** Sentence-case, e.g. "Making image 1 of 3". */
  label: string;
  status: TraceStepStatus;
  /** Optional mono detail, e.g. "cozy · warm". */
  detail?: string;
}

const CORAL_INK = "#9A3A1A"; // OTTO's dark-coral text — reads on coral-soft in both skins

function OttoGlyph({ size = 17 }: { size?: number }) {
  const h = Math.round((size * 22) / 24);
  return (
    <svg width={size} height={h} viewBox="0 0 120 110" aria-hidden style={{ flexShrink: 0 }}>
      <g fill="var(--brand)">
        <ellipse cx="60" cy="64" rx="43" ry="22" />
        <circle cx="37" cy="52" r="18" />
        <circle cx="61" cy="40" r="24" />
        <circle cx="85" cy="53" r="17" />
      </g>
    </svg>
  );
}

function StepRow({ step }: { step: TraceStep }) {
  const { label, status, detail } = step;
  const isActive = status === "active";
  const isDone = status === "done";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "7px 0.5rem",
        borderRadius: "10px",
        background: isActive ? "var(--brand-soft)" : "transparent",
        fontSize: "0.875rem",
        color: isActive ? CORAL_INK : isDone ? "var(--foreground)" : "var(--muted-foreground)",
      }}
    >
      <span
        style={{
          width: 19,
          height: 19,
          borderRadius: "50%",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isDone ? "var(--success-soft)" : isActive ? "var(--brand)" : "transparent",
          border: status === "pending" ? "1.6px solid var(--border)" : "none",
          color: isDone ? "var(--success-soft-foreground)" : "#fff",
        }}
      >
        {isDone && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
        {isActive && (
          <span
            className="otto-trace-spin"
            style={{
              width: 11,
              height: 11,
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,.45)",
              borderTopColor: "#fff",
            }}
          />
        )}
      </span>
      <span style={{ flex: 1, fontWeight: isActive ? 600 : 400 }}>
        {label}
      </span>
      {isActive ? (
        <span style={{ width: 48, height: 5, borderRadius: 99, background: "rgba(236,88,40,.22)", overflow: "hidden", position: "relative" }}>
          <span className="otto-trace-bar" style={{ position: "absolute", top: 0, left: 0, height: "100%", width: "45%", background: "var(--brand)", borderRadius: 99 }} />
        </span>
      ) : detail ? (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted-foreground)" }}>{detail}</span>
      ) : null}
    </div>
  );
}

export function OttoTrace({ steps, title = "OTTO is making it" }: { steps: TraceStep[]; title?: string }) {
  if (!steps.length) return null;
  const total = steps.length;
  const activeIdx = steps.findIndex((s) => s.status === "active");
  const doneCount = steps.filter((s) => s.status === "done").length;
  const allDone = doneCount === total;
  const counter = activeIdx >= 0 ? `step ${activeIdx + 1} of ${total}` : allDone ? "done" : `${doneCount} of ${total}`;

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div
      className="gb leading-[1.5]"
      style={{
        border: "1px solid var(--brand-soft)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
        boxShadow: "var(--shadow-sm)",
        background: "var(--card)",
      }}
    >
      <style>{`
        @keyframes otto-trace-spin { to { transform: rotate(360deg); } }
        .otto-trace-spin { animation: otto-trace-spin 0.7s linear infinite; }
        @keyframes otto-trace-bar { 0%{left:-45%} 100%{left:100%} }
        .otto-trace-bar { animation: otto-trace-bar 1.1s var(--ease-in-out, ease-in-out) infinite; }
        @media (prefers-reduced-motion: reduce) {
          .otto-trace-spin, .otto-trace-bar { animation: none; }
        }
      `}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "11px 0.75rem",
          background: "var(--brand-soft)",
        }}
      >
        <OttoGlyph size={17} />
        <span style={{ flex: 1, fontSize: "0.875rem", fontWeight: 700, color: CORAL_INK }}>{title}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--brand)" }}>{counter}</span>
      </div>
      <div style={{ padding: "7px 5px", display: "flex", flexDirection: "column" }}>
        {steps.map((s, i) => (
          <StepRow key={i} step={s} />
        ))}
      </div>
    </div>
  );
}

/**
 * Canvas status pill — mirrors OTTO's current step onto the board (Grok pattern),
 * so progress is visible while watching the output. Dark pill, coral OTTO glyph.
 */
export function OttoCanvasStatus({ label }: { label: string }) {
  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div
      className="gb leading-[1.5]"
      style={{
        position: "absolute",
        top: "1rem",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 6,
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        background: "#0A0A0A",
        color: "#fff",
        padding: "8px 0.75rem",
        borderRadius: 999,
        boxShadow: "var(--shadow-lg)",
        fontSize: "0.875rem",
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      <svg width="15" height="14" viewBox="0 0 120 110" aria-hidden>
        <g fill="var(--brand)">
          <ellipse cx="60" cy="64" rx="43" ry="22" />
          <circle cx="37" cy="52" r="18" />
          <circle cx="61" cy="40" r="24" />
          <circle cx="85" cy="53" r="17" />
        </g>
      </svg>
      <span style={{ opacity: 0.55 }}>OTTO</span>
      <span style={{ width: 1, height: 13, background: "rgba(255,255,255,.25)" }} />
      <span style={{ color: "#F4A585" }}>{label}</span>
    </div>
  );
}
