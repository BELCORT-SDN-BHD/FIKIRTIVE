"use client";
import React, { useState, useEffect } from "react";
import { X, Users, Sparkles } from "lucide-react";

const LS_KEY = "otto:onboarded";

interface OnboardingTile {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick?: () => void;
}

interface OttoOnboardingProps {
  onGoToStuff: () => void;
  onGoToMemory: () => void;
}

export function OttoOnboarding({ onGoToStuff, onGoToMemory }: OttoOnboardingProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Window-guarded localStorage read
    if (typeof window === "undefined") return;
    if (!window.localStorage.getItem(LS_KEY)) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LS_KEY, "1");
    }
    setVisible(false);
  }

  if (!visible) return null;

  const tiles: OnboardingTile[] = [
    {
      icon: <Users size={20} />,
      label: "Add a character or product",
      hint: "Otto keeps them consistent across every campaign",
      onClick: onGoToStuff,
    },
    {
      icon: <Sparkles size={20} />,
      label: "Teach Otto your brand",
      hint: "Voice, rules, audience — Otto uses it every time",
      onClick: onGoToMemory,
    },
  ];

  return (
    <div
      role="region"
      aria-label="Getting started"
      style={{
        margin: "var(--space-5) var(--space-6) 0",
        borderRadius: "var(--radius-xl)",
        border: "1.5px solid var(--border-subtle)",
        background: "var(--surface-card)",
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-4) var(--space-5) var(--space-3)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"],
              fontSize: "var(--text-base)",
              color: "var(--text-strong)",
              lineHeight: "var(--leading-snug)",
            }}
          >
            Get Otto ready
          </div>
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
              marginTop: 2,
            }}
          >
            Two quick things before your first campaign
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss getting started"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: "var(--radius-md)",
            border: "none",
            background: "transparent",
            color: "var(--text-faint)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Tiles row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 1,
          background: "var(--border-subtle)",
        }}
      >
        {tiles.map((tile) => (
          <button
            key={tile.label}
            type="button"
            onClick={tile.onClick}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--space-3)",
              padding: "var(--space-4) var(--space-5)",
              background: "var(--surface-card)",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              transition: "var(--transition-control)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-card)";
            }}
          >
            <div
              style={{
                flexShrink: 0,
                marginTop: 2,
                color: "var(--brand)",
              }}
            >
              {tile.icon}
            </div>
            <div>
              <div
                style={{
                  fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"],
                  fontSize: "var(--text-sm)",
                  color: "var(--text-strong)",
                  marginBottom: 2,
                }}
              >
                {tile.label}
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                {tile.hint}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default OttoOnboarding;
