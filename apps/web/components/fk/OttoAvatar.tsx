"use client";
import React from "react";

export type OttoState = "idle" | "thinking";

export interface OttoAvatarProps {
  size?: number;
  state?: OttoState;
  className?: string;
}

const KEYFRAMES_ID = "fk-otto-keyframes";

function ensureKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent = `
    @keyframes fk-otto-bob {
      from { transform: translateY(0px); }
      to   { transform: translateY(-4px); }
    }
  `;
  document.head.appendChild(style);
}

export function OttoAvatar({ size = 48, state = "idle", className }: OttoAvatarProps) {
  React.useEffect(() => {
    ensureKeyframes();
  }, []);

  const isThinking = state === "thinking";

  const wrapperStyle: React.CSSProperties = {
    position: "relative",
    display: "inline-block",
    width: size,
    height: size,
  };

  const imgStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "var(--radius-pill)",
    display: "block",
    objectFit: "cover",
    boxShadow: isThinking ? "var(--shadow-accent)" : "none",
    animation: isThinking ? "fk-otto-bob 1.4s ease-in-out infinite alternate" : "none",
    transition: "box-shadow var(--transition-control)",
  };

  return (
    <div className={className} style={wrapperStyle}>
      <img src="/brand/otto.svg" alt="Otto" style={imgStyle} />
    </div>
  );
}

export default OttoAvatar;
