"use client";
import React from "react";
import type { ChatThreadDTO } from "@/lib/types";
import { convoColor, convoTabModel } from "@/lib/convo-canvas";

interface ConvoTabsProps {
  threads: ChatThreadDTO[];
  activeThreadId: string | null;
  activity: Set<string>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ConvoTabs({ threads, activeThreadId, activity, onSelect, onNew, onDelete }: ConvoTabsProps) {
  const tabs = convoTabModel(
    threads.map((t) => ({ id: t.id, title: t.title || "Untitled" })),
    activeThreadId,
    activity,
  );
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: "0.5rem",
        padding: "0.5rem 0.75rem", overflowX: "auto", flexShrink: 0,
        borderBottom: "1px solid var(--border)", background: "var(--card)",
      }}
    >
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.active}
          onClick={() => onSelect(t.id)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
            padding: "4px 10px", borderRadius: "14px", whiteSpace: "nowrap",
            border: "1px solid " + (t.active ? "var(--border)" : "transparent"),
            background: t.active ? "var(--card)" : "transparent",
            color: "var(--foreground)", fontSize: 13, maxWidth: 180,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: convoColor(t.id) }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
          {t.working && (
            <span
              aria-label="working"
              style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: "var(--accent)" }}
            />
          )}
          <button
            type="button"
            aria-label="Delete conversation"
            onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
            style={{ border: "none", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", padding: 0, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={onNew}
        style={{
          marginLeft: "auto", flexShrink: 0, border: "1px solid var(--border)",
          background: "transparent", color: "var(--foreground)", cursor: "pointer",
          padding: "4px 10px", borderRadius: "14px", fontSize: 13,
        }}
      >
        + New convo
      </button>
    </div>
  );
}

export default ConvoTabs;
