import React from "react";

export type BadgeVariant = "default" | "brand" | "success" | "warning" | "error" | "info" | "accent";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  default: {
    backgroundColor: "var(--neutral-200)",
    color: "var(--text-muted)",
  },
  brand: {
    backgroundColor: "var(--brand-soft)",
    color: "var(--on-brand-soft)",
  },
  success: {
    backgroundColor: "var(--success-100)",
    color: "var(--success-700)",
  },
  warning: {
    backgroundColor: "var(--warning-100)",
    color: "var(--warning-700)",
  },
  error: {
    backgroundColor: "var(--error-100)",
    color: "var(--error-700)",
  },
  info: {
    backgroundColor: "var(--info-100)",
    color: "var(--info-700)",
  },
  accent: {
    backgroundColor: "var(--accent-soft)",
    color: "var(--coral-700)",
  },
};

const baseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 10px",
  fontSize: "var(--text-xs)",
  fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"],
  borderRadius: "var(--radius-chip)",
  lineHeight: 1.5,
};

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span
      className={className}
      style={{ ...baseStyle, ...variantStyles[variant] }}
    >
      {children}
    </span>
  );
}

export default Badge;
