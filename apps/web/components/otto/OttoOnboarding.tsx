"use client";
import React from "react";
import { X, Users, Sparkles, Check } from "lucide-react";

interface OnboardingTile {
  icon: React.ReactNode;
  label: string;
  hint: string;
  done: boolean;
  onClick?: () => void;
}

interface OttoOnboardingProps {
  /** Has the shop saved at least one character or product? Ticks the first tile. */
  hasStuff: boolean;
  /** Has the shop taught Otto anything about its brand? Ticks the second tile. */
  hasBrandMemory: boolean;
  onGoToStuff: () => void;
  onGoToMemory: () => void;
  /** Persist the dismissal against the merchant's workspace (#679). */
  onDismiss: () => void;
}

/**
 * #679 — the card no longer decides for itself whether it should exist.
 *
 * It used to read and write `localStorage["otto:onboarded"]`, which made it a fact about one
 * browser rather than about the shop, and it never looked at whether the two things had
 * actually been done. Visibility is now the caller's call (see lib/otto-onboarding.ts), the
 * dismissal is persisted server-side against the workspace, and each row says truthfully
 * whether that task is done.
 */
export function OttoOnboarding({
  hasStuff,
  hasBrandMemory,
  onGoToStuff,
  onGoToMemory,
  onDismiss,
}: OttoOnboardingProps) {
  const tiles: OnboardingTile[] = [
    {
      icon: <Users size={20} />,
      label: "Add a character or product",
      hint: "Otto keeps them consistent across every project",
      done: hasStuff,
      onClick: onGoToStuff,
    },
    {
      icon: <Sparkles size={20} />,
      label: "Teach Otto your brand",
      hint: "Voice, rules, audience — Otto uses it every time",
      done: hasBrandMemory,
      onClick: onGoToMemory,
    },
  ];
  const remaining = tiles.filter((t) => !t.done).length;

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
            {remaining === 1
              ? "One quick thing before your first project"
              : "Two quick things before your first project"}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
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
            aria-label={tile.done ? `${tile.label} — done` : tile.label}
            className="flex items-start gap-3 px-5 py-4 bg-card border-0 cursor-pointer text-left transition-colors duration-150 hover:bg-accent"
          >
            <div className={`shrink-0 mt-[2px] ${tile.done ? "text-muted-foreground" : "text-foreground"}`}>
              {tile.done ? <Check size={20} aria-hidden /> : tile.icon}
            </div>
            <div>
              <div
                className={`font-semibold text-[0.875rem] mb-[2px] ${
                  tile.done ? "text-muted-foreground line-through" : "text-foreground"
                }`}
              >
                {tile.label}
              </div>
              <div className="text-[0.75rem] text-muted-foreground">
                {tile.done ? "Done" : tile.hint}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default OttoOnboarding;
