import type { LibraryAsset, LibraryMediaType, LibrarySource, LibraryView } from "./model"

export type LibraryDateFilter = "all" | "today" | "week"
export type LibrarySortOrder = "newest" | "oldest" | "name-asc" | "name-desc"

export function filterAndSortLibraryAssets({
  assets,
  view,
  favorites,
  query,
  mediaFilter,
  canvasFilter,
  chatFilter,
  dateFilter,
  sourceFilters,
  sortOrder,
}: {
  assets: readonly LibraryAsset[]
  view: LibraryView
  favorites: ReadonlySet<string>
  query: string
  mediaFilter: "all" | LibraryMediaType
  canvasFilter: string
  chatFilter: string
  dateFilter: LibraryDateFilter
  sourceFilters: ReadonlySet<LibrarySource>
  sortOrder: LibrarySortOrder
}): LibraryAsset[] {
  const originalOrder = new Map(assets.map((asset, index) => [asset.id, index]))
  const normalizedQuery = query.trim().toLowerCase()

  return assets.filter((asset) => {
    const matchesView = view === "uploads" ? asset.source === "Upload" : view === "favorites" ? favorites.has(asset.id) : true
    const matchesMedia = mediaFilter === "all" || asset.mediaType === mediaFilter
    const matchesCanvas = canvasFilter === "all" || asset.canvas === canvasFilter
    const matchesChat = chatFilter === "all" || asset.chat === chatFilter
    const matchesDate = dateFilter === "all" || (dateFilter === "today" ? asset.group === "Today" : asset.group !== "Earlier this month")
    const matchesSource = sourceFilters.has(asset.source)
    const haystack = `${asset.title} ${asset.prompt} ${asset.canvas} ${asset.chat}`.toLowerCase()
    return matchesView && matchesMedia && matchesCanvas && matchesChat && matchesDate && matchesSource && haystack.includes(normalizedQuery)
  }).sort((left, right) => {
    if (sortOrder === "name-asc") return left.title.localeCompare(right.title)
    if (sortOrder === "name-desc") return right.title.localeCompare(left.title)
    const difference = (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0)
    return sortOrder === "oldest" ? -difference : difference
  })
}
