"use client";
import React, { useState } from "react";

export type IconButtonVariant = "primary" | "secondary" | "soft" | "ghost";
export type IconButtonSize = "sm" | "md";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  label: string;
  children: React.ReactNode;
}

const baseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "var(--radius-control)",
  border: "none",
  cursor: "pointer",
  transition: "var(--transition-control)",
  outline: "none",
  flexShrink: 0,
  padding: 0,
};

const sizeStyles: Record<IconButtonSize, React.CSSProperties> = {
  sm: { width: "34px", height: "34px" },
  md: { width: "42px", height: "42px" },
};

type VariantStyles = {
  default: React.CSSProperties;
  hover: React.CSSProperties;
  active: React.CSSProperties;
  focus: React.CSSProperties;
};

const variantStyles: Record<IconButtonVariant, VariantStyles> = {
  primary: {
    default: {
      backgroundColor: "var(--brand)",
      color: "var(--text-on-brand)",
    },
    hover: {
      backgroundColor: "var(--brand-hover)",
      boxShadow: "var(--shadow-brand-sm)",
      transform: "translateY(-1px)",
    },
    active: {
      backgroundColor: "var(--brand-press)",
      boxShadow: "none",
      transform: "scale(0.97)",
    },
    focus: {
      boxShadow: "var(--ring-focus)",
    },
  },
  secondary: {
    default: {
      backgroundColor: "var(--surface-card)",
      color: "var(--text-body)",
      border: "1.5px solid var(--border-default)",
    },
    hover: {
      backgroundColor: "var(--neutral-50)",
      border: "1.5px solid var(--border-strong)",
    },
    active: {
      transform: "scale(0.97)",
    },
    focus: {
      boxShadow: "var(--ring-focus)",
    },
  },
  soft: {
    default: {
      backgroundColor: "var(--brand-soft)",
      color: "var(--on-brand-soft)",
    },
    hover: {
      backgroundColor: "var(--brand-soft-hover)",
    },
    active: {
      transform: "scale(0.97)",
    },
    focus: {
      boxShadow: "var(--ring-focus)",
    },
  },
  ghost: {
    default: {
      backgroundColor: "transparent",
      color: "var(--text-body)",
    },
    hover: {
      backgroundColor: "var(--surface-sunken)",
    },
    active: {
      transform: "scale(0.97)",
    },
    focus: {
      boxShadow: "var(--ring-focus)",
    },
  },
};

export function IconButton({
  variant = "primary",
  size = "md",
  label,
  children,
  disabled,
  style,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  onMouseDown,
  onMouseUp,
  ...props
}: IconButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const vStyles = variantStyles[variant];

  const computedStyle: React.CSSProperties = {
    ...baseStyle,
    ...sizeStyles[size],
    ...vStyles.default,
    ...(isHovered && !disabled ? vStyles.hover : {}),
    ...(isFocused && !disabled ? vStyles.focus : {}),
    ...(isActive && !disabled ? vStyles.active : {}),
    ...(disabled
      ? { opacity: 0.45, cursor: "not-allowed", boxShadow: "none", transform: "none" }
      : {}),
    ...style,
  };

  return (
    <button
      {...props}
      aria-label={label}
      disabled={disabled}
      style={computedStyle}
      onMouseEnter={(e) => {
        setIsHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setIsHovered(false);
        setIsActive(false);
        onMouseLeave?.(e);
      }}
      onFocus={(e) => {
        setIsFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setIsFocused(false);
        onBlur?.(e);
      }}
      onMouseDown={(e) => {
        setIsActive(true);
        onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        setIsActive(false);
        onMouseUp?.(e);
      }}
    >
      {children}
    </button>
  );
}

export default IconButton;
