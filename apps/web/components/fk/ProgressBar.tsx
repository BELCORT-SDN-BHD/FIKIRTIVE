import React from "react";

export type ProgressBarTone = "brand" | "teal" | "success" | "accent";

export interface ProgressBarProps {
  value: number;
  tone?: ProgressBarTone;
  showValue?: boolean;
  className?: string;
}

const FILL_COLORS: Record<ProgressBarTone, string> = {
  brand: "var(--brand)",
  teal: "var(--teal-500)",
  success: "var(--success-500)",
  accent: "var(--accent)",
};

export function ProgressBar({
  value,
  tone = "brand",
  showValue = false,
  className,
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      className={className}
      style={{ display: "flex", flexDirection: "column", gap: "4px" }}
    >
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          width: "100%",
          height: "8px",
          borderRadius: "var(--radius-chip)",
          background: "var(--neutral-200)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${clamped}%`,
            borderRadius: "inherit",
            background: FILL_COLORS[tone],
            transition: "width var(--dur-slow, 500ms) var(--ease-out)",
          }}
        />
      </div>
      {showValue && (
        <span
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
            fontWeight: "var(--weight-semibold)",
          }}
        >
          {clamped}%
        </span>
      )}
    </div>
  );
}

export default ProgressBar;
