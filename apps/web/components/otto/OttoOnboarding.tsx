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
    if (window.localStorage.getItem(LS_KEY)) return;
    const frame = window.requestAnimationFrame(() => {
      setVisible(true);
    });
    return () => window.cancelAnimationFrame(frame);
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
      hint: "Otto keeps them consistent across every project",
      onClick: onGoToStuff,
    },
    {
      icon: <Sparkles size={20} />,
      label: "Teach Otto your brand",
      hint: "Voice, rules, audience — Otto uses it every time",
      onClick: onGoToMemory,
    },
  ];

  // leading-[1.5] — design-baseline body line-height (Analytics standard)
  return (
    <div
      role="region"
      aria-label="Getting started"
      className="gb leading-[1.5] rounded-[28px] overflow-hidden bg-card shadow-sm"
      style={{ border: "1.5px solid var(--border)" }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
        <div>
          <div className="font-bold text-[1rem] text-foreground leading-[1.2]">
            Get Otto ready
          </div>
          <div className="text-[0.75rem] text-muted-foreground mt-[2px]">
            Two quick things before your first project
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss getting started"
          className="inline-flex items-center justify-center w-7 h-7 rounded-[14px] border-0 bg-transparent text-muted-foreground/70 cursor-pointer shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tiles row */}
      <div
        className="grid grid-cols-1 gap-px sm:grid-cols-2"
        style={{ background: "var(--border)" }}
      >
        {tiles.map((tile) => (
          <button
            key={tile.label}
            type="button"
            onClick={tile.onClick}
            className="flex items-start gap-3 px-5 py-4 bg-card border-0 cursor-pointer text-left transition-colors duration-150 hover:bg-accent"
          >
            <div className="shrink-0 mt-[2px] text-foreground">
              {tile.icon}
            </div>
            <div>
              <div className="font-semibold text-[0.875rem] text-foreground mb-[2px]">
                {tile.label}
              </div>
              <div className="text-[0.75rem] text-muted-foreground">
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
