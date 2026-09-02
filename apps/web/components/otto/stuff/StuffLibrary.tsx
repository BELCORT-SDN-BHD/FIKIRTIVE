"use client";
import React, { useMemo, useState } from "react";
import { ImagePlus, MoreHorizontal, Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Spinner } from "@/components/ui/spinner";
import { OttoRenameDialog } from "@/components/otto/OttoPromptDialog";
import { ChangeEntityTypeDialog } from "./ChangeEntityTypeDialog";
import { ExitLink } from "@/components/exits/Exits";
import type { EntityTypeDTO } from "@/lib/types";
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

function itemTypeLabel(item: StuffItem): string {
  return tagFor(item) ?? (item.mediaKind === "image" ? "Image" : "Asset");
}

function itemOriginLabel(item: StuffItem): string {
  if (item.productName) return `Used by ${item.productName}`;
  if (item.source === "entity") return "Reusable asset";
  if (item.source === "ad") return "Ad creative";
  return "Made with Otto";
}

export function StuffLibrary({
  items,
  mode,
  onPick,
  pickPending = false,
  onRename,
  onChangeType,
  onDelete,
  onSetProductImage,
  onOpenGeneration,
  onOpenEntity,
  onAdd,
}: {
  items: StuffItem[];
  mode: "library" | "picker";
  onPick?: (assetId: string) => void;
  pickPending?: boolean;
  onRename?: (
    entityId: string,
    name: string,
  ) => void | string | null | Promise<void | string | null>;
  /** beta bug 4 — correct a saved element's kind (a bottle saved as a person). Resolves to an
   *  error message for the dialog to show, or null on success: the action refuses the change while
   *  a generation using this element is still running, and that refusal has to be readable. */
  onChangeType?: (entityId: string, type: EntityTypeDTO) => Promise<string | null>;
  onDelete?: (entityId: string) => void | string | null | Promise<void | string | null>;
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
  // beta bug 4 — which element's kind the merchant is correcting.
  const [typeTarget, setTypeTarget] = useState<StuffItem | null>(null);
  // #934 — a click here used to delete immediately. Route it through a confirmation
  // instead, so an accidental click can't take an item out of Library unnoticed.
  const [deleteTarget, setDeleteTarget] = useState<StuffItem | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteSubmittingRef = React.useRef(false);

  async function removeTarget() {
    if (!deleteTarget?.entityId || deleteSubmittingRef.current) return;
    deleteSubmittingRef.current = true;
    setDeletePending(true);
    setDeleteError(null);
    try {
      const failure = await onDelete?.(deleteTarget.entityId);
      if (typeof failure === "string" && failure) {
        setDeleteError(failure);
        return;
      }
      setDeleteTarget(null);
    } catch {
      setDeleteError("The item couldn't be removed. Check your connection and try again.");
    } finally {
      deleteSubmittingRef.current = false;
      setDeletePending(false);
    }
  }

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

  const grid = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-4";
  const searching = search.trim() !== "";

  if (mode === "picker") {
    return (
      <div className="flex flex-col gap-3">
        <InputGroup className="min-h-9 max-w-[320px] shadow-none">
          <InputGroupAddon className="pl-2.5">
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search images…"
            aria-label="Search images"
          />
        </InputGroup>
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
                aria-label={`Choose ${item.label}`}
                disabled={pickPending}
                onClick={() => item.assetId && onPick?.(item.assetId)}
                className="group relative h-auto w-full flex-col items-stretch justify-start gap-0 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card p-0 text-left shadow-none hover:border-foreground/25 hover:bg-card hover:text-foreground"
              >
                <div className="relative aspect-square bg-muted">
                  <Thumb item={item} />
                  <Badge
                    variant="outline"
                    className="absolute left-2.5 top-2.5 bg-card/90 font-medium text-muted-foreground backdrop-blur-sm"
                  >
                    {itemTypeLabel(item)}
                  </Badge>
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
      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-card p-2 shadow-[var(--shadow-xs)] lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full overflow-x-auto pb-0.5 lg:w-auto">
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value as StuffFilter);
            }}
            variant="default"
            size="sm"
            spacing={1}
            aria-label="Filter library"
          >
            {FILTERS.map((f) => (
              <ToggleGroupItem
                key={f.value}
                value={f.value}
                aria-label={`${f.label}, ${counts[f.value]} items`}
              >
                {f.label}
                <span className="font-mono text-[0.6875rem] font-normal tabular-nums text-muted-foreground/80">
                  {counts[f.value]}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <InputGroup className="min-h-9 w-full shadow-none lg:max-w-[280px]">
          <InputGroupAddon className="pl-2.5">
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search library…"
            aria-label="Search library"
          />
        </InputGroup>
      </div>

      {filtered.length === 0 ? (
        // #701 — three different facts, three different sentences. A search that found
        // nothing is not an empty library, and "go to Brand memory" is a link, not directions.
        searching ? (
          <Empty className="min-h-56 border border-dashed border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No results</EmptyTitle>
              <EmptyDescription>{noMatchesMessage(search)}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSearch("")}
              >
                Clear search
              </Button>
            </EmptyContent>
          </Empty>
        ) : filter === "products" ? (
          <Empty className="min-h-56 border border-dashed border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ImagePlus aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No product assets yet</EmptyTitle>
              <EmptyDescription>
                Add product knowledge in{" "}
                <ExitLink href={BRAND_MEMORY_HREF}>Brand memory</ExitLink>, then link images here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : items.length === 0 && onAdd ? (
          // #942 — the onboarding tile's "Add a character or product" lands here when the shop
          // has nothing saved yet. It used to say "Nothing here yet." and stop there, a dead
          // end with no next step. Point straight at the same upload dialog the header's Add
          // button opens, instead of building a second upload path.
          <Empty className="min-h-64 border border-dashed border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ImagePlus aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Build your reusable asset library</EmptyTitle>
              <EmptyDescription>
                Add your first character or product photo. Otto keeps it consistent across every
                project.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" size="sm" onClick={onAdd}>
                <Plus aria-hidden />
                Add to Library
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Empty className="min-h-56 border border-dashed border-border">
            <EmptyHeader>
              <EmptyTitle>Nothing here yet.</EmptyTitle>
              <EmptyDescription>Items in this category will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      ) : (
        <>
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
              const hasPrimaryActions =
                (canSetProduct && !!onSetProductImage) ||
                (isEntity &&
                  (!!onRename || (!!item.entityType && !!onChangeType)));
              const hasActions = hasPrimaryActions || (isEntity && !!onDelete);
              const openItem = () => {
                if (canOpenGeneration) {
                  onOpenGeneration?.(item.generationId!, item.projectId!);
                } else if (canOpenEntityTile) {
                  onOpenEntity?.(item.entityId!);
                }
              };
              return (
                <div
                  key={item.id}
                  className="group relative min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card p-1 shadow-[var(--shadow-xs)] transition-[border-color,box-shadow,transform] duration-[var(--dur-1)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[var(--shadow-md)] focus-within:border-foreground/30"
                >
                  <div className="relative aspect-[4/3] overflow-hidden rounded-[calc(var(--radius-card)-0.25rem)] bg-muted">
                    {canOpen ? (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Open ${item.label}`}
                        onClick={openItem}
                        className="absolute inset-0 h-full w-full rounded-none border-0 bg-transparent p-0 text-left hover:bg-transparent"
                      >
                        <Thumb item={item} />
                      </Button>
                    ) : (
                      <Thumb item={item} />
                    )}

                    <Badge
                      variant="outline"
                      className="pointer-events-none absolute left-2.5 top-2.5 bg-card/90 font-medium text-muted-foreground backdrop-blur-sm"
                    >
                      {itemTypeLabel(item)}
                    </Badge>

                    {hasActions && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="secondary"
                            className="absolute right-2.5 top-2.5 bg-card/90 backdrop-blur-sm"
                            aria-label={`Actions for ${item.label}`}
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {hasPrimaryActions && (
                            <DropdownMenuGroup>
                              {canSetProduct && onSetProductImage && (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    if (item.assetId) onSetProductImage(item.assetId);
                                  }}
                                >
                                  <ImagePlus aria-hidden />
                                  Set as product image
                                </DropdownMenuItem>
                              )}
                              {isEntity && onRename && (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setRenameTarget(item);
                                  }}
                                >
                                  <Pencil aria-hidden />
                                  Rename
                                </DropdownMenuItem>
                              )}
                              {isEntity && item.entityType && onChangeType && (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setTypeTarget(item);
                                  }}
                                >
                                  <Tags aria-hidden />
                                  Change type
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuGroup>
                          )}
                          {isEntity && onDelete && (
                            <>
                              {hasPrimaryActions && <DropdownMenuSeparator />}
                              <DropdownMenuGroup>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => {
                                    setDeleteError(null);
                                    setDeleteTarget(item);
                                  }}
                                >
                                  <Trash2 aria-hidden />
                                  Remove from Library
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <div className="min-w-0 px-2.5 pb-2 pt-2.5">
                    {canOpen ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={openItem}
                        className="h-auto w-full min-w-0 justify-start truncate rounded-none bg-transparent p-0 text-left text-[0.875rem] font-semibold text-foreground hover:bg-transparent"
                      >
                        {item.label}
                      </Button>
                    ) : (
                      <div className="truncate text-[0.875rem] font-semibold text-foreground">
                        {item.label}
                      </div>
                    )}
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {itemOriginLabel(item)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      <OttoRenameDialog
        open={!!renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        title="Rename item"
        description="This changes the label you see in Library. It does not edit the original media."
        label="Item name"
        initialValue={renameTarget?.label ?? ""}
        onSubmit={async (name) => {
          if (!renameTarget?.entityId) return null;
          return (await onRename?.(renameTarget.entityId, name)) ?? null;
        }}
      />
      <ChangeEntityTypeDialog
        open={!!typeTarget}
        onOpenChange={(open) => {
          if (!open) setTypeTarget(null);
        }}
        itemLabel={typeTarget?.label ?? ""}
        currentType={typeTarget?.entityType ?? "PRODUCT"}
        onSubmit={async (type) => {
          if (!typeTarget?.entityId) return null;
          return (await onChangeType?.(typeTarget.entityId, type)) ?? null;
        }}
      />
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(next) => {
          if (!next && !deletePending) {
            setDeleteError(null);
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from library?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `This moves "${deleteTarget.label}" out of Library. It won't show up in projects, pickers, or search anymore.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <Alert role="alert" variant="destructive" density="compact">
              <AlertTitle>Item wasn&apos;t removed</AlertTitle>
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletePending || !deleteTarget?.entityId}
              onClick={(event) => {
                event.preventDefault();
                void removeTarget();
              }}
            >
              {deletePending && <Spinner data-icon="inline-start" aria-label="Removing item" />}
              {deletePending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
