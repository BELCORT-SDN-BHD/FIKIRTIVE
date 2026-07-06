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
  helpful: { label: "Otto helping", tilt: 2 },
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
    glow: "drop-shadow(0 3px 9px color-mix(in oklab, var(--error, #E5484D) 24%, transparent))",
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
 * design-system ui_kits; never a boxed robot. Reactions are no-mouth by design:
 * only eyes, pose, and subtle glow may change. `thinking` adds coral glow + bob.
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
        <g fill={EYE_COLOR}>
          <ellipse cx="55" cy="49" rx="3.8" ry="4.8" />
          <ellipse cx="70" cy="49" rx="3.8" ry="4.8" />
          <circle cx="56.3" cy="47.3" r="1" fill="#FFFFFF" opacity="0.55" />
          <circle cx="71.3" cy="47.3" r="1" fill="#FFFFFF" opacity="0.55" />
        </g>
      );
    case "helpful":
      return (
        <g fill={EYE_COLOR}>
          <rect x="48" y="49" width="8" height="12" rx="4" />
          <rect x="64" y="49" width="8" height="12" rx="4" />
          <circle cx="53.5" cy="51" r="1.1" fill="#FFFFFF" opacity="0.55" />
          <circle cx="69.5" cy="51" r="1.1" fill="#FFFFFF" opacity="0.55" />
        </g>
      );
    case "success":
      return (
        <g fill="none" stroke={EYE_COLOR} strokeLinecap="round" strokeWidth="3.6">
          <path d="M49 57 q5.5 -8 11 0" />
          <path d="M64 57 q5.5 -8 11 0" />
        </g>
      );
    case "warning":
      return (
        <g>
          <path d="M48 46 l12 2" fill="none" stroke={EYE_COLOR} strokeLinecap="round" strokeWidth="3" />
          <path d="M77 46 l-12 2" fill="none" stroke={EYE_COLOR} strokeLinecap="round" strokeWidth="3" />
          <ellipse cx="55" cy="55" rx="3.7" ry="5.2" fill={EYE_COLOR} />
          <ellipse cx="70" cy="55" rx="3.7" ry="5.2" fill={EYE_COLOR} />
        </g>
      );
    case "error":
      return (
        <g fill="none" stroke={EYE_COLOR} strokeLinecap="round" strokeWidth="3.4">
          <path d="M50 49 l9 9" />
          <path d="M59 49 l-9 9" />
          <path d="M66 49 l9 9" />
          <path d="M75 49 l-9 9" />
        </g>
      );
    case "waiting":
      return (
        <g fill={EYE_COLOR}>
          <rect x="50" y="53" width="10" height="4" rx="2" />
          <rect x="65" y="53" width="10" height="4" rx="2" />
        </g>
      );
    case "approving":
      return (
        <g fill={EYE_COLOR}>
          <rect x="50" y="50" width="8" height="11" rx="4" />
          <rect x="67" y="50" width="8" height="11" rx="4" />
          <path d="M48 47 h11" stroke={EYE_COLOR} strokeLinecap="round" strokeWidth="2.8" />
          <path d="M66 47 h11" stroke={EYE_COLOR} strokeLinecap="round" strokeWidth="2.8" />
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

export default OttoAvatar;
