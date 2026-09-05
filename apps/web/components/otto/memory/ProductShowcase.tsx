"use client";
import React, { useMemo, useRef, useState } from "react";
import { categoryKey, distinctCategories } from "@fikirtive/core/brand-records";
import { Archive, ArchiveRestore, Check, ImageOff, ImagePlus, Link2, MoreHorizontal, PackageOpen, Pencil, Pin, Plus, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import type { MemoryRow } from "@/lib/memory-actions";
import type { StuffItem } from "@/lib/stuff-items";
import type { ProductDraftResult } from "@/lib/product-ingest-actions";
import { shortDayLabel } from "@/lib/short-date-label";
import { cn } from "@/lib/utils";
import { MemoryNoteCard } from "./MemoryNoteCard";
import { MemorySourceBadge } from "./MemorySourceBadge";
import { useAsyncActionFeedback } from "./useAsyncActionFeedback";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";

/** Short "Mon D" label for a row's updatedAt. Deterministic — no toLocaleDateString (SSR-safe).
 *  The month names come from lib/short-date-label; OfferList.tsx held the identical copy. */
function whenLabel(d: Date | string): string {
  const date = new Date(d as unknown as string);
  return Number.isNaN(date.getTime()) ? "" : shortDayLabel(date);
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

function ProdForm({ initial, categories, onCancel, onSubmit, onSaved }: {
  initial: ProdFields;
  categories: string[];
  onCancel: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<string | null>;
  onSaved: () => void;
}) {
  const [f, setF] = useState<ProdFields>(initial);
  const submission = useAsyncActionFeedback("The product couldn't be saved. Check your connection and try again.");
  const set = (k: keyof ProdFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  async function save() {
    const outcome = await submission.run(() => onSubmit(toData(f)));
    if (outcome === "success") onSaved();
  }

  return (
    <FieldGroup className="gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel>Name *</FieldLabel><Input value={f.name} onChange={set("name")} placeholder="Latte Blend" /></Field>
        <Field><FieldLabel>Price</FieldLabel><Input value={f.price} onChange={set("price")} placeholder="RM 49" /></Field>
      </div>
      <Field><FieldLabel>Description</FieldLabel><Textarea value={f.description} onChange={set("description")} rows={2} /></Field>
      <Field><FieldLabel>Selling angle</FieldLabel><Textarea value={f.sellingAngle} onChange={set("sellingAngle")} rows={2} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel>Link</FieldLabel><Input value={f.url} onChange={set("url")} placeholder="https://…" /></Field>
        <Field><FieldLabel>Tags</FieldLabel><Input value={f.tags} onChange={set("tags")} placeholder="coffee, everyday" /></Field>
      </div>
      <Field>
        <FieldLabel>Category</FieldLabel>
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
      </Field>
      {submission.error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Product wasn&apos;t saved</AlertTitle>
          <AlertDescription>{submission.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!f.name.trim() || submission.pending}
          onClick={() => void save()}
        >
          {submission.pending && <Spinner data-icon="inline-start" />}
          {submission.pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" disabled={submission.pending} onClick={onCancel}>Cancel</Button>
      </div>
    </FieldGroup>
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
  onSave: (id: string | undefined, data: Record<string, unknown>) => Promise<string | null>;
  onArchive: (id: string, data: Record<string, unknown>, status: "active" | "archived") => Promise<string | null>;
  onNoteSave: (id: string, content: string) => Promise<string | null>;
  onNoteDelete: (id: string) => Promise<string | null>;
  onSetImage: (rec: BrandRecordRow, assetId: string | null) => Promise<string | null>;
  onOpenPicker: (rec: BrandRecordRow) => void;
  /** P1-01: read a product URL → draft (never saves). Undefined disables the "Paste a link" affordance. */
  onIngest?: (url: string) => Promise<ProductDraftResult>;
}) {
  const [query, setQuery] = useState("");
  const [catSel, setCatSel] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState<LinkState>({ phase: "idle" });
  const [archivePendingId, setArchivePendingId] = useState<string | null>(null);
  const [imagePendingId, setImagePendingId] = useState<string | null>(null);
  const ingestSubmittingRef = useRef(false);
  const archiveFeedback = useAsyncActionFeedback("The product couldn't be updated. Check your connection and try again.");
  const imageFeedback = useAsyncActionFeedback("The product image couldn't be removed. Check your connection and try again.");

  async function toggleArchive(record: BrandRecordRow) {
    if (archiveFeedback.pending) return;
    setArchivePendingId(record.id);
    const outcome = await archiveFeedback.run(() => onArchive(
      record.id,
      record.data,
      record.status === "archived" ? "active" : "archived",
    ));
    if (outcome !== "ignored") setArchivePendingId(null);
  }

  async function removeImage(record: BrandRecordRow) {
    if (imageFeedback.pending) return;
    setImagePendingId(record.id);
    const outcome = await imageFeedback.run(() => onSetImage(record, null));
    if (outcome !== "ignored") setImagePendingId(null);
  }

  function openImagePicker(record: BrandRecordRow) {
    imageFeedback.clearError();
    onOpenPicker(record);
  }

  // P1-01: read a URL → prefilled draft. Deterministic only (JSON-LD/OG/title) — no LLM, no spend.
  // A sparse page just pre-fills fewer fields. Nothing is saved — the review form's Save does that.
  const runIngest = async (url: string) => {
    if (!onIngest || ingestSubmittingRef.current) return;
    ingestSubmittingRef.current = true;
    setLink({ phase: "url", url, busy: true, err: null });
    try {
      const res = await onIngest(url);
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
    } catch {
      setLink((cur) => (
        cur.phase === "url" && cur.url === url && cur.busy
          ? { phase: "url", url, busy: false, err: "The product page couldn't be read. Check your connection and try again." }
          : cur
      ));
    } finally {
      ingestSubmittingRef.current = false;
    }
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
    <section className="flex flex-col gap-4">
      {archiveFeedback.error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Product wasn&apos;t updated</AlertTitle>
          <AlertDescription>{archiveFeedback.error}</AlertDescription>
        </Alert>
      )}
      {imageFeedback.error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Product image wasn&apos;t removed</AlertTitle>
          <AlertDescription>{imageFeedback.error}</AlertDescription>
        </Alert>
      )}
      {/* Toolbar: search (flex) + Add product + Paste a link (P1-01). */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <InputGroup className="flex-1">
          <InputGroupAddon><Search aria-hidden /></InputGroupAddon>
          <InputGroupInput aria-label="Search products" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products…" />
        </InputGroup>
        <Button size="sm" onClick={() => setAdding(true)}><Plus data-icon="inline-start" />Add product</Button>
        {onIngest && (
          <Button
            size="sm"
            variant="secondary"
            disabled={link.phase !== "idle"}
            onClick={() => setLink({ phase: "url", url: "", busy: false, err: null })}
          >
            <Link2 data-icon="inline-start" />Paste a link
          </Button>
        )}
      </div>

      {/* "Add from link" flow: URL capture → prefilled ProdForm. Persists nothing until Save. */}
      {link.phase !== "idle" && (
        <Card size="sm" className="max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardTitle>Add product from link</CardTitle>
              <Badge variant="outline" className="ml-auto">Read only · free</Badge>
            </div>
            <CardDescription>Read a product page and review every detail before anything is saved.</CardDescription>
          </CardHeader>
          {link.phase === "url" ? (
            <>
              <CardContent>
                <FieldGroup>
                  <Field data-invalid={!!link.err}>
                    <FieldLabel className="sr-only">Product page link</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        aria-label="Product page link"
                        aria-invalid={!!link.err}
                        value={link.url}
                        onChange={(event) => setLink({ phase: "url", url: event.target.value, busy: false, err: null })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !link.busy && link.url.trim()) {
                            event.preventDefault();
                            void runIngest(link.url.trim());
                          }
                        }}
                        placeholder="https://… a product page"
                        disabled={link.busy}
                      />
                      <InputGroupAddon align="inline-start"><Link2 aria-hidden /></InputGroupAddon>
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          size="sm"
                          variant="secondary"
                          disabled={link.busy || !link.url.trim()}
                          onClick={() => void runIngest(link.url.trim())}
                        >
                          {link.busy && <Spinner data-icon="inline-start" />}
                          {link.busy ? "Reading…" : "Read product"}
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                    <FieldDescription>Free to read. Nothing is saved until you review the draft and choose Save.</FieldDescription>
                  </Field>
                  {link.err && (
                    <Alert variant="destructive" role="alert">
                      <AlertTitle>Product page wasn&apos;t read</AlertTitle>
                      <AlertDescription>{link.err}</AlertDescription>
                    </Alert>
                  )}
                </FieldGroup>
              </CardContent>
              <CardFooter>
                <Button type="button" size="sm" variant="ghost" disabled={link.busy} onClick={() => setLink({ phase: "idle" })}>
                  Cancel
                </Button>
              </CardFooter>
            </>
          ) : (
            <CardContent className="flex flex-col gap-4">
              <Alert variant="success">
                <Check aria-hidden />
                <AlertTitle>Product details found</AlertTitle>
                <AlertDescription>
                  Read from {link.source}{link.filled.length > 0 ? ` · filled: ${link.filled.join(", ")}` : ""}.
                </AlertDescription>
              </Alert>
              <ProdForm
                initial={link.initial}
                categories={categories}
                onCancel={() => setLink({ phase: "idle" })}
                onSaved={() => setLink({ phase: "idle" })}
                onSubmit={(data) => onSave(undefined, data)}
              />
            </CardContent>
          )}
        </Card>
      )}

      {/* Category filter chips (active products only) — multi-select toggles. */}
      {categories.length > 0 && (
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          value={validSel.size === 0 ? ["all"] : [...validSel]}
          onValueChange={(values) => {
            if (values.includes("all") && validSel.size > 0) setCatSel(new Set());
            else setCatSel(new Set(values.filter((value) => value !== "all")));
          }}
          className="w-full flex-wrap justify-start rounded-lg bg-muted p-1"
        >
          <ToggleGroupItem value="all">All ({activeCount})</ToggleGroupItem>
          {categories.map((category) => {
            const key = categoryKey(category);
            return <ToggleGroupItem key={key} value={key}>{category} ({catCounts.byKey.get(key) ?? 0})</ToggleGroupItem>;
          })}
          {catCounts.uncat > 0 && <ToggleGroupItem value="uncat">Uncategorized ({catCounts.uncat})</ToggleGroupItem>}
        </ToggleGroup>
      )}

      {records.length === 0 && looseNotes.length === 0 && (
        <Empty className="min-h-64 border border-dashed border-border"><EmptyHeader><EmptyMedia variant="icon"><PackageOpen aria-hidden /></EmptyMedia><EmptyTitle>No products yet</EmptyTitle><EmptyDescription>Add what you sell so Otto can reuse the right details, positioning, and imagery.</EmptyDescription></EmptyHeader><EmptyContent><Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus data-icon="inline-start" />Add product</Button></EmptyContent></Empty>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((r) => {
          const d = r.data as Record<string, unknown>;
          const f = fieldsOf(d);
          const archived = r.status === "archived";
          const fresh = freshIds.has(r.id);
          const assetId = typeof d.imageAssetId === "string" ? d.imageAssetId : "";
          const imgUrl = assetId ? urlByAsset.get(assetId) : undefined;

          if (editingId === r.id) {
            return (
              <Card key={r.id} size="sm" className="sm:col-span-2 xl:col-span-3">
                <CardContent><ProdForm
                  initial={f}
                  categories={categories}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => setEditingId(null)}
                  onSubmit={(data) => {
                    // Merge over the original record, but let a cleared category
                    // actually clear: toData() omits `category` when empty, so an
                    // unconditional spread would keep the stale value (mirror the
                    // prodSetImage delete-the-key discipline). Only `category`.
                    const merged = { ...d, ...data };
                    if (!("category" in data)) delete merged.category;
                    return onSave(r.id, merged);
                  }}
                /></CardContent>
              </Card>
            );
          }

          return (
            <Card
              key={r.id}
              size="sm"
              tone={fresh ? "otto" : "default"}
              className={cn("gap-0 overflow-hidden p-0", archived && "opacity-55")}
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
                    onClick={() => openImagePicker(r)}
                    className="h-[150px] w-full rounded-none bg-muted text-sm font-normal text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  >
                    <ImageOff data-icon="inline-start" />{`Add image · from ${PRODUCT_VOCABULARY.library}`}
                  </Button>
                )}
                {r.pinned && (
                  <Badge variant="outline" className="absolute left-2 top-2 bg-card/90"><Pin aria-hidden />Pinned</Badge>
                )}
              </div>

              {/* Body */}
              <CardHeader className="p-4 pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><CardTitle>{f.name}</CardTitle>{f.price && <p className="mt-1 font-mono text-xs text-muted-foreground">{f.price}</p>}</div>
                  <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="icon-xs" variant="ghost" disabled={archivePendingId === r.id || imagePendingId === r.id} aria-label={`Actions for ${f.name}`}><MoreHorizontal aria-hidden /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={() => setEditingId(r.id)}><Pencil aria-hidden />Edit</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => openImagePicker(r)}><ImagePlus aria-hidden />{assetId ? "Replace image" : "Choose image"}</DropdownMenuItem>
                      </DropdownMenuGroup>
                      {assetId && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={() => void removeImage(r)}><ImageOff aria-hidden />Remove from product</DropdownMenuItem>
                          </DropdownMenuGroup>
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={() => void toggleArchive(r)}>{archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}{archived ? "Unarchive" : "Archive"}</DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {f.description && (
                  <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                    {f.description}
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 p-4">
                {/* Row 1: badges wrap as whole units; updated label pushed right. */}
                <MemorySourceBadge source={r.source} />
                {f.category && <Badge variant="outline">{f.category}</Badge>}
                {archived && <Badge variant="outline">Archived</Badge>}
              </CardContent>
              <CardFooter className="justify-between border-t border-border p-4 text-xs text-muted-foreground">
                {whenLabel(r.updatedAt) ? `Updated ${whenLabel(r.updatedAt)}` : "Saved product"}
                {archivePendingId === r.id && <Badge><Spinner />{archived ? "Unarchiving…" : "Archiving…"}</Badge>}
                {imagePendingId === r.id && <Badge><Spinner />Removing image…</Badge>}
              </CardFooter>
            </Card>
          );
        })}

        {/* Add-product dashed card at grid end. */}
        {adding ? (
          <Card size="sm" className="sm:col-span-2 xl:col-span-3">
            <CardContent><ProdForm
              initial={EMPTY}
              categories={categories}
              onCancel={() => setAdding(false)}
              onSaved={() => setAdding(false)}
              onSubmit={(data) => onSave(undefined, data)}
            /></CardContent>
          </Card>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setAdding(true)}
            className="h-auto min-h-[220px] rounded-[var(--radius-card)] border-dashed border-border bg-card text-sm font-normal text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            <Plus data-icon="inline-start" />Add product
          </Button>
        )}
      </div>

      {archivedCount > 0 && (
        <div className="text-xs text-muted-foreground">
          Archived ({archivedCount}) — hidden from Otto
        </div>
      )}

      {/* Legacy loose product notes render as plain fact rows below the grid. */}
      {looseNotes.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {looseNotes.map((note) => (
            <MemoryNoteCard
              key={note.id}
              note={note}
              fresh={freshIds.has(note.id)}
              onSave={onNoteSave}
              onDelete={onNoteDelete}
            />
          ))}
        </div>
      )}
    </section>
  );
}
