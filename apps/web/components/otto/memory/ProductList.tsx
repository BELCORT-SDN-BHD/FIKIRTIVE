"use client";
import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import type { MemoryRow } from "@/lib/memory-actions";

/** Short "Mon D" label for a row's updatedAt. Shared with the orchestrator. */
export function whenLabel(d: Date | string): string {
  const date = new Date(d as unknown as string);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type ProdFields = { name: string; description: string; price: string; url: string; sellingAngle: string; tags: string };

const EMPTY: ProdFields = { name: "", description: "", price: "", url: "", sellingAngle: "", tags: "" };

function fieldsOf(data: Record<string, unknown>): ProdFields {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const tags = Array.isArray(data.tags) ? (data.tags as unknown[]).filter((t) => typeof t === "string").join(", ") : "";
  return {
    name: s(data.name), description: s(data.description), price: s(data.price),
    url: s(data.url), sellingAngle: s(data.sellingAngle), tags,
  };
}

/** Convert form fields → record data (tags split from comma-joined text). */
function toData(f: ProdFields): Record<string, unknown> {
  const tags = f.tags.split(",").map((t) => t.trim()).filter(Boolean);
  return {
    name: f.name.trim(),
    ...(f.description.trim() ? { description: f.description.trim() } : {}),
    ...(f.price.trim() ? { price: f.price.trim() } : {}),
    ...(f.url.trim() ? { url: f.url.trim() } : {}),
    ...(f.sellingAngle.trim() ? { sellingAngle: f.sellingAngle.trim() } : {}),
    ...(tags.length ? { tags } : {}),
  };
}

function ProdForm({ initial, onCancel, onSubmit }: {
  initial: ProdFields;
  onCancel: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [f, setF] = useState<ProdFields>(initial);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof ProdFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Name *</span>
        <Input value={f.name} onChange={set("name")} placeholder="Latte Blend" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Description</span>
        <Textarea value={f.description} onChange={set("description")} rows={2} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Price</span>
        <Input value={f.price} onChange={set("price")} placeholder="RM 49" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Link</span>
        <Input value={f.url} onChange={set("url")} placeholder="https://…" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Selling angle</span>
        <Textarea value={f.sellingAngle} onChange={set("sellingAngle")} rows={1} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Tags (comma-separated)</span>
        <Input value={f.tags} onChange={set("tags")} placeholder="coffee, everyday" />
      </label>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!f.name.trim() || saving}
          onClick={() => {
            setSaving(true);
            void onSubmit(toData(f)).finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function ProductList({ records, looseNotes, freshIds, onSave, onArchive, onNoteSave, onNoteDelete }: {
  records: BrandRecordRow[];
  looseNotes: MemoryRow[];
  freshIds: Set<string>;
  onSave: (id: string | undefined, data: Record<string, unknown>) => Promise<void>;
  onArchive: (id: string, data: Record<string, unknown>, status: "active" | "archived") => Promise<void>;
  onNoteSave: (id: string, content: string) => Promise<void>;
  onNoteDelete: (id: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [noteEditId, setNoteEditId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const sorted = useMemo(() => {
    return [...records].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [records]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((r) => {
      const d = r.data as Record<string, unknown>;
      const name = typeof d.name === "string" ? d.name.toLowerCase() : "";
      const desc = typeof d.description === "string" ? d.description.toLowerCase() : "";
      const tags = Array.isArray(d.tags) ? (d.tags as unknown[]).filter((t) => typeof t === "string").join(" ").toLowerCase() : "";
      return name.includes(q) || desc.includes(q) || tags.includes(q);
    });
  }, [sorted, query]);

  const visible = showAll ? filtered : filtered.slice(0, 8);
  const hidden = filtered.length - visible.length;

  return (
    <section>
      <h2 className="text-[0.75rem] font-semibold tracking-[0.05em] uppercase text-muted-foreground mt-6 mb-2">Your products</h2>

      {records.length > 0 && (
        <div className="mb-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products…" />
        </div>
      )}

      <div className="rounded-[16px] border border-border bg-card divide-y divide-border">
        {records.length === 0 && looseNotes.length === 0 && (
          <div className="text-[0.875rem] leading-[1.45] text-muted-foreground px-[15px] py-[10px]">
            No products yet — tell Otto what you sell, or add one.
          </div>
        )}

        {visible.map((r) => {
          const d = r.data as Record<string, unknown>;
          const f = fieldsOf(d);
          const archived = r.status === "archived";
          const fresh = freshIds.has(r.id);
          return (
            <div key={r.id} className={`px-[15px] py-[10px] ${fresh ? "bg-brand/5 border-l-[3px] border-l-brand" : ""}`}>
              {editingId === r.id ? (
                <ProdForm
                  initial={f}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(data) => onSave(r.id, data).then(() => setEditingId(null))}
                />
              ) : (
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[0.875rem] leading-[1.45] font-semibold text-foreground">{f.name}</span>
                      {f.price && <span className="text-[0.8125rem] font-mono text-muted-foreground">{f.price}</span>}
                      {archived && (
                        <span className="text-[0.6875rem] rounded-full px-2 py-[2px] font-medium whitespace-nowrap text-muted-foreground bg-accent">Archived</span>
                      )}
                    </div>
                    {f.description && <div className="text-[0.8125rem] leading-[1.45] text-muted-foreground truncate">{f.description}</div>}
                    <div className="text-[0.6875rem] text-muted-foreground/70 mt-0.5">
                      {r.source === "otto" ? "✦ OTTO learned" : "You added"}
                      {whenLabel(r.updatedAt) ? ` · updated ${whenLabel(r.updatedAt)}` : ""}
                    </div>
                  </div>
                  <button type="button" aria-label="Edit" className="text-muted-foreground hover:text-foreground" onClick={() => setEditingId(r.id)}>✎</button>
                  <button
                    type="button"
                    className="text-[0.75rem] text-muted-foreground hover:text-foreground whitespace-nowrap"
                    onClick={() => void onArchive(r.id, d, archived ? "active" : "archived")}
                  >
                    {archived ? "Unarchive" : "Archive"}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Legacy loose product notes render as plain fact rows. */}
        {looseNotes.map((n) => (
          <div key={n.id} className={`px-[15px] py-[10px] ${freshIds.has(n.id) ? "bg-brand/5 border-l-[3px] border-l-brand" : ""}`}>
            {noteEditId === n.id ? (
              <div className="flex flex-col gap-2">
                <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void onNoteSave(n.id, noteText).then(() => setNoteEditId(null))}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setNoteEditId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <span className="text-[0.875rem] leading-[1.45] text-foreground flex-1">{n.content}</span>
                <span className={`text-[0.6875rem] rounded-full px-2 py-[2px] font-medium whitespace-nowrap ${n.source === "otto" ? "text-brand bg-brand/10" : "text-muted-foreground bg-accent"}`}>
                  {n.source === "otto" ? "✦ OTTO learned" : "You added"}
                </span>
                <button type="button" aria-label="Edit" className="text-muted-foreground hover:text-foreground" onClick={() => { setNoteEditId(n.id); setNoteText(n.content); }}>✎</button>
                <button type="button" aria-label="Delete" className="text-muted-foreground hover:text-foreground" onClick={() => void onNoteDelete(n.id)}>🗑</button>
              </div>
            )}
          </div>
        ))}

        <div className="px-[15px] py-[10px] flex items-center gap-3">
          {adding ? (
            <div className="w-full">
              <ProdForm
                initial={EMPTY}
                onCancel={() => setAdding(false)}
                onSubmit={(data) => onSave(undefined, data).then(() => setAdding(false))}
              />
            </div>
          ) : (
            <>
              <button type="button" className="text-[0.8125rem] text-muted-foreground hover:text-foreground" onClick={() => setAdding(true)}>+ Add a product</button>
              {hidden > 0 && (
                <button type="button" className="text-[0.8125rem] text-muted-foreground hover:text-foreground ml-auto" onClick={() => setShowAll(true)}>View all ({filtered.length})</button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
