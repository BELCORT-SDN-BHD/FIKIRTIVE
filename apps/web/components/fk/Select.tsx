"use client";
import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}

export function Select({
  options,
  value,
  onChange,
  label,
  hint,
  error,
  placeholder,
  disabled,
  id,
}: SelectProps) {
  const [focused, setFocused] = useState(false);

  const selectId = id ?? (label ? `select-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

  const selectStyle: React.CSSProperties = {
    width: "100%",
    height: "44px",
    paddingLeft: "var(--pad-control-x)",
    paddingRight: "36px",
    fontSize: "var(--text-base)",
    fontFamily: "var(--font-sans)",
    color: value ? "var(--text-body)" : "var(--text-faint)",
    background: "var(--surface-card)",
    border: `1.5px solid ${error ? "var(--error-500)" : focused ? "var(--brand)" : "var(--border-default)"}`,
    borderRadius: "var(--radius-control)",
    outline: "none",
    transition: "var(--transition-control)",
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    boxShadow: focused
      ? error
        ? "0 0 0 4px rgba(229, 72, 77, 0.2)"
        : "var(--ring-focus)"
      : "none",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-inline)" }}>
      {label && (
        <label
          htmlFor={selectId}
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--text-strong)",
          }}
        >
          {label}
        </label>
      )}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <select
          id={selectId}
          value={value ?? ""}
          disabled={disabled}
          style={selectStyle}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span
          style={{
            position: "absolute",
            right: "12px",
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-faint)",
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
          }}
        >
          <ChevronDown size={16} />
        </span>
      </div>
      {error && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--error-500)" }}>{error}</span>
      )}
      {!error && hint && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>{hint}</span>
      )}
    </div>
  );
}

export default Select;
