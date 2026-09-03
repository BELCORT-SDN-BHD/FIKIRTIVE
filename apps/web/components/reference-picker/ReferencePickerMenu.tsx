"use client";

import Link from "next/link";
import type { ComponentType, ReactElement } from "react";
import { useLayoutEffect } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  ImagesIcon,
  MapPinIcon,
  PackageIcon,
  ShirtIcon,
  SparklesIcon,
  StampIcon,
  UploadIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { ReferenceType } from "@fikirtive/core/reference-ref";

import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The one `@` reference menu.
 *
 * Before this there were two: a name-only dropdown the Otto composers built by hand, and a second
 * one inside the Tiptap canvas editor. That is the "两套实现" spec `docs/specs/frontend-baseline.md`
 * §7.3③ names, and both now render THIS component — the composers through `useReferencePicker`,
 * the canvas editor through its own caret anchor.
 *
 * Geometry, row anatomy, the `Browse by type` grid, the row cap and the empty state come from the
 * Founder-accepted fixture `design-system/patterns/reference-picker/ReferencePickerReference.tsx`
 * and the frozen contract `design-system/information-architecture/reference-picker-contract.md`.
 *
 * Purely presentational: it owns no query, no selection and no data source. `rows` IS the keyboard
 * index space, and `onSelect` hands the index back — so the menu never learns what a row means on
 * a given surface (a reference, an entity variant, a category).
 */

const TYPE_ICONS: Record<ReferenceType, ComponentType<{ className?: string }>> = {
  product: PackageIcon,
  character: UsersRoundIcon,
  "official-avatar": UserRoundIcon,
  location: MapPinIcon,
  clothes: ShirtIcon,
  generation: SparklesIcon,
  upload: UploadIcon,
  brandmark: StampIcon,
};

/** One navigable line. `kind` decides which half of the menu draws it. */
export interface ReferencePickerRow {
  /** Stable React key AND the row's identity to the parent. */
  key: string;
  kind: "reference" | "category";
  name: string;
  /** The disambiguation line under the name (contract §3). Categories have none. */
  source?: string | null;
  thumbUrl?: string | null;
  type?: ReferenceType | null;
  /** A small trailing tag — the canvas editor uses it for an entity's named variant. */
  badge?: string;
}

export interface ReferencePickerMenuProps {
  open: boolean;
  listId: string;
  rows: readonly ReferencePickerRow[];
  highlightedIndex: number;
  /** Menu heading — `Recent`, a category name, or `References` while searching. */
  title: string;
  subtitle?: string | null;
  /** Shown only inside a category; returns to the unfiltered menu (contract §2). */
  onClearCategory?: (() => void) | null;
  onHighlightChange: (index: number) => void;
  onSelect: (index: number) => void;
  onDismiss: () => void;
  /** The composer the menu anchors to. Omitted when `virtualRef` supplies the anchor instead. */
  children?: ReactElement;
  /** Anchor to a caret rectangle rather than to the whole composer (the Tiptap editor). */
  virtualRef?: { current: { getBoundingClientRect: () => DOMRect } };
}

function RowThumb({ row }: { row: ReferencePickerRow }) {
  const Icon = row.type ? TYPE_ICONS[row.type] : null;
  if (row.thumbUrl) {
    return (
      <span className="relative size-9 shrink-0 overflow-hidden rounded-[var(--radius)] border border-border bg-muted">
        {/* Reference thumbnails are storage URLs the server resolved; the Library renders them the
            same way (components/otto/stuff/StuffLibrary.tsx). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={row.thumbUrl} alt="" className="size-full object-cover" />
      </span>
    );
  }
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border bg-muted text-sm font-semibold text-muted-foreground">
      {Icon ? <Icon className="size-4" /> : row.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function ReferencePickerMenu({
  open,
  listId,
  rows,
  highlightedIndex,
  title,
  subtitle,
  onClearCategory,
  onHighlightChange,
  onSelect,
  onDismiss,
  children,
  virtualRef,
}: ReferencePickerMenuProps) {
  // Keep the highlighted row in view. `instant`, not smooth: a held arrow key animating its way
  // down a list is the highlight lagging behind the merchant's finger.
  useLayoutEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-option-${highlightedIndex}`)?.scrollIntoView?.({
      behavior: "instant" as ScrollBehavior,
      block: "nearest",
    });
  }, [highlightedIndex, listId, open]);

  const indexed = rows.map((row, index) => ({ row, index }));
  const references = indexed.filter(({ row }) => row.kind === "reference");
  const categories = indexed.filter(({ row }) => row.kind === "category");

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onDismiss();
      }}
    >
      {virtualRef ? <PopoverAnchor virtualRef={virtualRef} /> : <PopoverAnchor asChild>{children}</PopoverAnchor>}
      <PopoverContent
        id={listId}
        role="listbox"
        aria-label="References"
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        sticky="always"
        hideWhenDetached
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        motion="instant"
        className="w-[min(30rem,calc(100vw-1.5rem))] overflow-hidden p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{title}</p>
            {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          {onClearCategory ? (
            <Button
              motion="instant"
              size="sm"
              variant="ghost"
              onMouseDown={(event) => {
                event.preventDefault();
                onClearCategory();
              }}
            >
              <ChevronLeftIcon />
              All types
            </Button>
          ) : null}
        </div>

        {references.length > 0 ? (
          <div className="max-h-[352px] overflow-y-auto p-1">
            {references.map(({ row, index }) => {
              const Icon = row.type ? TYPE_ICONS[row.type] : null;
              return (
                <Button
                  key={row.key}
                  id={`${listId}-option-${index}`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  motion="instant"
                  role="option"
                  aria-selected={index === highlightedIndex}
                  data-highlighted={index === highlightedIndex ? "" : undefined}
                  onPointerMove={() => onHighlightChange(index)}
                  onMouseDown={(event) => {
                    // keep the caret in the composer — a blur here would lose the mention query
                    event.preventDefault();
                    onSelect(index);
                  }}
                  className={cn(
                    "h-auto w-full justify-start gap-3 rounded-[var(--radius)] px-2.5 py-2 text-left font-normal [&_svg]:size-4",
                    index === highlightedIndex && "bg-accent text-accent-foreground",
                  )}
                >
                  <RowThumb row={row} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.name}</span>
                    {row.source ? (
                      <span className="block truncate text-xs text-muted-foreground">{row.source}</span>
                    ) : null}
                  </span>
                  {row.badge ? (
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[0.6875rem] text-muted-foreground">
                      {row.badge}
                    </span>
                  ) : null}
                  {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
                </Button>
              );
            })}
          </div>
        ) : categories.length === 0 ? (
          /* Contract §7 — say there is nothing rather than showing an empty box, and leave one
             real way out. `Upload media` is in the fixture but has no handler to call from inside
             a composer menu, so it is not drawn (Founder rule: no control without a contract). */
          <div className="p-5 text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
              <ImageIcon className="size-4 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">No references found</p>
            <p className="mt-1 text-xs text-muted-foreground">Try another name or browse Library.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Link className={buttonVariants({ size: "sm" })} href="/library">
                Browse Library
              </Link>
            </div>
          </div>
        ) : null}

        {categories.length > 0 ? (
          <div className={cn("p-1", references.length > 0 && "border-t border-border")}>
            <p className="px-2.5 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Browse by type
            </p>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {categories.map(({ row, index }) => {
                const Icon = row.type ? TYPE_ICONS[row.type] : ImagesIcon;
                return (
                  <Button
                    key={row.key}
                    id={`${listId}-option-${index}`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    motion="instant"
                    role="option"
                    aria-selected={index === highlightedIndex}
                    onPointerMove={() => onHighlightChange(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onSelect(index);
                    }}
                    className={cn(
                      "w-full justify-start gap-2 rounded-[var(--radius)] px-2.5 py-2 text-left text-xs font-medium",
                      index === highlightedIndex && "bg-accent text-accent-foreground",
                    )}
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    <span className="truncate">{row.name}</span>
                    <ChevronRightIcon className="ml-auto size-3.5 text-muted-foreground" />
                  </Button>
                );
              })}
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
