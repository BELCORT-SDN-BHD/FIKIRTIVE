"use client";
import React from "react";

export type OttoState = "idle" | "thinking";

export interface OttoAvatarProps {
  size?: number;
  state?: OttoState;
  className?: string;
}

const KEYFRAMES_ID = "otto-avatar-keyframes";

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
 * design-system ui_kits; never a boxed robot. `thinking` adds a coral glow + bob.
 */
export function OttoAvatar({ size = 48, state = "idle", className }: OttoAvatarProps) {
  React.useEffect(() => {
    ensureKeyframes();
  }, []);

  const isThinking = state === "thinking";

  const svgStyle: React.CSSProperties = {
    display: "block",
    filter: isThinking
      ? "drop-shadow(0 3px 10px color-mix(in oklab, var(--brand) 45%, transparent))"
      : "none",
    animation: isThinking ? "otto-avatar-bob 1.4s ease-in-out infinite alternate" : "none",
    transition: "filter 0.2s ease",
  };

  return (
    <span className={className} style={{ display: "inline-flex", flexShrink: 0 }}>
      <svg
        width={size}
        height={Math.round((size * 110) / 120)}
        viewBox="0 0 120 110"
        role="img"
        aria-label="Otto"
        style={svgStyle}
      >
        <g fill="var(--brand)">
          <ellipse cx="60" cy="64" rx="43" ry="22" />
          <circle cx="37" cy="52" r="18" />
          <circle cx="61" cy="40" r="24" />
          <circle cx="85" cy="53" r="17" />
        </g>
        <rect x="51" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
        <rect x="66" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
      </svg>
    </span>
  );
}

export default OttoAvatar;
