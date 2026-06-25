"use client";
import React from "react";

export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}

export function Switch({
  checked = false,
  onChange,
  label,
  disabled,
  id,
}: SwitchProps) {
  const switchId = id ?? (label ? `switch-${label.toLowerCase().replace(/\s+/g, "-")}` : "switch");

  return (
    <label
      htmlFor={switchId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--gap-control)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        userSelect: "none",
      }}
    >
      {/* Visually hidden native checkbox for accessibility */}
      <input
        type="checkbox"
        id={switchId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      />
      {/* Track */}
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          position: "relative",
          width: "44px",
          height: "24px",
          borderRadius: "var(--radius-chip)",
          background: checked ? "var(--brand)" : "var(--neutral-300)",
          transition: `background-color var(--dur-base) var(--ease-spring)`,
          cursor: disabled ? "not-allowed" : "pointer",
          display: "inline-block",
        }}
      >
        {/* Thumb */}
        <span
          style={{
            position: "absolute",
            top: "3px",
            left: checked ? "23px" : "3px",
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: "white",
            boxShadow: "var(--shadow-sm)",
            transition: `left var(--dur-base) var(--ease-spring)`,
          }}
        />
      </span>
      {label && (
        <span
          style={{
            fontSize: "var(--text-base)",
            color: "var(--text-body)",
          }}
        >
          {label}
        </span>
      )}
    </label>
  );
}

export default Switch;
