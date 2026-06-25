"use client";
import React, { useState } from "react";
import { X, CheckCircle, AlertTriangle, Info, XCircle } from "lucide-react";

export type ToastVariant = "default" | "success" | "warning" | "error" | "info";

export interface ToastProps {
  variant?: ToastVariant;
  title: string;
  description?: string;
  onClose?: () => void;
}

const ICONS: Partial<Record<ToastVariant, React.ReactNode>> = {
  success: <CheckCircle size={16} color="var(--success-500)" />,
  warning: <AlertTriangle size={16} color="var(--warning-500, #f59e0b)" />,
  error: <XCircle size={16} color="var(--error-500)" />,
  info: <Info size={16} color="var(--info-500, var(--teal-500))" />,
};

export function Toast({
  variant = "default",
  title,
  description,
  onClose,
}: ToastProps) {
  const [closeHovered, setCloseHovered] = useState(false);

  const icon = ICONS[variant];

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        display: "flex",
        gap: "var(--gap-control)",
        alignItems: "flex-start",
        padding: "var(--space-4) var(--space-5)",
        background: "var(--surface-card)",
        borderRadius: "var(--radius-lg, var(--radius-md))",
        boxShadow: "var(--shadow-lg)",
        border: "1px solid var(--border-subtle)",
        minWidth: "280px",
        maxWidth: "400px",
      }}
    >
      {icon && (
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", paddingTop: "1px" }}>
          {icon}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--text-strong)",
          }}
        >
          {title}
        </p>
        {description && (
          <p
            style={{
              margin: "2px 0 0",
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
            }}
          >
            {description}
          </p>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          onMouseEnter={() => setCloseHovered(true)}
          onMouseLeave={() => setCloseHovered(false)}
          aria-label="Close"
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginLeft: "auto",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: closeHovered ? "var(--text-body)" : "var(--text-faint)",
            padding: "2px",
            borderRadius: "var(--radius-xs)",
            transition: "color var(--dur-fast) var(--ease-out)",
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export default Toast;
