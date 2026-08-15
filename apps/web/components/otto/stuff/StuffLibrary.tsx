"use client";
import React, { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OttoRenameDialog } from "@/components/otto/OttoPromptDialog";
import { ExitLink } from "@/components/exits/Exits";
import { BRAND_MEMORY_HREF } from "@/lib/exits";
import {
  type StuffFilter,
  type StuffItem,
  filterStuffItems,
} from "@/lib/stuff-items";

/** What a search that found nothing actually means (#701).
 *
 *  "Nothing here yet." used to cover both an empty library AND a search miss. In the second
 *  case it is simply false — the merchant's assets are all still there — and it reads as
 *  "your stuff is gone". Naming the query back is what tells them which of the two it is. */
function noMatchesMessage(query: string): string {
  return `No matches for “${query.trim()}”.`;
}

const FILTERS: { value: StuffFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "images", label: "Images" },
  { value: "videos", label: "Videos" },
  { value: "cast", label: "Cast" },
  { value: "products", label: "Product assets" },
  { value: "ads", label: "Ads" },
];

/** Short type tag shown on a tile ("Cast"/"Product"/"Video"/"Ad"…). */
function tagFor(item: StuffItem): string | null {
  if (item.source === "ad") return "Ad";
  if (item.mediaKind === "video") return "Video";
  switch (item.entityType) {
    case "CHARACTER":
      return "Cast";
    case "PRODUCT":
      return "Product";
    case "LOCATION":
      return "Location";
    case "BRANDMARK":
      return "Brand mark";
    default:
      return null;
  }
}

function Thumb({ item }: { item: StuffItem }) {
  if (!item.url) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-accent text-[1.5rem] font-semibold text-muted-foreground/70">
        {item.label.trim().charAt(0).toUpperCase() || "?"}
      </div>
    );
  }
  if (item.mediaKind === "video") {
    return <video src={item.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={item.url} alt={item.label} className="h-full w-full object-cover" />;
}

function TileChrome({ item }: { item: StuffItem }) {
  const tag = tagFor(item);
  return (
    <>
      {item.productName && (
        <span className="absolute left-1.5 top-1.5 rounded-[8px] bg-card/90 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-brand-strong">
          Used by product: {item.productName}
        </span>
      )}
      {tag && (
        <span className="absolute bottom-1.5 right-1.5 rounded-[8px] bg-card/90 px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
          {tag}
        </span>
      )}
    </>
  );
}

export function StuffLibrary({
  items,
  mode,
  onPick,
  onRename,
  onDelete,
  onSetProductImage,
  onOpenGeneration,
  onOpenEntity,
  onAdd,
}: {
  items: StuffItem[];
  mode: "library" | "picker";
  onPick?: (assetId: string) => void;
  onRename?: (entityId: string, name: string) => void;
  onDelete?: (entityId: string) => void;
  onSetProductImage?: (assetId: string) => void;
  onOpenGeneration?: (generationId: string, projectId: string) => void;
  /** #781 — open a saved element (cast/product/location/brand mark) so its base look and
   *  styling variants are reachable. Without this the variant pathway had no door at all. */
  onOpenEntity?: (entityId: string) => void;
  /** #942 — opens the same "Add to Library" upload dialog the header's Add button opens.
   *  Only read by "library" mode's empty state, to turn a blank library into a next step
   *  instead of a dead end. */
  onAdd?: () => void;
}) {
  const [filter, setFilter] = useState<StuffFilter>(mode === "picker" ? "images" : "all");
  const [search, setSearch] = useState("");
  const [renameTarget, setRenameTarget] = useState<StuffItem | null>(null);
  // #934 — a click here used to delete immediately. Route it through a confirmation
  // instead, so an accidental click can't take an item out of Library unnoticed.
  const [deleteTarget, setDeleteTarget] = useState<StuffItem | null>(null);

  // Picker: only image items that carry an assetId are selectable.
  const pickable = useMemo(
    () => filterStuffItems(items, "images", search).filter((i) => i.assetId),
    [items, search],
  );

  const filtered = useMemo(
    () => filterStuffItems(items, filter, search),
    [items, filter, search],
  );

  const counts = useMemo(() => {
    const map = {} as Record<StuffFilter, number>;
    for (const f of FILTERS) map[f.value] = filterStuffItems(items, f.value, search).length;
    return map;
  }, [items, search]);

  const grid = "grid grid-cols-3 md:grid-cols-5 gap-3";
  const searching = search.trim() !== "";

  if (mode === "picker") {
    return (
      <div className="flex flex-col gap-3">
        <div className="relative max-w-[320px]">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search images…"
            aria-label="Search images"
            className="pl-10"
          />
        </div>
        {pickable.length === 0 ? (
          <div className="py-4 text-[0.875rem] text-muted-foreground">
            {searching ? noMatchesMessage(search) : "No images to pick from."}
          </div>
        ) : (
          <div className={grid}>
            {pickable.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                onClick={() => item.assetId && onPick?.(item.assetId)}
                className="group relative h-auto w-full flex-col items-stretch justify-start gap-0 overflow-hidden rounded-[16px] border border-border bg-card p-0 text-left transition hover:border-foreground/30 hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
              >
                <div className="relative aspect-square bg-muted">
                  <Thumb item={item} />
                  <TileChrome item={item} />
                </div>
                <div className="truncate px-2 py-1.5 text-[0.8125rem] font-medium text-foreground">
                  {item.label}
                </div>
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filter pills */}
      <div className="flex flex-wrap gap-1 rounded-[14px] bg-muted p-1">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            type="button"
            variant="ghost"
            onClick={() => setFilter(f.value)}
            className={`h-auto rounded-[10px] px-3 py-1.5 text-[0.8125rem] font-semibold ${
              filter === f.value
                ? "bg-card text-foreground shadow-xs hover:bg-card"
                : "bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground"
            }`}
          >
            {f.label}
            <span className="ml-1 text-muted-foreground/70">{counts[f.value]}</span>
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-[320px]">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          aria-label="Search library"
          className="pl-10"
        />
      </div>

      {filtered.length === 0 ? (
        // #701 — three different facts, three different sentences. A search that found
        // nothing is not an empty library, and "go to Brand memory" is a link, not directions.
        searching ? (
          <div className="py-4 text-[0.875rem] text-muted-foreground">{noMatchesMessage(search)}</div>
        ) : filter === "products" ? (
          <div className="py-4 text-[0.875rem] text-muted-foreground">
            No product assets yet. Add product knowledge in{" "}
            <ExitLink href={BRAND_MEMORY_HREF}>Brand memory</ExitLink>, then link images here.
          </div>
        ) : items.length === 0 && onAdd ? (
          // #942 — the onboarding tile's "Add a character or product" lands here when the shop
          // has nothing saved yet. It used to say "Nothing here yet." and stop there, a dead
          // end with no next step. Point straight at the same upload dialog the header's Add
          // button opens, instead of building a second upload path.
          <div className="flex flex-col items-center gap-3 rounded-[16px] border border-dashed border-border px-6 py-10 text-center">
            <p className="max-w-[360px] text-[0.875rem] text-muted-foreground">
              Add your first character or product photo. Otto keeps it consistent across every
              project.
            </p>
            <Button type="button" size="sm" onClick={onAdd}>
              <Plus size={16} />
              Add to Library
            </Button>
          </div>
        ) : (
          <div className="py-4 text-[0.875rem] text-muted-foreground">Nothing here yet.</div>
        )
      ) : (
        <div className={grid}>
          {filtered.map((item) => {
            const isEntity = item.source === "entity" && !!item.entityId;
            const canSetProduct = !!item.assetId && item.mediaKind === "image";
            const canOpenGeneration = !!item.generationId && !!item.projectId;
            // #781 — an element tile opens the element (base look + styling variants); a
            // generation tile opens the generation. One control, two destinations, so the
            // merchant's "click the thing to see it" habit works on both.
            const canOpenEntityTile = isEntity && !!onOpenEntity;
            const canOpen = canOpenGeneration || canOpenEntityTile;
            const openItem = () => {
              if (canOpenGeneration) onOpenGeneration?.(item.generationId!, item.projectId!);
              else if (canOpenEntityTile) onOpenEntity?.(item.entityId!);
            };
            return (
              <div
                key={item.id}
                className="group relative overflow-hidden rounded-[16px] border border-border bg-card"
              >
                <div className="relative aspect-square bg-muted">
                  {canOpen ? (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Open ${item.label}`}
                      onClick={openItem}
                      className="absolute inset-0 h-full w-full rounded-none border-0 bg-transparent p-0 text-left hover:bg-transparent focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      <Thumb item={item} />
                      <TileChrome item={item} />
                    </Button>
                  ) : (
                    <>
                      <Thumb item={item} />
                      <TileChrome item={item} />
                    </>
                  )}

                  {/* Hover overlay actions */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/50 p-2 opacity-0 transition group-hover:opacity-100">
                    {canSetProduct && onSetProductImage && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="pointer-events-auto w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (item.assetId) onSetProductImage(item.assetId);
                        }}
                      >
                        Set as product image
                      </Button>
                    )}
                    {isEntity && onRename && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="pointer-events-auto w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameTarget(item);
                        }}
                      >
                        Rename
                      </Button>
                    )}
                    {isEntity && onDelete && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="pointer-events-auto w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(item);
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
                {canOpen ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={openItem}
                    className="h-auto w-full min-w-0 justify-start truncate rounded-none bg-transparent px-2 py-1.5 text-left text-[0.8125rem] font-medium text-foreground hover:bg-transparent hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    {item.label}
                  </Button>
                ) : (
                  <div className="truncate px-2 py-1.5 text-[0.8125rem] font-medium text-foreground">
                    {item.label}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <OttoRenameDialog
        open={!!renameTarget}
        onOpenChange={(open) => { if (!open) setRenameTarget(null); }}
        title="Rename item"
        description="This changes the label you see in Library. It does not edit the original media."
        label="Item name"
        initialValue={renameTarget?.label ?? ""}
        onSubmit={async (name) => {
          if (!renameTarget?.entityId) return;
          await onRename?.(renameTarget.entityId, name);
        }}
      />
      <AlertDialog open={!!deleteTarget} onOpenChange={(next) => { if (!next) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from library?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `This moves "${deleteTarget.label}" out of Library. It won't show up in projects, pickers, or search anymore.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget?.entityId) onDelete?.(deleteTarget.entityId);
                setDeleteTarget(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
