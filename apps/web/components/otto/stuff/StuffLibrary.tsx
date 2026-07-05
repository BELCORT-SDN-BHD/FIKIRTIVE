"use client";
import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  type StuffFilter,
  type StuffItem,
  filterStuffItems,
} from "@/lib/stuff-items";

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
        <span className="absolute left-1.5 top-1.5 rounded-[8px] bg-card/90 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-brand">
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
}: {
  items: StuffItem[];
  mode: "library" | "picker";
  onPick?: (assetId: string) => void;
  onRename?: (entityId: string, name: string) => void;
  onDelete?: (entityId: string) => void;
  onSetProductImage?: (assetId: string) => void;
}) {
  const [filter, setFilter] = useState<StuffFilter>(mode === "picker" ? "images" : "all");
  const [search, setSearch] = useState("");

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
          <div className="py-4 text-[0.875rem] text-muted-foreground">No images to pick from.</div>
        ) : (
          <div className={grid}>
            {pickable.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => item.assetId && onPick?.(item.assetId)}
                className="group relative overflow-hidden rounded-[16px] border border-border bg-card text-left transition hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-brand"
              >
                <div className="relative aspect-square bg-muted">
                  <Thumb item={item} />
                  <TileChrome item={item} />
                </div>
                <div className="truncate px-2 py-1.5 text-[0.8125rem] font-medium text-foreground">
                  {item.label}
                </div>
              </button>
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
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded-[10px] px-3 py-1.5 text-[0.8125rem] font-semibold ${
              filter === f.value
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
            <span className="ml-1 text-muted-foreground/70">{counts[f.value]}</span>
          </button>
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
          aria-label="Search stuff"
          className="pl-10"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="py-4 text-[0.875rem] text-muted-foreground">
          {filter === "products" ? "No product assets yet. Add product knowledge in Brand memory, then link images here." : "Nothing here yet."}
        </div>
      ) : (
        <div className={grid}>
          {filtered.map((item) => {
            const isEntity = item.source === "entity" && !!item.entityId;
            const canSetProduct = !!item.assetId && item.mediaKind === "image";
            return (
              <div
                key={item.id}
                className="group relative overflow-hidden rounded-[16px] border border-border bg-card"
              >
                <div className="relative aspect-square bg-muted">
                  <Thumb item={item} />
                  <TileChrome item={item} />

                  {/* Hover overlay actions */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/50 p-2 opacity-0 transition group-hover:opacity-100">
                    {canSetProduct && onSetProductImage && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full"
                        onClick={() => item.assetId && onSetProductImage(item.assetId)}
                      >
                        Set as product image
                      </Button>
                    )}
                    {isEntity && onRename && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full"
                        onClick={() => {
                          const next = window.prompt("Rename", item.label);
                          if (next && next.trim() && item.entityId) onRename(item.entityId, next.trim());
                        }}
                      >
                        Rename
                      </Button>
                    )}
                    {isEntity && onDelete && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="w-full"
                        onClick={() => item.entityId && onDelete(item.entityId)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
                <div className="truncate px-2 py-1.5 text-[0.8125rem] font-medium text-foreground">
                  {item.label}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
