"use client";
import React, { useState } from "react";

export interface TooltipProps {
  content: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

function getBubblePosition(side: NonNullable<TooltipProps["side"]>): React.CSSProperties {
  switch (side) {
    case "bottom":
      return { top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" };
    case "left":
      return { right: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" };
    case "right":
      return { left: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" };
    case "top":
    default:
      return { bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" };
  }
}

export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      style={{ display: "inline-block", position: "relative" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      <span
        role="tooltip"
        aria-hidden={!visible}
        style={{
          position: "absolute",
          whiteSpace: "nowrap",
          background: "var(--neutral-900)",
          color: "var(--neutral-0, #fff)",
          fontSize: "var(--text-xs)",
          padding: "4px 10px",
          borderRadius: "var(--radius-sm)",
          pointerEvents: "none",
          zIndex: 100,
          opacity: visible ? 1 : 0,
          transition: "opacity var(--dur-fast) var(--ease-out)",
          ...getBubblePosition(side),
        }}
      >
        {content}
      </span>
    </span>
  );
}

export default Tooltip;
