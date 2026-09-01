"use client"

import Image from "next/image"
import Link from "next/link"
import * as React from "react"
import {
  ArrowDownUp,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Download,
  Film,
  FolderPlus,
  Heart,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react"

import { SHELL_ROUTES } from "@fikirtive/core/navigation"
import { ProductPatternShellFrame } from "@/design-system/patterns/application-shell/ProductPatternShellFrame"
import { OttoPanelFlowReference } from "@/components/otto/panel/OttoPanelFlowReference"
import { REVIEW_ACCOUNT } from "@/design-system/patterns/application-shell/review-account"
import {
  CANVAS_REVIEW_HREF,
} from "@/design-system/patterns/canvas/review-links"
import { Button, buttonVariants } from "@/design-system/primitives/button"
import { Checkbox } from "@/design-system/primitives/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/design-system/primitives/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/design-system/primitives/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/design-system/primitives/input-group"
import { Input } from "@/design-system/primitives/input"
import { Tabs, TabsList, TabsTrigger } from "@/design-system/primitives/tabs"
import { toast } from "@/design-system/primitives/toast"
import { ToggleGroup, ToggleGroupItem } from "@/design-system/primitives/toggle-group"
import { cn } from "@/lib/utils"

import {
  LIBRARY_ASSETS,
  LIBRARY_COLLECTIONS,
  LIBRARY_ELEMENT_FIXTURES,
} from "./fixtures"
import {
  filterAndSortLibraryAssets,
  type LibraryDateFilter as DateFilter,
  type LibrarySortOrder as SortOrder,
} from "./filtering"
import {
  ELEMENT_VIEWS,
  LIBRARY_VIEWS,
  type LibraryAsset,
  type LibraryMediaType,
  type LibrarySource,
  type LibraryView,
} from "./model"
import { OfficialAvatarFavorites, OfficialAvatarsView } from "./OfficialAvatarsView"

type MediaFilter = "all" | LibraryMediaType

const TIME_GROUPS = ["Today", "Yesterday", "Earlier this month"] as const
const DATE_LABELS: Record<DateFilter, string> = {
  all: "Any time",
  today: "Today",
  week: "Last 7 days",
}
const SORT_LABELS: Record<SortOrder, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
}

function updateAssetRoute(assetId?: string, mode: "push" | "replace" = "push") {
  const url = new URL(window.location.href)
  if (assetId) url.searchParams.set("asset", assetId)
  else url.searchParams.delete("asset")
  window.history[mode === "push" ? "pushState" : "replaceState"](window.history.state, "", url)
}

function updateLibraryViewRoute(view: LibraryView) {
  const url = new URL(window.location.href)
  if (view === "history") url.searchParams.delete("view")
  else url.searchParams.set("view", view)
  url.searchParams.delete("asset")
  if (view !== "elements") {
    url.searchParams.delete("element")
    url.searchParams.delete("avatar")
  }
  window.history.pushState(window.history.state, "", url)
}

function FilterButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button {...props} variant="outline" size="sm" className="gap-1.5 bg-card font-medium shadow-none">
      {children}
      <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
    </Button>
  )
}

function LibraryToolbar({
  query,
  onQueryChange,
  mediaFilter,
  onMediaFilterChange,
  canvasFilter,
  onCanvasFilterChange,
  chatFilter,
  onChatFilterChange,
  dateFilter,
  onDateFilterChange,
  sourceFilters,
  onSourceFilterChange,
  sortOrder,
  onSortOrderChange,
  onClearFilters,
  selectionMode,
  onSelectionModeChange,
}: {
  query: string
  onQueryChange: (query: string) => void
  mediaFilter: MediaFilter
  onMediaFilterChange: (filter: MediaFilter) => void
  canvasFilter: string
  onCanvasFilterChange: (canvas: string) => void
  chatFilter: string
  onChatFilterChange: (chat: string) => void
  dateFilter: DateFilter
  onDateFilterChange: (date: DateFilter) => void
  sourceFilters: ReadonlySet<LibrarySource>
  onSourceFilterChange: (source: LibrarySource, checked: boolean) => void
  sortOrder: SortOrder
  onSortOrderChange: (sort: SortOrder) => void
  onClearFilters: () => void
  selectionMode: boolean
  onSelectionModeChange: (selectionMode: boolean) => void
}) {
  const effectiveSourceFilters = sourceFilters ?? new Set<LibrarySource>(["Generated", "Upload"])
  const sourceFilterCount = effectiveSourceFilters.size === 2 ? 0 : 2 - effectiveSourceFilters.size

  return (
    <div data-library-toolbar className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
      <InputGroup className="min-h-9 min-w-52 flex-1 max-w-80 bg-background shadow-none">
        <InputGroupAddon>
          <Search aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search Library"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search generations, prompts or Canvas"
          className="h-9 text-sm"
        />
      </InputGroup>

      <ToggleGroup
        type="single"
        value={mediaFilter}
        onValueChange={(value) => { if (value) onMediaFilterChange(value as MediaFilter) }}
        variant="default"
        size="sm"
        className="rounded-lg bg-muted p-0.5"
      >
        {(["all", "image", "video"] as const).map((filter) => (
          <ToggleGroupItem
            key={filter}
            value={filter}
            className={cn(
              "h-8 rounded-[8px] px-3 text-xs capitalize text-muted-foreground shadow-none",
              "data-pressed:bg-card data-pressed:text-foreground data-pressed:shadow-xs",
            )}
          >
            {filter === "all" ? "All" : `${filter}s`}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <DropdownMenu>
        <DropdownMenuTrigger render={<FilterButton>{canvasFilter === "all" ? "Canvas" : canvasFilter}</FilterButton>} />
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={canvasFilter} onValueChange={onCanvasFilterChange}>
            <DropdownMenuLabel>Source Canvas</DropdownMenuLabel>
            <DropdownMenuRadioItem value="all">All canvases</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="Hari Raya gifting">Hari Raya gifting</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="Weekend tea launch">Weekend tea launch</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="New arrivals">New arrivals</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger render={<FilterButton>{chatFilter === "all" ? "Chat" : chatFilter}</FilterButton>} />
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={chatFilter} onValueChange={onChatFilterChange}>
            <DropdownMenuLabel>Conversation</DropdownMenuLabel>
            <DropdownMenuRadioItem value="all">Any conversation</DropdownMenuRadioItem>
            {[...new Set(LIBRARY_ASSETS.map((asset) => asset.chat))].map((chat) => (
              <DropdownMenuRadioItem key={chat} value={chat}>{chat}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger render={<FilterButton><CalendarDays aria-hidden />{DATE_LABELS[dateFilter]}</FilterButton>} />
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={dateFilter} onValueChange={(value) => onDateFilterChange(value as DateFilter)}>
            <DropdownMenuLabel>Date created</DropdownMenuLabel>
            <DropdownMenuRadioItem value="all">Any time</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="today">Today</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="week">Last 7 days</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger render={<FilterButton><SlidersHorizontal aria-hidden />More filters{sourceFilterCount ? ` · ${sourceFilterCount}` : ""}</FilterButton>} />
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Source</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={effectiveSourceFilters.has("Generated")}
              onCheckedChange={(checked) => onSourceFilterChange("Generated", checked)}
            >Generated</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={effectiveSourceFilters.has("Upload")}
              onCheckedChange={(checked) => onSourceFilterChange("Upload", checked)}
            >Uploads</DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onClearFilters}>Clear filters</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger render={<FilterButton><ArrowDownUp aria-hidden />{SORT_LABELS[sortOrder]}</FilterButton>} />
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup value={sortOrder} onValueChange={(value) => onSortOrderChange(value as SortOrder)}>
            <DropdownMenuLabel>Sort</DropdownMenuLabel>
            {(Object.entries(SORT_LABELS) as [SortOrder, string][]).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>{label}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant={selectionMode ? "secondary" : "ghost"}
        size="sm"
        className="ml-auto"
        onClick={() => onSelectionModeChange(!selectionMode)}
      >
        {selectionMode ? "Done" : "Select"}
      </Button>
    </div>
  )
}

function MediaTile({
  asset,
  selected,
  selectionMode,
  checked,
  onOpen,
  onCheckedChange,
}: {
  asset: LibraryAsset
  selected: boolean
  selectionMode: boolean
  checked: boolean
  onOpen: () => void
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="relative mb-2 break-inside-avoid">
      {selectionMode ? (
        <div className="absolute top-2 left-2 z-10 rounded-md bg-background/90 p-1 shadow-sm backdrop-blur-sm">
          <Checkbox
            aria-label={`Select ${asset.title}`}
            checked={checked}
            onCheckedChange={onCheckedChange}
          />
        </div>
      ) : null}
      <Button
        variant="ghost"
        aria-label={`Open ${asset.title}`}
        aria-selected={selected}
        onClick={selectionMode ? () => onCheckedChange(!checked) : onOpen}
        className={cn(
          "group relative h-auto w-full overflow-hidden rounded-lg border border-border bg-muted p-0 shadow-none",
          "hover:border-foreground/25 hover:bg-muted focus-visible:ring-offset-2",
          selected && "border-foreground ring-1 ring-ring/20",
          checked && "border-foreground ring-1 ring-foreground/20",
        )}
      >
        <Image
          src={asset.src}
          alt={asset.alt}
          width={asset.mediaType === "video" ? 760 : 640}
          height={asset.mediaType === "video" ? 860 : 800}
          className={cn(
            "h-auto w-full object-cover transition-transform duration-[var(--dur-3)] ease-[var(--ease-out)] group-hover:scale-[1.015] motion-reduce:transition-none",
            asset.id === "storefront-evening" || asset.id === "storefront-reference" ? "aspect-[4/3]" : "aspect-[4/5]",
          )}
          loading={selected ? "eager" : "lazy"}
          sizes="(max-width: 1200px) 22vw, 190px"
        />
        {asset.mediaType === "video" ? (
          <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-foreground/80 px-1.5 py-1 text-xs font-medium text-background backdrop-blur-sm">
            <Film className="size-3" aria-hidden />
            {asset.duration}
          </span>
        ) : null}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-foreground/60 to-transparent px-2.5 pt-8 pb-2 text-left text-xs font-medium text-background opacity-0 transition-opacity duration-[var(--dur-2)] group-hover:opacity-100 group-focus-visible:opacity-100">
          {asset.title}
        </span>
      </Button>
    </div>
  )
}

function MediaGrid({
  assets,
  selectedAssetId,
  selectionMode,
  selectedIds,
  onOpen,
  onSelect,
  sortOrder,
  onClearFilters,
}: {
  assets: readonly LibraryAsset[]
  selectedAssetId?: string
  selectionMode: boolean
  selectedIds: ReadonlySet<string>
  onOpen: (asset: LibraryAsset) => void
  onSelect: (assetId: string, checked: boolean) => void
  sortOrder: SortOrder
  onClearFilters: () => void
}) {
  if (!assets.length) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center text-center">
        <Search className="size-6 text-muted-foreground" aria-hidden />
        <h2 className="mt-4 text-sm font-semibold">Nothing matches these filters</h2>
        <p className="mt-1 text-xs text-muted-foreground">Try another search or clear a filter.</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={onClearFilters}>Clear filters</Button>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      {(sortOrder === "oldest" ? [...TIME_GROUPS].reverse() : TIME_GROUPS).map((group) => {
        const groupAssets = assets.filter((asset) => asset.group === group)
        if (!groupAssets.length) return null
        return (
          <section key={group} aria-labelledby={`library-${group.replaceAll(" ", "-").toLowerCase()}`}>
            <div className="mb-3 flex items-center gap-2">
              <h2 id={`library-${group.replaceAll(" ", "-").toLowerCase()}`} className="text-sm font-semibold">{group}</h2>
              <span className="text-xs text-muted-foreground">{groupAssets.length}</span>
            </div>
            <div className="[column-count:5] [column-gap:0.5rem]">
              {groupAssets.map((asset) => (
                <MediaTile
                  key={asset.id}
                  asset={asset}
                  selected={asset.id === selectedAssetId}
                  selectionMode={selectionMode}
                  checked={selectedIds.has(asset.id)}
                  onOpen={() => onOpen(asset)}
                  onCheckedChange={(checked) => onSelect(asset.id, checked)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function DetailPanel({
  asset,
  favorite,
  onFavoriteChange,
  onAddToCollection,
  onClose,
}: {
  asset: LibraryAsset
  favorite: boolean
  onFavoriteChange: () => void
  onAddToCollection: () => void
  onClose: () => void
}) {
  return (
    <aside aria-label={`${asset.title} details`} className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-border bg-background">
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">Media details</p>
        <Button variant="ghost" size="icon-xs" aria-label="Close media details" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      <div className="space-y-5 p-4">
        <div className="overflow-hidden rounded-lg border border-border bg-muted">
          <Image src={asset.src} alt={asset.alt} width={720} height={900} className="max-h-[300px] w-full object-contain" loading="eager" sizes="360px" />
        </div>

        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em]">{asset.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{asset.mediaType === "video" ? "Video" : "Image"} · {asset.dimensions}</p>
        </div>

        <Link
          href={`${CANVAS_REVIEW_HREF}?context=${encodeURIComponent(asset.title)}`}
          className={cn(buttonVariants(), "w-full")}
        >
            <Sparkles aria-hidden />
            Use in Canvas
        </Link>

        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" size="xs" onClick={onFavoriteChange} aria-pressed={favorite} className="min-w-0 gap-1 px-2 text-xs">
            <Heart className={cn(favorite && "fill-current")} aria-hidden />
            <span className="truncate">Favorite</span>
          </Button>
          <Button variant="secondary" size="xs" onClick={onAddToCollection} className="min-w-0 gap-1 px-2 text-xs">
            <FolderPlus aria-hidden />
            <span className="truncate">Collect</span>
          </Button>
          <Button
            variant="secondary"
            size="xs"
            nativeButton={false}
            render={<a href={asset.src} download={`${asset.id}.${asset.mediaType === "video" ? "mp4" : "png"}`} />}
            className="min-w-0 gap-1 px-2 text-xs"
          >
            <Download aria-hidden />
            <span className="truncate">Download</span>
          </Button>
        </div>

        <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-border pt-4 text-xs">
          <dt className="text-muted-foreground">Source</dt><dd>{asset.source}</dd>
          <dt className="text-muted-foreground">Canvas</dt><dd>{asset.canvas}</dd>
          <dt className="text-muted-foreground">Chat</dt><dd>{asset.chat}</dd>
          <dt className="text-muted-foreground">Created</dt><dd>{asset.createdAt}</dd>
          {asset.duration ? <><dt className="text-muted-foreground">Duration</dt><dd>{asset.duration}</dd></> : null}
        </dl>

        <section className="border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Prompt</h3>
          <p className="mt-2 text-sm leading-6">{asset.prompt}</p>
        </section>

        <section className="border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">References used</h3>
          <div className="mt-3 flex gap-2">
            {asset.references.map((reference, index) => (
              <div key={`${reference}-${index}`} className="size-14 overflow-hidden rounded-lg border border-border bg-muted">
                <Image src={reference} alt="Creation reference" width={56} height={56} className="size-full object-cover" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  )
}

type CollectionRecord = {
  id: string
  name: string
  updated: string
  cover: string
  assetIds: string[]
}

function CollectionView({
  collections,
  activeCollectionId,
  onOpenCollection,
  onBack,
  onOpenAsset,
}: {
  collections: readonly CollectionRecord[]
  activeCollectionId?: string
  onOpenCollection: (collectionId: string) => void
  onBack: () => void
  onOpenAsset: (asset: LibraryAsset) => void
}) {
  const activeCollection = collections.find((collection) => collection.id === activeCollectionId)

  if (activeCollection) {
    const assets = activeCollection.assetIds
      .map((assetId) => LIBRARY_ASSETS.find((asset) => asset.id === assetId))
      .filter((asset): asset is LibraryAsset => Boolean(asset))

    return (
      <div>
        <div className="mb-5 flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" aria-label="Back to collections" onClick={onBack}><ArrowLeft aria-hidden /></Button>
          <div>
            <h2 className="text-base font-semibold">{activeCollection.name}</h2>
            <p className="text-xs text-muted-foreground">{assets.length} items · {activeCollection.updated}</p>
          </div>
        </div>
        {assets.length ? (
          <div className="grid grid-cols-5 gap-2">
            {assets.map((asset) => (
              <MediaTile
                key={asset.id}
                asset={asset}
                selected={false}
                selectionMode={false}
                checked={false}
                onOpen={() => onOpenAsset(asset)}
                onCheckedChange={() => undefined}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center text-center">
            <FolderPlus className="size-6 text-muted-foreground" aria-hidden />
            <h3 className="mt-4 text-sm font-semibold">This collection is empty</h3>
            <p className="mt-1 text-xs text-muted-foreground">Add media from Generation history or Uploads.</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {collections.map((collection) => (
        <Button
          key={collection.id}
          variant="ghost"
          onClick={() => onOpenCollection(collection.id)}
          className="h-auto min-w-0 items-stretch justify-start overflow-hidden rounded-[var(--radius-card)] border border-border bg-card p-0 text-left shadow-none hover:bg-card"
        >
          <span className="relative aspect-[4/3] w-32 shrink-0 overflow-hidden bg-muted">
            <Image src={collection.cover} alt="" fill className="object-cover" sizes="128px" />
          </span>
          <span className="min-w-0 p-4">
            <span className="block truncate text-sm font-semibold">{collection.name}</span>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{collection.assetIds.length} items · {collection.updated}</span>
          </span>
        </Button>
      ))}
    </div>
  )
}

function ElementsView({
  elementView,
  selectedAvatarId,
  favoriteAvatarIds,
  onElementViewChange,
  onSelectAvatar,
  onCloseAvatar,
  onToggleFavoriteAvatar,
}: {
  elementView: (typeof ELEMENT_VIEWS)[number]
  selectedAvatarId?: string
  favoriteAvatarIds: ReadonlySet<string>
  onElementViewChange: (view: (typeof ELEMENT_VIEWS)[number]) => void
  onSelectAvatar: (avatarId: string) => void
  onCloseAvatar: () => void
  onToggleFavoriteAvatar: (avatarId: string) => void
}) {
  const [selectedElement, setSelectedElement] = React.useState<(typeof LIBRARY_ELEMENT_FIXTURES)[number]>()
  const [favoriteElements, setFavoriteElements] = React.useState<Set<string>>(new Set())
  const visible = LIBRARY_ELEMENT_FIXTURES.filter((item) => item.type === elementView)

  function changeElementView(nextView: (typeof ELEMENT_VIEWS)[number]) {
    setSelectedElement(undefined)
    onElementViewChange(nextView)
  }

  return (
    <div>
      <Tabs value={elementView} onValueChange={(value) => changeElementView(value as (typeof ELEMENT_VIEWS)[number])}>
        <TabsList className="rounded-none border-b border-border bg-transparent p-0">
          {ELEMENT_VIEWS.map((view) => (
            <TabsTrigger key={view} value={view} className="rounded-none border-b-2 border-transparent px-3 py-2 shadow-none data-active:border-foreground data-active:bg-transparent data-active:shadow-none">
              {view}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {elementView === "Official avatars" ? (
        <div className="mt-5">
          <OfficialAvatarsView
            selectedAvatarId={selectedAvatarId}
            favoriteAvatarIds={favoriteAvatarIds}
            onSelectAvatar={onSelectAvatar}
            onCloseAvatar={onCloseAvatar}
            onToggleFavorite={onToggleFavoriteAvatar}
          />
        </div>
      ) : null}
      {elementView !== "Official avatars" ? (
      <div className="mt-5 grid grid-cols-4 gap-4">
        {visible.map((item) => (
          <Button
            key={item.name}
            variant="ghost"
            onClick={() => setSelectedElement(item)}
            className="h-auto min-w-0 flex-col items-stretch justify-start overflow-hidden rounded-[var(--radius-card)] border border-border bg-card p-0 text-left shadow-none hover:bg-card"
          >
            <span className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
              <Image src={item.cover} alt="" fill className="object-cover" sizes="220px" />
            </span>
            <span className="p-3">
              <span className="block truncate text-sm font-semibold">{item.name}</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">{item.meta}</span>
            </span>
          </Button>
        ))}
      </div>
      ) : null}

      <Dialog open={Boolean(selectedElement)} onOpenChange={(open) => { if (!open) setSelectedElement(undefined) }}>
        <DialogContent>
          {selectedElement ? (
            <>
              <DialogHeader>
                <DialogTitle>{selectedElement.name}</DialogTitle>
                <DialogDescription>{selectedElement.type} · {selectedElement.meta}</DialogDescription>
              </DialogHeader>
              <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-muted">
                <Image src={selectedElement.cover} alt={selectedElement.name} width={720} height={540} className="aspect-[4/3] w-full object-cover" />
              </div>
              <DialogFooter>
                <Button
                  variant="secondary"
                  aria-pressed={favoriteElements.has(selectedElement.name)}
                  onClick={() => setFavoriteElements((current) => {
                    const next = new Set(current)
                    if (next.has(selectedElement.name)) next.delete(selectedElement.name)
                    else next.add(selectedElement.name)
                    return next
                  })}
                >
                  <Heart className={cn(favoriteElements.has(selectedElement.name) && "fill-current")} aria-hidden />
                  Favorite
                </Button>
                <Button nativeButton={false} render={<Link href={`${CANVAS_REVIEW_HREF}?context=${encodeURIComponent(selectedElement.name)}`} />}>
                  <Sparkles aria-hidden />
                  Use in Canvas
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SelectionBar({
  count,
  onCollect,
  onFavorite,
  onDownload,
  onDone,
}: {
  count: number
  onCollect: () => void
  onFavorite: () => void
  onDownload: () => void
  onDone: () => void
}) {
  return (
    <div className="sticky bottom-4 z-20 mx-auto flex w-fit items-center gap-2 rounded-[var(--radius-card)] border border-border bg-popover p-2 shadow-[var(--shadow-lg)]">
      <span className="px-2 text-sm font-semibold">{count} selected</span>
      <Button size="sm" onClick={onCollect}><FolderPlus aria-hidden />Add to collection</Button>
      <Button variant="secondary" size="sm" onClick={onFavorite}><Heart aria-hidden />Favorite</Button>
      <Button variant="secondary" size="sm" onClick={onDownload}><Download aria-hidden />Download</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Exit selection" onClick={onDone}><X aria-hidden /></Button>
    </div>
  )
}

export function LibraryReference({
  initialAssetId,
  initialView = "history",
  initialElementView = "Products",
  initialAvatarId,
}: {
  initialAssetId?: string
  initialView?: LibraryView
  initialElementView?: (typeof ELEMENT_VIEWS)[number]
  initialAvatarId?: string
}) {
  const [view, setView] = React.useState<LibraryView>(initialView)
  const [elementView, setElementView] = React.useState<(typeof ELEMENT_VIEWS)[number]>(initialElementView)
  const [selectedAvatarId, setSelectedAvatarId] = React.useState<string | undefined>(initialAvatarId)
  const [query, setQuery] = React.useState("")
  const [mediaFilter, setMediaFilter] = React.useState<MediaFilter>("all")
  const [canvasFilter, setCanvasFilter] = React.useState("all")
  const [chatFilter, setChatFilter] = React.useState("all")
  const [dateFilter, setDateFilter] = React.useState<DateFilter>("all")
  const [sourceFilters, setSourceFilters] = React.useState<Set<LibrarySource>>(new Set(["Generated", "Upload"]))
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("newest")
  const [selectionMode, setSelectionMode] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [selectedAssetId, setSelectedAssetId] = React.useState<string | undefined>(
    initialAssetId ?? (initialView === "history" ? LIBRARY_ASSETS[0]?.id : undefined),
  )
  const [favorites, setFavorites] = React.useState<Set<string>>(new Set(["gift-box-hero", "jasmine-product"]))
  const [favoriteAvatarIds, setFavoriteAvatarIds] = React.useState<Set<string>>(new Set())
  const [collectionDialogOpen, setCollectionDialogOpen] = React.useState(false)
  const [newCollectionDialogOpen, setNewCollectionDialogOpen] = React.useState(false)
  const [newCollectionName, setNewCollectionName] = React.useState("")
  const [uploadDialogOpen, setUploadDialogOpen] = React.useState(false)
  const [uploadFileNames, setUploadFileNames] = React.useState<string[]>([])
  const [pendingCollectionAssetIds, setPendingCollectionAssetIds] = React.useState<string[]>([])
  const [activeCollectionId, setActiveCollectionId] = React.useState<string>()
  const [collections, setCollections] = React.useState<CollectionRecord[]>(() => LIBRARY_COLLECTIONS.map((collection) => ({
    id: collection.id,
    name: collection.name,
    updated: collection.updated,
    cover: collection.cover,
    assetIds: [...collection.assetIds],
  })))
  const [visibleLimit, setVisibleLimit] = React.useState(10)

  React.useEffect(() => {
    if (!initialAssetId && selectedAssetId && (view === "history" || view === "uploads" || view === "favorites")) {
      updateAssetRoute(selectedAssetId, "replace")
    }
  }, [initialAssetId, selectedAssetId, view])

  React.useEffect(() => {
    function syncLibraryFromRoute() {
      const url = new URL(window.location.href)
      const routeView = url.searchParams.get("view")
      const nextView = LIBRARY_VIEWS.some((item) => item.value === routeView) ? routeView as LibraryView : "history"
      const elementSlug = url.searchParams.get("element")
      const nextElementView = ELEMENT_VIEWS.find((item) => item.toLowerCase().replaceAll(" ", "-") === elementSlug) ?? "Products"
      setView(nextView)
      setElementView(nextElementView)
      setSelectedAssetId(url.searchParams.get("asset") ?? undefined)
      setSelectedAvatarId(url.searchParams.get("avatar") ?? undefined)
    }
    window.addEventListener("popstate", syncLibraryFromRoute)
    return () => window.removeEventListener("popstate", syncLibraryFromRoute)
  }, [])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && selectionMode) {
        setSelectionMode(false)
        setSelectedIds(new Set())
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectionMode])

  const selectedAsset = LIBRARY_ASSETS.find((asset) => asset.id === selectedAssetId)
  const searchedAssets = filterAndSortLibraryAssets({
    assets: LIBRARY_ASSETS,
    view,
    favorites,
    query,
    mediaFilter,
    canvasFilter,
    chatFilter,
    dateFilter,
    sourceFilters,
    sortOrder,
  })
  const visibleAssets = searchedAssets.slice(0, visibleLimit)

  function clearFilters() {
    setQuery("")
    setMediaFilter("all")
    setCanvasFilter("all")
    setChatFilter("all")
    setDateFilter("all")
    setSourceFilters(new Set<LibrarySource>(["Generated", "Upload"]))
    setSortOrder("newest")
    setVisibleLimit(10)
  }

  function updateSourceFilter(source: LibrarySource, checked: boolean) {
    setSourceFilters((current) => {
      const next = new Set(current)
      if (checked) next.add(source)
      else next.delete(source)
      return next
    })
  }

  function openAsset(asset: LibraryAsset) {
    setSelectedAssetId(asset.id)
    updateAssetRoute(asset.id)
  }

  function closeAsset() {
    setSelectedAssetId(undefined)
    updateAssetRoute()
  }

  function updateSelection(assetId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(assetId)
      else next.delete(assetId)
      return next
    })
  }

  function toggleFavorite(assetId: string) {
    setFavorites((current) => {
      const next = new Set(current)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  function changeElementView(nextElementView: (typeof ELEMENT_VIEWS)[number]) {
    setElementView(nextElementView)
    setSelectedAvatarId(undefined)
    const url = new URL(window.location.href)
    url.searchParams.set("view", "elements")
    url.searchParams.set("element", nextElementView.toLowerCase().replaceAll(" ", "-"))
    url.searchParams.delete("asset")
    url.searchParams.delete("avatar")
    window.history.pushState(window.history.state, "", url)
  }

  function selectAvatar(avatarId: string) {
    setSelectedAvatarId(avatarId)
    const url = new URL(window.location.href)
    url.searchParams.set("view", "elements")
    url.searchParams.set("element", "official-avatars")
    url.searchParams.delete("asset")
    url.searchParams.set("avatar", avatarId)
    window.history.pushState(window.history.state, "", url)
  }

  function closeAvatar() {
    setSelectedAvatarId(undefined)
    const url = new URL(window.location.href)
    url.searchParams.delete("avatar")
    window.history.pushState(window.history.state, "", url)
  }

  function toggleFavoriteAvatar(avatarId: string) {
    setFavoriteAvatarIds((current) => {
      const next = new Set(current)
      if (next.has(avatarId)) next.delete(avatarId)
      else next.add(avatarId)
      return next
    })
  }

  function openFavoriteAvatar(avatarId: string) {
    setView("elements")
    setElementView("Official avatars")
    selectAvatar(avatarId)
  }

  function favoriteSelected() {
    setFavorites((current) => new Set([...current, ...selectedIds]))
    toast.success(`${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"} added to Favorites`)
  }

  function downloadSelected() {
    const assets = LIBRARY_ASSETS.filter((asset) => selectedIds.has(asset.id))
    assets.forEach((asset) => {
      const link = document.createElement("a")
      link.href = asset.src
      link.download = `${asset.id}.${asset.mediaType === "video" ? "mp4" : "png"}`
      link.click()
    })
    toast.success(`${assets.length} download${assets.length === 1 ? "" : "s"} started`)
  }

  function openCollectionPicker(assetIds: Iterable<string>) {
    setPendingCollectionAssetIds([...assetIds])
    setCollectionDialogOpen(true)
  }

  function addToCollection(collectionId: string) {
    setCollections((current) => current.map((collection) => collection.id === collectionId
      ? { ...collection, updated: "Updated now", assetIds: [...new Set([...collection.assetIds, ...pendingCollectionAssetIds])] }
      : collection))
    const collection = collections.find((item) => item.id === collectionId)
    setCollectionDialogOpen(false)
    toast.success(`Added to ${collection?.name ?? "collection"}`)
  }

  function createCollection() {
    const name = newCollectionName.trim()
    if (!name) return
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "collection"}-${collections.length + 1}`
    setCollections((current) => [...current, {
      id,
      name,
      updated: "Updated now",
      cover: LIBRARY_ASSETS[0].src,
      assetIds: [...pendingCollectionAssetIds],
    }])
    setNewCollectionName("")
    setNewCollectionDialogOpen(false)
    toast.success(`${name} created`)
  }

  return (
    <div className="gb min-h-dvh bg-background text-foreground">
      <OttoPanelFlowReference founderName={REVIEW_ACCOUNT.displayName} recommendedPrompt="Help me find the right media from my Library.">
        <ProductPatternShellFrame
          pathname={SHELL_ROUTES.library}
        >
          <main className="flex h-[calc(100dvh-2.75rem)] min-w-0 bg-background">
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="shrink-0 px-6 pt-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-semibold tracking-[-0.03em]">Library</h1>
                    <p className="mt-1 text-xs text-muted-foreground">Find, organize and reuse everything you create.</p>
                  </div>
                  {view === "uploads" ? <Button size="sm" onClick={() => setUploadDialogOpen(true)}><Upload aria-hidden />Upload files</Button> : null}
                  {view === "collections" ? <Button size="sm" onClick={() => { setPendingCollectionAssetIds([]); setNewCollectionDialogOpen(true) }}>New collection</Button> : null}
                </div>

                <Tabs value={view} onValueChange={(value) => {
                  const nextView = value as LibraryView
                  setView(nextView)
                  updateLibraryViewRoute(nextView)
                  setActiveCollectionId(undefined)
                  setSelectionMode(false)
                  setSelectedIds(new Set())
                }} className="mt-5 gap-0">
                  <TabsList className="rounded-none bg-transparent p-0">
                    {LIBRARY_VIEWS.map((item) => (
                      <TabsTrigger
                        key={item.value}
                        value={item.value}
                        className="rounded-none border-b-2 border-transparent px-3 py-2.5 shadow-none data-active:border-foreground data-active:bg-transparent data-active:shadow-none"
                      >
                        {item.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </header>

              {view === "history" || view === "uploads" || view === "favorites" ? (
                <LibraryToolbar
                  query={query}
                  onQueryChange={setQuery}
                  mediaFilter={mediaFilter}
                  onMediaFilterChange={setMediaFilter}
                  canvasFilter={canvasFilter}
                  onCanvasFilterChange={setCanvasFilter}
                  chatFilter={chatFilter}
                  onChatFilterChange={setChatFilter}
                  dateFilter={dateFilter}
                  onDateFilterChange={setDateFilter}
                  sourceFilters={sourceFilters}
                  onSourceFilterChange={updateSourceFilter}
                  sortOrder={sortOrder}
                  onSortOrderChange={setSortOrder}
                  onClearFilters={clearFilters}
                  selectionMode={selectionMode}
                  onSelectionModeChange={(next) => {
                    setSelectionMode(next)
                    if (!next) setSelectedIds(new Set())
                  }}
                />
              ) : <div className="border-b border-border" />}

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {view === "collections" ? (
                  <CollectionView
                    collections={collections}
                    activeCollectionId={activeCollectionId}
                    onOpenCollection={setActiveCollectionId}
                    onBack={() => setActiveCollectionId(undefined)}
                    onOpenAsset={openAsset}
                  />
                ) : null}
                {view === "elements" ? (
                  <ElementsView
                    elementView={elementView}
                    selectedAvatarId={selectedAvatarId}
                    favoriteAvatarIds={favoriteAvatarIds}
                    onElementViewChange={changeElementView}
                    onSelectAvatar={selectAvatar}
                    onCloseAvatar={closeAvatar}
                    onToggleFavoriteAvatar={toggleFavoriteAvatar}
                  />
                ) : null}
                {view === "history" || view === "uploads" || view === "favorites" ? (
                  <>
                    <MediaGrid
                      assets={visibleAssets}
                      selectedAssetId={selectedAssetId}
                      selectionMode={selectionMode}
                      selectedIds={selectedIds}
                      onOpen={openAsset}
                      onSelect={updateSelection}
                      sortOrder={sortOrder}
                      onClearFilters={clearFilters}
                    />
                    {view === "favorites" ? (
                      <OfficialAvatarFavorites avatarIds={favoriteAvatarIds} onSelectAvatar={openFavoriteAvatar} />
                    ) : null}
                    {visibleLimit < searchedAssets.length ? (
                      <div className="flex justify-center pt-6">
                        <Button variant="secondary" size="sm" onClick={() => setVisibleLimit((limit) => limit + 8)}>Load older</Button>
                      </div>
                    ) : null}
                    {selectionMode && selectedIds.size ? (
                      <SelectionBar
                        count={selectedIds.size}
                        onCollect={() => openCollectionPicker(selectedIds)}
                        onFavorite={favoriteSelected}
                        onDownload={downloadSelected}
                        onDone={() => { setSelectionMode(false); setSelectedIds(new Set()) }}
                      />
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>

            {selectedAsset && (view === "history" || view === "uploads" || view === "favorites" || view === "collections") ? (
              <DetailPanel
                asset={selectedAsset}
                favorite={favorites.has(selectedAsset.id)}
                onFavoriteChange={() => toggleFavorite(selectedAsset.id)}
                onAddToCollection={() => openCollectionPicker([selectedAsset.id])}
                onClose={closeAsset}
              />
            ) : null}
          </main>

          <Dialog open={collectionDialogOpen} onOpenChange={setCollectionDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add to collection</DialogTitle>
                <DialogDescription>Collections keep links to the same media. Nothing is duplicated.</DialogDescription>
              </DialogHeader>
              <div className="space-y-1">
                {collections.map((collection) => (
                  <Button
                    key={collection.id}
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => addToCollection(collection.id)}
                  >
                    <FolderPlus aria-hidden />
                    {collection.name}
                    <span className="ml-auto text-xs font-normal text-muted-foreground">{collection.assetIds.length}</span>
                  </Button>
                ))}
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setCollectionDialogOpen(false)}>Cancel</Button>
                <Button onClick={() => {
                  setCollectionDialogOpen(false)
                  setNewCollectionDialogOpen(true)
                }}>New collection</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={newCollectionDialogOpen} onOpenChange={setNewCollectionDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New collection</DialogTitle>
                <DialogDescription>Name this one-layer collection. Media stays linked to its original source.</DialogDescription>
              </DialogHeader>
              <Input
                aria-label="Collection name"
                autoFocus
                value={newCollectionName}
                onChange={(event) => setNewCollectionName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") createCollection() }}
                placeholder="Collection name"
              />
              <DialogFooter>
                <Button variant="secondary" onClick={() => setNewCollectionDialogOpen(false)}>Cancel</Button>
                <Button disabled={!newCollectionName.trim()} onClick={createCollection}>Create collection</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload files</DialogTitle>
                <DialogDescription>Select images or videos. This review fixture keeps file names in the current session and does not persist files.</DialogDescription>
              </DialogHeader>
              <Input
                aria-label="Choose images or videos"
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={(event) => setUploadFileNames(Array.from(event.target.files ?? []).map((file) => file.name))}
              />
              {uploadFileNames.length ? (
                <div className="rounded-[var(--radius-card)] border border-border bg-muted p-3 text-sm">
                  <p className="font-semibold">{uploadFileNames.length} file{uploadFileNames.length === 1 ? "" : "s"} selected</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{uploadFileNames.join(", ")}</p>
                </div>
              ) : null}
              <DialogFooter>
                <Button variant="secondary" onClick={() => setUploadDialogOpen(false)}>Cancel</Button>
                <Button
                  disabled={!uploadFileNames.length}
                  onClick={() => {
                    setUploadDialogOpen(false)
                    toast.success(`${uploadFileNames.length} file${uploadFileNames.length === 1 ? "" : "s"} selected for this review session`)
                  }}
                >Confirm files</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </ProductPatternShellFrame>
      </OttoPanelFlowReference>
    </div>
  )
}
