"use client";
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import type { MemoryRow } from "@/lib/memory-actions";

type SegFields = { name: string; who: string; pains: string; wants: string; channels: string; toneTips: string };

const EMPTY: SegFields = { name: "", who: "", pains: "", wants: "", channels: "", toneTips: "" };

function fieldsOf(data: Record<string, unknown>): SegFields {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    name: s(data.name), who: s(data.who), pains: s(data.pains),
    wants: s(data.wants), channels: s(data.channels), toneTips: s(data.toneTips),
  };
}

function SegForm({ initial, onCancel, onSubmit }: {
  initial: SegFields;
  onCancel: () => void;
  onSubmit: (data: SegFields) => Promise<void>;
}) {
  const [f, setF] = useState<SegFields>(initial);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof SegFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));
  const valid = f.name.trim() && f.who.trim();
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Name *</span>
        <Input value={f.name} onChange={set("name")} placeholder="Young working moms" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Who they are *</span>
        <Textarea value={f.who} onChange={set("who")} rows={2} placeholder="25–38, urban, time-poor" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Pains</span>
        <Textarea value={f.pains} onChange={set("pains")} rows={1} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Wants</span>
        <Textarea value={f.wants} onChange={set("wants")} rows={1} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Where to reach them</span>
        <Input value={f.channels} onChange={set("channels")} placeholder="IG Reels, TikTok" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Tone tips</span>
        <Textarea value={f.toneTips} onChange={set("toneTips")} rows={1} />
      </label>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!valid || saving}
          onClick={() => {
            setSaving(true);
            void onSubmit(f).finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function SegmentCards({ records, looseNotes, freshIds, onSave, onDelete, onArchive, onNoteSave, onNoteDelete }: {
  records: BrandRecordRow[];
  looseNotes: MemoryRow[];
  freshIds: Set<string>;
  onSave: (id: string | undefined, data: SegFields) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onArchive: (id: string, data: Record<string, unknown>, status: "active" | "archived") => Promise<void>;
  onNoteSave: (id: string, content: string) => Promise<void>;
  onNoteDelete: (id: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [noteEditId, setNoteEditId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const activeCount = records.filter((r) => r.status === "active").length;

  // Active cards first, archived after (dimmed) — same treatment as ProductShowcase.
  const ordered = [...records].sort((a, b) => {
    const av = a.status === "archived" ? 1 : 0;
    const bv = b.status === "archived" ? 1 : 0;
    return av - bv;
  });

  return (
    <section>
      <h2 className="text-[0.75rem] font-semibold tracking-[0.05em] uppercase text-muted-foreground mt-6 mb-2">Your customers</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ordered.map((r) => {
          const d = fieldsOf(r.data);
          const archived = r.status === "archived";
          const fresh = freshIds.has(r.id);
          return (
            <div
              key={r.id}
              className={`rounded-[16px] border border-border bg-card px-[15px] py-[10px] ${archived ? "opacity-60" : ""} ${fresh ? "bg-brand/5 border-l-[3px] border-l-brand" : ""}`}
            >
              {editingId === r.id ? (
                <SegForm
                  initial={d}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(data) => onSave(r.id, data).then(() => setEditingId(null))}
                />
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="text-[0.875rem] leading-[1.45] font-semibold text-foreground flex-1">{d.name}</span>
                    {archived && (
                      <span className="text-[0.6875rem] rounded-full px-2 py-[2px] font-medium whitespace-nowrap text-muted-foreground bg-accent">Archived</span>
                    )}
                    <span className={`text-[0.6875rem] rounded-full px-2 py-[2px] font-medium whitespace-nowrap ${r.source === "otto" ? "text-brand-strong bg-brand/10" : "text-muted-foreground bg-accent"}`}>
                      {r.source === "otto" ? "✦ Otto learned" : "You added"}
                    </span>
                    <button type="button" aria-label="Edit" className="text-muted-foreground hover:text-foreground" onClick={() => setEditingId(r.id)}>✎</button>
                    <button
                      type="button"
                      className="text-[0.75rem] text-muted-foreground hover:text-foreground whitespace-nowrap"
                      onClick={() => void onArchive(r.id, r.data, archived ? "active" : "archived")}
                    >
                      {archived ? "Unarchive" : "Archive"}
                    </button>
                    <button type="button" aria-label="Delete" className="text-muted-foreground hover:text-foreground" onClick={() => void onDelete(r.id)}>🗑</button>
                  </div>
                  <span className="text-[0.875rem] leading-[1.45] text-muted-foreground">{d.who}</span>
                  {d.pains && <span className="text-[0.8125rem] leading-[1.45] text-muted-foreground">Pains: {d.pains}</span>}
                  {d.channels && <span className="text-[0.8125rem] leading-[1.45] text-muted-foreground">Reach: {d.channels}</span>}
                  {d.toneTips && <span className="text-[0.8125rem] leading-[1.45] text-muted-foreground">Tone: {d.toneTips}</span>}
                </div>
              )}
            </div>
          );
        })}

        {/* Legacy loose audience notes render as plain fact cards. */}
        {looseNotes.map((n) => (
          <div
            key={n.id}
            className={`rounded-[16px] border border-border bg-card px-[15px] py-[10px] ${freshIds.has(n.id) ? "bg-brand/5 border-l-[3px] border-l-brand" : ""}`}
          >
            {noteEditId === n.id ? (
              <div className="flex flex-col gap-2">
                <Textarea aria-label="Edit this audience note" value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void onNoteSave(n.id, noteText).then(() => setNoteEditId(null))}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setNoteEditId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <span className="text-[0.875rem] leading-[1.45] text-foreground flex-1">{n.content}</span>
                <span className={`text-[0.6875rem] rounded-full px-2 py-[2px] font-medium whitespace-nowrap ${n.source === "otto" ? "text-brand-strong bg-brand/10" : "text-muted-foreground bg-accent"}`}>
                  {n.source === "otto" ? "✦ Otto learned" : "You added"}
                </span>
                <button type="button" aria-label="Edit" className="text-muted-foreground hover:text-foreground" onClick={() => { setNoteEditId(n.id); setNoteText(n.content); }}>✎</button>
                <button type="button" aria-label="Delete" className="text-muted-foreground hover:text-foreground" onClick={() => void onNoteDelete(n.id)}>🗑</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {adding && (
        <div className="rounded-[16px] border border-border bg-card px-[15px] py-[10px] mt-3">
          <SegForm
            initial={EMPTY}
            onCancel={() => setAdding(false)}
            onSubmit={(data) => onSave(undefined, data).then(() => setAdding(false))}
          />
        </div>
      )}

      {!adding && (
        <div className="mt-3">
          {activeCount >= 6 && (
            <p className="text-[0.75rem] text-muted-foreground mb-1.5">Tip: keep groups few — archive one before adding more.</p>
          )}
          <button type="button" className="text-[0.8125rem] text-muted-foreground hover:text-foreground" onClick={() => setAdding(true)}>+ Add a customer group</button>
        </div>
      )}
    </section>
  );
}
