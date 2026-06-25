import React from "react";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  src?: string;
  name?: string;
  size?: AvatarSize;
  className?: string;
}

const sizeMap: Record<AvatarSize, number> = {
  sm: 32,
  md: 40,
  lg: 56,
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function UserIcon({ size }: { size: number }) {
  const s = size * 0.45;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

export function Avatar({ src, name, size = "md", className }: AvatarProps) {
  const px = sizeMap[size];

  const baseStyle: React.CSSProperties = {
    width: px,
    height: px,
    borderRadius: "var(--radius-circle)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
    userSelect: "none",
  };

  if (src) {
    return (
      <span className={className} style={baseStyle}>
        <img
          src={src}
          alt={name ?? "avatar"}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </span>
    );
  }

  if (name) {
    const fontSize = px <= 32 ? "var(--text-xs)" : px <= 40 ? "var(--text-sm)" : "var(--text-base)";
    return (
      <span
        className={className}
        style={{
          ...baseStyle,
          backgroundColor: "var(--brand-soft)",
          color: "var(--on-brand-soft)",
          fontSize,
          fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"],
        }}
        aria-label={name}
      >
        {getInitials(name)}
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{
        ...baseStyle,
        backgroundColor: "var(--surface-sunken)",
        color: "var(--text-faint)",
      }}
      aria-label="user avatar"
    >
      <UserIcon size={px} />
    </span>
  );
}

export default Avatar;
