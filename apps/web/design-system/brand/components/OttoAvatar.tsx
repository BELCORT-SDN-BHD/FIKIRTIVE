"use client";
import React from "react";

export const OTTO_MOODS = [
  "idle",
  "thinking",
  "helpful",
  "success",
  "warning",
  "error",
  "waiting",
  "approving",
] as const;

export type OttoMood = (typeof OTTO_MOODS)[number];
export type OttoState = Extract<OttoMood, "idle" | "thinking">;

export interface OttoAvatarProps {
  size?: number;
  mood?: OttoMood;
  /** Legacy prop kept for existing call sites. Prefer `mood` for new surfaces. */
  state?: OttoState;
  className?: string;
}

const KEYFRAMES_ID = "otto-avatar-keyframes";
const EYE_COLOR = "#2B1308";

const MOOD_META: Record<OttoMood, { label: string; tilt: number; glow?: string; animated?: boolean }> = {
  idle: { label: "Otto", tilt: 0 },
  thinking: {
    label: "Otto thinking",
    tilt: -2,
    glow: "drop-shadow(0 3px 10px color-mix(in oklab, var(--brand) 45%, transparent))",
    animated: true,
  },
  helpful: { label: "Otto helpful", tilt: 2 },
  success: {
    label: "Otto success",
    tilt: 0,
    glow: "drop-shadow(0 3px 9px color-mix(in oklab, var(--success, #16A34A) 26%, transparent))",
  },
  warning: {
    label: "Otto warning",
    tilt: -1,
    glow: "drop-shadow(0 3px 9px color-mix(in oklab, var(--warning, #D97706) 28%, transparent))",
  },
  error: {
    label: "Otto error",
    tilt: 0,
    glow: "drop-shadow(0 3px 9px color-mix(in oklab, var(--error, #D02F35) 24%, transparent))",
  },
  waiting: { label: "Otto waiting", tilt: 0 },
  approving: {
    label: "Otto approving",
    tilt: 1,
    glow: "drop-shadow(0 3px 10px color-mix(in oklab, var(--brand) 32%, transparent))",
  },
};

function ensureKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent = `
    @keyframes otto-avatar-bob {
      from { transform: translateY(0px); }
      to   { transform: translateY(-4px); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * OTTO — the coral cloud mark (coral is OTTO's colour only). This is OTTO's face
 * everywhere: sidebar logo, chat avatars, the front-door hero. Matches the
 * design-system ui_kits; never a boxed robot. Reactions are eyes + pose + subtle
 * glow, plus the small side decorations the official masters define per mood
 * (thought bubbles, a star, an approval badge) — never a mouth on the cloud
 * itself. `thinking` adds coral glow + bob.
 */
export function OttoAvatar({ size = 48, mood: moodProp, state = "idle", className }: OttoAvatarProps) {
  React.useEffect(() => {
    ensureKeyframes();
  }, []);

  const mood = moodProp ?? state;
  const meta = MOOD_META[mood];

  const svgStyle: React.CSSProperties = {
    display: "block",
    filter: meta.glow ?? "none",
    animation: meta.animated ? "otto-avatar-bob 1.4s ease-in-out infinite alternate" : "none",
    transition: "filter 0.2s ease",
  };

  return (
    <span className={className} style={{ display: "inline-flex", flexShrink: 0 }}>
      <svg
        width={size}
        height={Math.round((size * 110) / 120)}
        viewBox="0 0 120 110"
        role="img"
        aria-label={meta.label}
        style={svgStyle}
      >
        <g
          style={{
            transform: `rotate(${meta.tilt}deg)`,
            transformOrigin: "60px 56px",
            transition: "transform 0.18s ease",
          }}
        >
          <g fill="var(--brand)">
            <ellipse cx="60" cy="64" rx="43" ry="22" />
            <circle cx="37" cy="52" r="18" />
            <circle cx="61" cy="40" r="24" />
            <circle cx="85" cy="53" r="17" />
          </g>
          <OttoEyes mood={mood} />
        </g>
      </svg>
    </span>
  );
}

function OttoEyes({ mood }: { mood: OttoMood }) {
  switch (mood) {
    case "thinking":
      return (
        <g>
          <g fill={EYE_COLOR}>
            <rect x="53" y="44" width="7" height="13" rx="3.5" />
            <rect x="68" y="44" width="7" height="13" rx="3.5" />
          </g>
          <circle cx="97" cy="30" r="5" fill="var(--brand)" opacity="0.5" />
          <circle cx="107" cy="21" r="3.2" fill="var(--brand)" opacity="0.32" />
        </g>
      );
    case "helpful":
      return (
        <g fill="none" stroke={EYE_COLOR} strokeLinecap="round" strokeWidth="5">
          <path d="M49 57 q5.5 -7 11 0" />
          <path d="M64 57 q5.5 -7 11 0" />
        </g>
      );
    case "success":
      return (
        <g>
          <g fill="none" stroke={EYE_COLOR} strokeLinecap="round" strokeWidth="5">
            <path d="M49 57 q5.5 -7 11 0" />
            <path d="M64 57 q5.5 -7 11 0" />
          </g>
          <path
            d="M99 22 l4 8 8.5 1.2 -6 6 1.4 8.5 -7.9 -4.2 -7.9 4.2 1.4 -8.5 -6 -6 8.5 -1.2 z"
            fill="var(--brand)"
            opacity="0.6"
          />
        </g>
      );
    case "warning":
      return (
        <g>
          <g fill={EYE_COLOR}>
            <rect x="51" y="50" width="7" height="13" rx="3.5" />
            <rect x="66" y="50" width="7" height="13" rx="3.5" />
          </g>
          <path d="M46 42 l14 -4" fill="none" stroke={EYE_COLOR} strokeLinecap="round" strokeWidth="4.5" />
          <path d="M78 38 l-14 4" fill="none" stroke={EYE_COLOR} strokeLinecap="round" strokeWidth="4.5" />
        </g>
      );
    case "error":
      return (
        <g fill="none" stroke={EYE_COLOR} strokeLinecap="round" strokeWidth="5">
          <path d="M48 50 l10 10 M58 50 l-10 10" />
          <path d="M65 50 l10 10 M75 50 l-10 10" />
        </g>
      );
    case "waiting":
      return (
        <g fill={EYE_COLOR}>
          <rect x="51" y="52" width="7" height="7" rx="3.5" />
          <rect x="66" y="52" width="7" height="7" rx="3.5" />
        </g>
      );
    case "approving":
      return (
        <g>
          <g fill="none" stroke={EYE_COLOR} strokeLinecap="round" strokeWidth="5">
            <path d="M49 57 q5.5 -7 11 0" />
            <path d="M64 57 q5.5 -7 11 0" />
          </g>
          <circle cx="100" cy="28" r="13" fill="var(--success, #16A34A)" />
          <path
            d="M94 28 l4.5 4.5 8 -9"
            stroke="#FFFFFF"
            strokeWidth="3.6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    case "idle":
    default:
      return (
        <g fill={EYE_COLOR}>
          <rect x="51" y="48" width="7" height="13" rx="3.5" />
          <rect x="66" y="48" width="7" height="13" rx="3.5" />
        </g>
      );
  }
}

/**
 * Otto 的头像 + 它自己那块珊瑚底 —— 一个整体,住在 Otto 标记自己的文件里。
 *
 * 为什么不在调用页上直接写 `bg-brand-soft`:珊瑚是 Fikirtive 与 Otto 的身份色,
 * 生产页面不许直接用原色工具类(`coral-ownership.test.ts` 逐文件扫)。Home 的
 * 「Recommended next action」要的正是这块底(已批准的 `FounderHomeReference.tsx:339`),
 * 所以把这一块搬进 Otto 的标记文件里 —— 像素一个不变,珊瑚仍然只由 Otto 自己写。
 */
export function OttoAvatarChip({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      className={["flex shrink-0 items-center justify-center rounded-xl bg-brand-soft", className]
        .filter(Boolean)
        .join(" ")}
    >
      <OttoAvatar mood="helpful" size={size} />
    </span>
  );
}

export default OttoAvatar;
