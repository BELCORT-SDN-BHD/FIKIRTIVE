"use client";
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { MemoryRow } from "@/lib/memory-actions";

export function FactSection({ label, rows, freshIds, onSave, onDelete, onAdd }: {
  label: string;
  rows: MemoryRow[];
  freshIds: Set<string>;
  onSave: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAdd: (content: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <section>
      {label && <h2 className="text-[0.75rem] font-semibold tracking-[0.05em] uppercase text-muted-foreground mt-6 mb-2">{label}</h2>}
      <div className="rounded-[16px] border border-border bg-card divide-y divide-border">
        {rows.map((r) => (
          <div key={r.id} className={`px-[15px] py-[10px] ${freshIds.has(r.id) ? "bg-brand/5 border-l-[3px] border-l-brand" : ""}`}>
            {editingId === r.id ? (
              <div className="flex flex-col gap-2">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void onSave(r.id, text).then(() => setEditingId(null))}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <span className="text-[0.875rem] leading-[1.45] text-foreground flex-1">{r.content}</span>
                <span className={`text-[0.6875rem] rounded-full px-2 py-[2px] font-medium whitespace-nowrap ${r.source === "otto" ? "text-brand bg-brand/10" : "text-muted-foreground bg-accent"}`}>
                  {r.source === "otto" ? "✦ OTTO learned" : "You added"}
                </span>
                <button type="button" aria-label="Edit" className="text-muted-foreground hover:text-foreground" onClick={() => { setEditingId(r.id); setText(r.content); }}>✎</button>
                <button type="button" aria-label="Delete" className="text-muted-foreground hover:text-foreground" onClick={() => void onDelete(r.id)}>🗑</button>
              </div>
            )}
          </div>
        ))}
        <div className="px-[15px] py-[10px]">
          {adding ? (
            <div className="flex flex-col gap-2">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="Add a fact about your brand…" />
              <div className="flex gap-2">
                <Button size="sm" disabled={!draft.trim()} onClick={() => void onAdd(draft.trim()).then(() => { setDraft(""); setAdding(false); })}>Add</Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <button type="button" className="text-[0.8125rem] text-muted-foreground hover:text-foreground" onClick={() => setAdding(true)}>+ Add a fact</button>
          )}
        </div>
      </div>
    </section>
  );
}
