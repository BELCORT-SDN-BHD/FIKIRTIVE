"use client";
import React, { useState } from "react";

export type ButtonVariant = "primary" | "secondary" | "soft" | "ghost";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  children?: React.ReactNode;
}

const baseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "var(--radius-control)",
  fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"],
  border: "none",
  cursor: "pointer",
  transition: "var(--transition-control)",
  outline: "none",
  textDecoration: "none",
  flexShrink: 0,
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: {
    height: "38px",
    padding: "0 14px",
    fontSize: "var(--text-sm)",
    gap: "6px",
  },
  md: {
    height: "44px",
    padding: "0 20px",
    fontSize: "var(--text-base)",
    gap: "8px",
  },
};

type VariantStyles = {
  default: React.CSSProperties;
  hover: React.CSSProperties;
  active: React.CSSProperties;
  focus: React.CSSProperties;
};

const variantStyles: Record<ButtonVariant, VariantStyles> = {
  primary: {
    default: {
      backgroundColor: "var(--brand)",
      color: "var(--text-on-brand)",
      boxShadow: "none",
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

export function Button({
  variant = "primary",
  size = "md",
  leftIcon,
  rightIcon,
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
}: ButtonProps) {
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
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}

export default Button;
