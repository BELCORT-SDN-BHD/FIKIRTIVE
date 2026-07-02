"use client";
import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import type { MemoryRow } from "@/lib/memory-actions";
import type { StuffItem } from "@/lib/stuff-items";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

/** Short "Mon D" label for a row's updatedAt. Deterministic — no toLocaleDateString (SSR-safe). */
export function whenLabel(d: Date | string): string {
  const date = new Date(d as unknown as string);
  return Number.isNaN(date.getTime()) ? "" : fmtDay(date);
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

export function ProductShowcase({
  records, looseNotes, freshIds, stuffItems = [],
  onSave, onArchive, onNoteSave, onNoteDelete, onSetImage, onOpenPicker,
}: {
  records: BrandRecordRow[];
  looseNotes: MemoryRow[];
  freshIds: Set<string>;
  stuffItems?: StuffItem[];
  onSave: (id: string | undefined, data: Record<string, unknown>) => Promise<void>;
  onArchive: (id: string, data: Record<string, unknown>, status: "active" | "archived") => Promise<void>;
  onNoteSave: (id: string, content: string) => Promise<void>;
  onNoteDelete: (id: string) => Promise<void>;
  onSetImage: (rec: BrandRecordRow, assetId: string | null) => Promise<void>;
  onOpenPicker: (rec: BrandRecordRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [noteEditId, setNoteEditId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  // assetId → image url (only image items that carry an assetId + url).
  const urlByAsset = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of stuffItems) {
      if (it.assetId && it.url && it.mediaKind === "image") m.set(it.assetId, it.url);
    }
    return m;
  }, [stuffItems]);

  const sorted = useMemo(() => {
    return [...records].sort((a, b) => {
      // Archived cards sort last, regardless of pin/recency.
      const aArch = a.status === "archived";
      const bArch = b.status === "archived";
      if (aArch !== bArch) return aArch ? 1 : -1;
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

  const archivedCount = filtered.filter((r) => r.status === "archived").length;

  return (
    <section>
      {/* Toolbar: search (flex) + Add product button (right). */}
      <div className="mt-6 mb-3 flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products…"
          className="flex-1"
        />
        <Button size="sm" onClick={() => setAdding(true)}>+ Add product</Button>
      </div>

      {records.length === 0 && looseNotes.length === 0 && (
        <div className="rounded-[16px] border border-border bg-card px-[15px] py-[10px] text-[0.875rem] leading-[1.45] text-muted-foreground">
          No products yet — tell Otto what you sell, or add one.
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((r) => {
          const d = r.data as Record<string, unknown>;
          const f = fieldsOf(d);
          const archived = r.status === "archived";
          const fresh = freshIds.has(r.id);
          const assetId = typeof d.imageAssetId === "string" ? d.imageAssetId : "";
          const imgUrl = assetId ? urlByAsset.get(assetId) : undefined;

          if (editingId === r.id) {
            return (
              <div key={r.id} className="rounded-[16px] border border-border bg-card p-4">
                <ProdForm
                  initial={f}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(data) => onSave(r.id, { ...d, ...data }).then(() => setEditingId(null))}
                />
              </div>
            );
          }

          return (
            <div
              key={r.id}
              className={`rounded-[16px] border border-border bg-card overflow-hidden ${archived ? "opacity-55" : ""} ${
                fresh ? "border-l-[3px] border-l-brand" : ""
              }`}
            >
              {/* Image area */}
              <div className="relative">
                {imgUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imgUrl} alt={f.name} className="h-[150px] w-full object-cover" />
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenPicker(r)}
                    className="flex h-[150px] w-full items-center justify-center bg-accent/50 text-[0.8125rem] text-muted-foreground hover:text-foreground"
                  >
                    Add image · from My Stuff
                  </button>
                )}
                {r.pinned && (
                  <span className="absolute left-2 top-2 rounded-[8px] bg-card/90 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-brand">
                    ⭐ Pinned
                  </span>
                )}
              </div>

              {/* Body */}
              <div className="p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[0.875rem] leading-[1.45] font-semibold text-foreground">{f.name}</span>
                  {f.price && <span className="text-[0.8125rem] font-mono text-muted-foreground">{f.price}</span>}
                </div>
                {f.description && (
                  <div className="mt-0.5 text-[0.8125rem] leading-[1.45] text-muted-foreground line-clamp-2">
                    {f.description}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2 text-[0.6875rem] text-muted-foreground/70">
                  <span className="rounded-full bg-accent px-2 py-[2px] font-medium text-muted-foreground">
                    {r.source === "otto" ? "✦ OTTO learned" : "You added"}
                  </span>
                  {whenLabel(r.updatedAt) && <span>updated {whenLabel(r.updatedAt)}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground/70">
                  {imgUrl && (
                    <button
                      type="button"
                      className="hover:text-foreground whitespace-nowrap"
                      onClick={() => void onSetImage(r, null)}
                    >
                      Remove image
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Edit"
                    className="hover:text-foreground whitespace-nowrap"
                    onClick={() => setEditingId(r.id)}
                  >
                    ✎ Edit
                  </button>
                  <button
                    type="button"
                    className="hover:text-foreground whitespace-nowrap"
                    onClick={() => void onArchive(r.id, d, archived ? "active" : "archived")}
                  >
                    {archived ? "Unarchive" : "Archive"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Add-product dashed card at grid end. */}
        {adding ? (
          <div className="rounded-[16px] border border-border bg-card p-4">
            <ProdForm
              initial={EMPTY}
              onCancel={() => setAdding(false)}
              onSubmit={(data) => onSave(undefined, data).then(() => setAdding(false))}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-[150px] items-center justify-center rounded-[16px] border border-dashed border-border bg-card text-[0.8125rem] text-muted-foreground hover:text-foreground"
          >
            + Add product
          </button>
        )}
      </div>

      {archivedCount > 0 && (
        <div className="mt-3 text-[0.6875rem] text-muted-foreground/70">
          Archived ({archivedCount}) — hidden from Otto
        </div>
      )}

      {/* Legacy loose product notes render as plain fact rows below the grid. */}
      {looseNotes.length > 0 && (
        <div className="mt-4 rounded-[16px] border border-border bg-card divide-y divide-border">
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
        </div>
      )}
    </section>
  );
}
