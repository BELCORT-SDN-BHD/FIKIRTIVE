"use client";
import React, { useState } from "react";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Textarea({
  label,
  hint,
  error,
  disabled,
  id,
  rows = 4,
  style,
  ...props
}: TextareaProps) {
  const [focused, setFocused] = useState(false);

  const textareaId = id ?? (label ? `textarea-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

  const textareaStyle: React.CSSProperties = {
    width: "100%",
    minHeight: "100px",
    padding: "var(--pad-control-y) var(--pad-control-x)",
    fontSize: "var(--text-base)",
    fontFamily: "var(--font-sans)",
    color: "var(--text-body)",
    background: "var(--surface-card)",
    border: `1.5px solid ${error ? "var(--error-500)" : focused ? "var(--brand)" : "var(--border-default)"}`,
    borderRadius: "var(--radius-control)",
    outline: "none",
    transition: "var(--transition-control)",
    boxSizing: "border-box",
    resize: "vertical",
    boxShadow: focused
      ? error
        ? "0 0 0 4px rgba(229, 72, 77, 0.2)"
        : "var(--ring-focus)"
      : "none",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "text",
    ...style,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-inline)" }}>
      {label && (
        <label
          htmlFor={textareaId}
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--text-strong)",
          }}
        >
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        disabled={disabled}
        rows={rows}
        style={textareaStyle}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        {...props}
      />
      {error && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--error-500)" }}>{error}</span>
      )}
      {!error && hint && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>{hint}</span>
      )}
    </div>
  );
}

export default Textarea;
