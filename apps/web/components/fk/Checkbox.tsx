"use client";
import React, { useState } from "react";
import { Check } from "lucide-react";

export interface CheckboxProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}

export function Checkbox({
  checked = false,
  onChange,
  label,
  disabled,
  id,
}: CheckboxProps) {
  const [focused, setFocused] = useState(false);

  const checkboxId = id ?? (label ? `checkbox-${label.toLowerCase().replace(/\s+/g, "-")}` : "checkbox");

  return (
    <label
      htmlFor={checkboxId}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--gap-control)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        userSelect: "none",
      }}
    >
      {/* Visually hidden native input for accessibility */}
      <input
        type="checkbox"
        id={checkboxId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
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
      {/* Custom visual box */}
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: "18px",
          height: "18px",
          border: `2px solid ${checked ? "var(--brand)" : "var(--border-default)"}`,
          borderRadius: "var(--radius-xs)",
          background: checked ? "var(--brand)" : "var(--surface-card)",
          transition: "var(--transition-control)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: focused ? "var(--ring-focus)" : "none",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {checked && <Check size={12} color="white" strokeWidth={3} />}
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

export default Checkbox;
