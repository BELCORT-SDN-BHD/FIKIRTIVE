"use client";
import React, { useState } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: React.ReactNode;
}

export function Input({
  label,
  hint,
  error,
  leftIcon,
  disabled,
  id,
  style,
  ...props
}: InputProps) {
  const [focused, setFocused] = useState(false);

  const inputId = id ?? (label ? `input-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: "44px",
    paddingLeft: leftIcon ? "40px" : "var(--pad-control-x)",
    paddingRight: "var(--pad-control-x)",
    fontSize: "var(--text-base)",
    fontFamily: "var(--font-sans)",
    color: "var(--text-body)",
    background: "var(--surface-card)",
    border: `1.5px solid ${error ? "var(--error-500)" : focused ? "var(--brand)" : "var(--border-default)"}`,
    borderRadius: "var(--radius-control)",
    outline: "none",
    transition: "var(--transition-control)",
    boxSizing: "border-box",
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
          htmlFor={inputId}
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
        {leftIcon && (
          <span
            style={{
              position: "absolute",
              left: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-faint)",
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
            }}
          >
            {leftIcon}
          </span>
        )}
        <input
          id={inputId}
          disabled={disabled}
          style={inputStyle}
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

export default Input;
