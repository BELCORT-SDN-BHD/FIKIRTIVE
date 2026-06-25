"use client";
import React, { useState } from "react";

export interface TabItem {
  value: string;
  label: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Tabs({ items, value, onChange, className }: TabsProps) {
  const [hoveredValue, setHoveredValue] = useState<string | null>(null);

  const containerStyle: React.CSSProperties = {
    display: "flex",
    gap: "4px",
    backgroundColor: "var(--surface-sunken)",
    borderRadius: "var(--radius-control)",
    padding: "4px",
  };

  function getTabStyle(item: TabItem): React.CSSProperties {
    const isActive = item.value === value;
    const isHovered = hoveredValue === item.value;

    const base: React.CSSProperties = {
      borderRadius: "var(--radius-sm)",
      padding: "6px 14px",
      fontSize: "var(--text-sm)",
      fontWeight: isActive
        ? ("var(--weight-semibold)" as React.CSSProperties["fontWeight"])
        : ("var(--weight-medium)" as React.CSSProperties["fontWeight"]),
      transition: "var(--transition-control)",
      border: "none",
      cursor: "pointer",
      color: isActive ? "var(--text-strong)" : "var(--text-muted)",
      backgroundColor: "transparent",
      boxShadow: "none",
    };

    if (isActive) {
      return {
        ...base,
        backgroundColor: "var(--surface-card)",
        color: "var(--text-strong)",
        boxShadow: "var(--shadow-xs)",
      };
    }

    if (isHovered) {
      return {
        ...base,
        backgroundColor: "var(--neutral-50)",
        color: "var(--text-body)",
      };
    }

    return base;
  }

  return (
    <div className={className} style={containerStyle} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={item.value === value}
          style={getTabStyle(item)}
          onClick={() => onChange(item.value)}
          onMouseEnter={() => setHoveredValue(item.value)}
          onMouseLeave={() => setHoveredValue(null)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default Tabs;
