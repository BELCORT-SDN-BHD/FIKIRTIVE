"use client";
import React, { useMemo, useState } from "react";
import { categoryKey, distinctCategories } from "@fikirtive/core/brand-records";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link2, Check } from "lucide-react";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import type { MemoryRow } from "@/lib/memory-actions";
import type { StuffItem } from "@/lib/stuff-items";
import type { ProductDraftResult } from "@/lib/product-ingest-actions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

/** Short "Mon D" label for a row's updatedAt. Deterministic — no toLocaleDateString (SSR-safe). */
function whenLabel(d: Date | string): string {
  const date = new Date(d as unknown as string);
  return Number.isNaN(date.getTime()) ? "" : fmtDay(date);
}

type ProdFields = { name: string; description: string; price: string; url: string; sellingAngle: string; tags: string; category: string };

const EMPTY: ProdFields = { name: "", description: "", price: "", url: "", sellingAngle: "", tags: "", category: "" };

/** "Add from link" flow state (P1-01). Persists nothing until the user hits Save in the review form. */
type LinkState =
  | { phase: "idle" }
  | { phase: "url"; url: string; busy: boolean; err: string | null }
  | { phase: "review"; initial: ProdFields; source: string; filled: string[] };

function fieldsOf(data: Record<string, unknown>): ProdFields {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const tags = Array.isArray(data.tags) ? (data.tags as unknown[]).filter((t) => typeof t === "string").join(", ") : "";
  return {
    name: s(data.name), description: s(data.description), price: s(data.price),
    url: s(data.url), sellingAngle: s(data.sellingAngle), tags, category: s(data.category),
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
    ...(f.category.trim() ? { category: f.category.trim() } : {}),
  };
}

function ProdForm({ initial, categories, onCancel, onSubmit }: {
  initial: ProdFields;
  categories: string[];
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
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-muted-foreground">Category</span>
        <Input
          value={f.category}
          onChange={set("category")}
          list="product-categories"
          placeholder="e.g. Coffee — type a new name to create"
        />
        <datalist id="product-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
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
  onSave, onArchive, onNoteSave, onNoteDelete, onSetImage, onOpenPicker, onIngest,
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
  /** P1-01: read a product URL → draft (never saves). Undefined disables the "Paste a link" affordance. */
  onIngest?: (url: string) => Promise<ProductDraftResult>;
}) {
  const [query, setQuery] = useState("");
  const [catSel, setCatSel] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState<LinkState>({ phase: "idle" });
  const [noteEditId, setNoteEditId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  // P1-01: read a URL → prefilled draft. Deterministic only (JSON-LD/OG/title) — no LLM, no spend.
  // A sparse page just pre-fills fewer fields. Nothing is saved — the review form's Save does that.
  const runIngest = async (url: string) => {
    if (!onIngest) return;
    setLink({ phase: "url", url, busy: true, err: null });
    const res = await onIngest(url);
    // Stale-guard: if the user hit Cancel (or started another fetch) during the await,
    // don't clobber their state — only apply to the in-flight url step we started.
    setLink((cur) => {
      if (cur.phase !== "url" || cur.url !== url || !cur.busy) return cur;
      if ("error" in res) return { phase: "url", url, busy: false, err: res.error };
      const d = res.draft;
      const initial = fieldsOf({ name: d.name, description: d.description, price: d.price, url: d.sourceUrl });
      let source: string;
      try {
        source = new URL(d.sourceUrl).host;
      } catch {
        source = d.sourceUrl;
      }
      const filled = d.filled.filter((f) => f === "name" || f === "price" || f === "description");
      return { phase: "review", initial, source, filled };
    });
  };

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

  const categories = useMemo(
    () => distinctCategories(records.map((r) => ({ kind: r.kind, status: r.status, data: r.data }))),
    [records],
  );

  // Active-product counts per category key (+ uncategorized) for the chips row.
  const catCounts = useMemo(() => {
    const byKey = new Map<string, number>();
    let uncat = 0;
    for (const r of records) {
      if (r.status !== "active") continue;
      const raw = r.data.category;
      if (typeof raw === "string" && raw.trim()) {
        const key = categoryKey(raw);
        byKey.set(key, (byKey.get(key) ?? 0) + 1);
      } else {
        uncat += 1;
      }
    }
    return { byKey, uncat };
  }, [records]);

  // Guard against stranded keys: archiving the last product of a selected
  // category (or the last uncategorized one) removes its chip, but `catSel`
  // would still hide everything. Drop keys no longer present; when nothing
  // valid remains, treat as "All" (same safety property as before).
  const validSel = useMemo(() => {
    const live = new Set<string>();
    for (const c of categories) live.add(categoryKey(c));
    const out = new Set<string>();
    for (const key of catSel) {
      if (key === "uncat") {
        if (catCounts.uncat > 0) out.add(key);
      } else if (live.has(key)) {
        out.add(key);
      }
    }
    return out;
  }, [catSel, categories, catCounts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((r) => {
      const d = r.data as Record<string, unknown>;
      // Category filter applies to the active grid; archived cards pass through.
      // Empty validSel = All. Multiple selected = union (OR).
      if (validSel.size > 0 && r.status !== "archived") {
        const raw = d.category;
        const hasCat = typeof raw === "string" && raw.trim().length > 0;
        const key = hasCat ? categoryKey(raw as string) : "uncat";
        if (!validSel.has(key)) return false;
      }
      if (!q) return true;
      const name = typeof d.name === "string" ? d.name.toLowerCase() : "";
      const desc = typeof d.description === "string" ? d.description.toLowerCase() : "";
      const tags = Array.isArray(d.tags) ? (d.tags as unknown[]).filter((t) => typeof t === "string").join(" ").toLowerCase() : "";
      return name.includes(q) || desc.includes(q) || tags.includes(q);
    });
  }, [sorted, query, validSel]);

  const archivedCount = filtered.filter((r) => r.status === "archived").length;
  const activeCount = records.filter((r) => r.status === "active").length;

  return (
    <section>
      {/* Toolbar: search (flex) + Add product + Paste a link (P1-01). */}
      <div className="mt-6 mb-3 flex items-center gap-2">
        <Input
          aria-label="Search products"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products…"
          className="flex-1"
        />
        <Button size="sm" onClick={() => setAdding(true)}>+ Add product</Button>
        {onIngest && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setLink({ phase: "url", url: "", busy: false, err: null })}
          >
            <Link2 /> Paste a link
          </Button>
        )}
      </div>

      {/* "Add from link" flow: URL capture → prefilled ProdForm. Persists nothing until Save. */}
      {link.phase !== "idle" && (
        <div className="mb-4 max-w-[560px] rounded-[16px] border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[color:var(--brand-soft)] text-[color:var(--brand)]">
              <Link2 className="h-4 w-4" />
            </span>
            <span className="text-[0.875rem] font-semibold">Add product from link</span>
            <span className="ml-auto rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wide text-muted-foreground">
              read only · free
            </span>
          </div>

          {link.phase === "url" ? (
            <>
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Product page link"
                  value={link.url}
                  onChange={(e) => setLink({ phase: "url", url: e.target.value, busy: false, err: null })}
                  placeholder="https://… a product page"
                  className="flex-1"
                  disabled={link.busy}
                />
                <Button size="sm" disabled={link.busy || !link.url.trim()} onClick={() => void runIngest(link.url.trim())}>
                  {link.busy ? "Reading…" : "Fetch"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setLink({ phase: "idle" })}>
                  Cancel
                </Button>
              </div>
              {link.err && <p className="mt-2 text-[0.8125rem] text-[color:var(--destructive)]">{link.err}</p>}
              <p className="mt-2 text-[0.75rem] text-muted-foreground">
                Paste a product page — we read it and pre-fill the form for you. Free — nothing is saved until you do.
              </p>
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-[color:var(--brand)]" />
                Read from <span className="font-medium text-foreground">{link.source}</span>
                {link.filled.length > 0 && <span>· filled: {link.filled.join(", ")}</span>}
              </div>
              <ProdForm
                initial={link.initial}
                categories={categories}
                onCancel={() => setLink({ phase: "idle" })}
                onSubmit={(data) => onSave(undefined, data).then(() => setLink({ phase: "idle" }))}
              />
            </>
          )}
        </div>
      )}

      {/* Category filter chips (active products only) — multi-select toggles. */}
      {categories.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1 rounded-[14px] bg-muted p-1">
          {(() => {
            const toggle = (key: string) =>
              setCatSel((cur) => {
                const next = new Set(cur);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            const chip = (active: boolean, onClick: () => void, label: string, key: string) => (
              <Button
                key={key}
                type="button"
                variant="ghost"
                onClick={onClick}
                className={`h-auto whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[0.8125rem] font-normal ${
                  active ? "bg-card text-foreground shadow-sm hover:bg-card" : "bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground"
                }`}
              >
                {label}
              </Button>
            );
            return (
              <>
                {chip(validSel.size === 0, () => setCatSel(new Set()), `All (${activeCount})`, "all")}
                {categories.map((c) => {
                  const key = categoryKey(c);
                  return chip(validSel.has(key), () => toggle(key), `${c} (${catCounts.byKey.get(key) ?? 0})`, key);
                })}
                {catCounts.uncat > 0 &&
                  chip(validSel.has("uncat"), () => toggle("uncat"), `Uncategorized (${catCounts.uncat})`, "uncat")}
              </>
            );
          })()}
        </div>
      )}

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
                  categories={categories}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(data) => {
                    // Merge over the original record, but let a cleared category
                    // actually clear: toData() omits `category` when empty, so an
                    // unconditional spread would keep the stale value (mirror the
                    // prodSetImage delete-the-key discipline). Only `category`.
                    const merged = { ...d, ...data };
                    if (!("category" in data)) delete merged.category;
                    return onSave(r.id, merged).then(() => setEditingId(null));
                  }}
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
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenPicker(r)}
                    className="h-[150px] w-full rounded-none bg-accent/50 text-[0.8125rem] font-normal text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  >
                    Add image · from Library
                  </Button>
                )}
                {r.pinned && (
                  <span className="absolute left-2 top-2 rounded-[8px] bg-card/90 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-brand-strong">
                    ⭐ Pinned
                  </span>
                )}
              </div>

              {/* Body */}
              <div className="p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[0.875rem] leading-[1.45] font-semibold text-foreground">{f.name}</span>
                  {f.price && <span className="whitespace-nowrap font-mono text-[13px] text-muted-foreground">{f.price}</span>}
                </div>
                {f.description && (
                  <div className="mt-0.5 text-[0.8125rem] leading-[1.45] text-muted-foreground line-clamp-2">
                    {f.description}
                  </div>
                )}
                {/* Row 1: badges wrap as whole units; updated label pushed right. */}
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-muted-foreground/70">
                  <span className="whitespace-nowrap rounded-full bg-accent px-2 py-[2px] font-medium text-muted-foreground">
                    {r.source === "otto" ? "✦ Otto learned" : "You added"}
                  </span>
                  {f.category && (
                    <span className="whitespace-nowrap rounded-full bg-accent px-2 py-[2px] text-[0.6875rem] text-muted-foreground">
                      {f.category}
                    </span>
                  )}
                  {whenLabel(r.updatedAt) && (
                    <span className="ml-auto whitespace-nowrap">updated {whenLabel(r.updatedAt)}</span>
                  )}
                </div>
                {/* Row 2: actions as small ghost buttons (comfortable tap targets). */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1">
                  {imgUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="-ml-2 h-auto rounded-[8px] px-2 py-1 text-[0.8125rem] font-normal text-muted-foreground first:ml-0"
                      onClick={() => void onSetImage(r, null)}
                    >
                      Remove image
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Edit"
                    className="-ml-2 h-auto rounded-[8px] px-2 py-1 text-[0.8125rem] font-normal text-muted-foreground first:ml-0"
                    onClick={() => setEditingId(r.id)}
                  >
                    ✎ Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="-ml-2 h-auto rounded-[8px] px-2 py-1 text-[0.8125rem] font-normal text-muted-foreground first:ml-0"
                    onClick={() => void onArchive(r.id, d, archived ? "active" : "archived")}
                  >
                    {archived ? "Unarchive" : "Archive"}
                  </Button>
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
              categories={categories}
              onCancel={() => setAdding(false)}
              onSubmit={(data) => onSave(undefined, data).then(() => setAdding(false))}
            />
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setAdding(true)}
            className="h-auto min-h-[150px] rounded-[16px] border-dashed border-border bg-card text-[0.8125rem] font-normal text-muted-foreground hover:bg-card"
          >
            + Add product
          </Button>
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
                  <Textarea aria-label="Edit this product note" value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} />
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
                  <Button type="button" variant="ghost" aria-label="Edit" className="h-auto w-auto p-0 text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={() => { setNoteEditId(n.id); setNoteText(n.content); }}>✎</Button>
                  <Button type="button" variant="ghost" aria-label="Delete" className="h-auto w-auto p-0 text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={() => void onNoteDelete(n.id)}>🗑</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
