"use client";
import React from "react";
import { Button } from "@/components/ui/button";

export function UndoBar({ summary, busy, onUndo, onDismiss }: {
  summary: string; busy: boolean; onUndo: () => void; onDismiss: () => void;
}) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-[14px] border border-brand/25 bg-brand/5 px-[15px] py-[10px] mb-4">
      <span className="text-[0.875rem] leading-[1.45] text-foreground flex-1">
        <span className="text-brand-strong font-semibold">✦ Otto</span> updated your brand memory — {summary}.
      </span>
      <Button variant="outline" size="sm" disabled={busy} onClick={onUndo}>{busy ? "Undoing…" : "Undo"}</Button>
      <button type="button" aria-label="Dismiss" className="text-muted-foreground hover:text-foreground text-[0.875rem]" onClick={onDismiss}>✕</button>
    </div>
  );
}
