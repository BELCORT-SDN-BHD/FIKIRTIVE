"use client";
import React, { useState } from "react";

export type CardVariant = "default" | "tint";
export type CardPadding = "md" | "lg";

export interface CardProps {
  variant?: CardVariant;
  padding?: CardPadding;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const variantBase: Record<CardVariant, React.CSSProperties> = {
  default: {
    backgroundColor: "var(--surface-card)",
    border: "1px solid var(--border-subtle)",
    boxShadow: "var(--shadow-md)",
  },
  tint: {
    backgroundColor: "var(--brand-tint)",
    border: "1px solid var(--border-subtle)",
    boxShadow: "none",
  },
};

const paddingMap: Record<CardPadding, string> = {
  md: "var(--pad-card)",
  lg: "var(--space-8, 2rem)",
};

export function Card({
  variant = "default",
  padding = "md",
  children,
  className,
  style,
}: CardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const computedStyle: React.CSSProperties = {
    borderRadius: "var(--radius-card)",
    padding: paddingMap[padding],
    transition: "var(--transition-control)",
    ...variantBase[variant],
    ...(isHovered
      ? {
          transform: "translateY(-2px)",
          boxShadow: "var(--shadow-lg)",
        }
      : {}),
    ...style,
  };

  return (
    <div
      className={className}
      style={computedStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
    </div>
  );
}

export default Card;
