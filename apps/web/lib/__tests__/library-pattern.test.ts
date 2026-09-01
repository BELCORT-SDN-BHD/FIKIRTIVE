import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { LIBRARY_ASSETS, OFFICIAL_AVATARS } from "@/design-system/patterns/library/fixtures"
import { filterAndSortLibraryAssets } from "@/design-system/patterns/library/filtering"
import { ELEMENT_VIEWS, LIBRARY_VIEWS } from "@/design-system/patterns/library/model"
import { LIBRARY_REVIEW_HREF, libraryAssetReviewHref } from "@/design-system/patterns/library/review-links"

const WEB_ROOT = path.resolve(__dirname, "../..")
const PATTERN_ROOT = path.join(WEB_ROOT, "design-system/patterns/library")
const REFERENCE = fs.readFileSync(path.join(PATTERN_ROOT, "LibraryReference.tsx"), "utf8")
const README = fs.readFileSync(path.join(PATTERN_ROOT, "README.md"), "utf8")
const ROUTE = fs.readFileSync(path.join(WEB_ROOT, "app/product-patterns/library/page.tsx"), "utf8")
const CANVAS_ROUTE = fs.readFileSync(path.join(WEB_ROOT, "app/product-patterns/canvas/page.tsx"), "utf8")
const CANVAS_REFERENCE = fs.readFileSync(path.join(WEB_ROOT, "design-system/patterns/canvas/CanvasReference.tsx"), "utf8")
const OFFICIAL_AVATARS_REFERENCE = fs.readFileSync(path.join(PATTERN_ROOT, "OfficialAvatarsView.tsx"), "utf8")

describe("Library product pattern", () => {
  const defaultFilters = {
    assets: LIBRARY_ASSETS,
    view: "history" as const,
    favorites: new Set<string>(),
    query: "",
    mediaFilter: "all" as const,
    canvasFilter: "all",
    chatFilter: "all",
    dateFilter: "all" as const,
    sourceFilters: new Set(["Generated", "Upload"] as const),
    sortOrder: "newest" as const,
  }

  it("keeps the frozen taxonomy as one deterministic registry", () => {
    expect(LIBRARY_VIEWS.map((view) => view.label)).toEqual([
      "Generation history",
      "Uploads",
      "Favorites",
      "Collections",
      "Elements",
    ])
    expect(ELEMENT_VIEWS).toEqual(["Products", "Characters", "Official avatars", "Clothes", "Locations"])
    expect(new Set(LIBRARY_ASSETS.map((asset) => asset.id)).size).toBe(LIBRARY_ASSETS.length)
    expect(fs.readdirSync(path.join(PATTERN_ROOT, "assets")).filter((name) => name.endsWith(".png"))).toHaveLength(6)
    expect(LIBRARY_ASSETS.every((asset) => typeof asset.src === "string" && asset.src.length > 0)).toBe(true)
  })

  it("models the official avatar catalog as read-only, reusable identity", () => {
    expect(OFFICIAL_AVATARS).toHaveLength(6)
    expect(new Set(OFFICIAL_AVATARS.map((avatar) => avatar.id)).size).toBe(OFFICIAL_AVATARS.length)
    expect(OFFICIAL_AVATARS.every((avatar) => avatar.mention === `@${avatar.name}`)).toBe(true)
    expect(OFFICIAL_AVATARS.every((avatar) => avatar.vibeTags.length === 3)).toBe(true)
    expect(OFFICIAL_AVATARS.every((avatar) => avatar.industries.length >= 3)).toBe(true)
    expect(OFFICIAL_AVATARS_REFERENCE).toContain("AI generated")
    expect(OFFICIAL_AVATARS_REFERENCE).toContain("Cleared for commercial use")
    expect(OFFICIAL_AVATARS_REFERENCE).toContain("Voice is set per video, not fixed to the actor.")
    expect(OFFICIAL_AVATARS_REFERENCE).not.toMatch(/Seedream|Seedance|Rename|Delete avatar|Edit avatar/)
  })

  it("records the approved visual and fixture-only implementation state", () => {
    expect(README).toContain("Founder approved and frozen")
    expect(README).toContain("第一款的中间 + 第二款的边框")
    expect(README).toContain("production `/library` 不变")
    expect(fs.existsSync(path.join(PATTERN_ROOT, "selected-direction.png"))).toBe(true)
    expect(fs.existsSync(path.join(PATTERN_ROOT, "official-avatars-selected-direction.png"))).toBe(true)
  })

  it("uses a thin, deep-linkable review route", () => {
    expect(LIBRARY_REVIEW_HREF).toBe("/product-patterns/library")
    expect(libraryAssetReviewHref("gift-box-hero")).toBe("/product-patterns/library?asset=gift-box-hero")
    expect(ROUTE).toContain('from "@/design-system/patterns/library/LibraryReference"')
    expect(ROUTE).toContain("initialAssetId={asset}")
    expect(ROUTE).toContain("initialAvatarId={avatar}")
    expect(ROUTE).not.toMatch(/auth\(|fetch\(|force-dynamic/)
  })

  it("keeps Library route state and official-avatar favorites under one owner", () => {
    expect(REFERENCE).toContain('window.addEventListener("popstate", syncLibraryFromRoute)')
    expect(REFERENCE).toContain("setView(nextView)")
    expect(REFERENCE).toContain("setElementView(nextElementView)")
    expect(REFERENCE).toContain("setSelectedAvatarId(url.searchParams.get(\"avatar\") ?? undefined)")
    expect(REFERENCE).toContain("favoriteAvatarIds={favoriteAvatarIds}")
    expect(REFERENCE).toContain("<OfficialAvatarFavorites")
    expect(OFFICIAL_AVATARS_REFERENCE).not.toContain("useState<Set<string>>")
  })

  it("hands a stable avatar id to Canvas while displaying the readable mention", () => {
    expect(OFFICIAL_AVATARS_REFERENCE).toContain("context=${encodeURIComponent(avatar.id)}&mention=${encodeURIComponent(avatar.mention)}")
    expect(CANVAS_ROUTE).toContain("initialContext={context}")
    expect(CANVAS_ROUTE).toContain("initialContextLabel={mention}")
    expect(CANVAS_REFERENCE).toContain("const initialReference = initialContextLabel ?? initialContext")
  })

  it("composes the formal shell, Otto panel and canonical primitives", () => {
    expect(REFERENCE).toContain('from "@/design-system/patterns/application-shell/ProductPatternShellFrame"')
    expect(REFERENCE).toContain('from "@/components/otto/panel/OttoPanelFlowReference"')
    expect(REFERENCE).toContain("<ProductPatternShellFrame")
    expect(REFERENCE).toContain('pathname={SHELL_ROUTES.library}')
    expect(REFERENCE).toContain("<OttoPanelFlowReference")
    for (const primitive of ["button", "checkbox", "dialog", "dropdown-menu", "input-group", "tabs", "toast", "toggle-group"]) {
      expect(REFERENCE).toContain(`@/design-system/primitives/${primitive}`)
    }
  })

  it("keeps Library controls on the design system and coral reserved for Otto", () => {
    expect(REFERENCE).not.toMatch(/<button\b|<input\b|<select\b|<textarea\b/)
    expect(REFERENCE).not.toMatch(/border-brand|bg-brand|text-brand/)
    expect(REFERENCE).not.toMatch(/rounded-(?:xl|2xl)/)
    expect(REFERENCE).not.toMatch(/text-\[\d+px\]/)
    expect(REFERENCE).not.toContain("duration-150")
    expect(REFERENCE).toContain("rounded-[var(--radius-card)]")
    expect(OFFICIAL_AVATARS_REFERENCE).not.toMatch(/<button\b|<input\b|<select\b|<textarea\b/)
    expect(OFFICIAL_AVATARS_REFERENCE).not.toMatch(/border-brand|bg-brand|text-brand/)
    expect(OFFICIAL_AVATARS_REFERENCE).toContain("@/design-system/primitives/badge")
    expect(OFFICIAL_AVATARS_REFERENCE).toContain("@/design-system/primitives/tabs")
  })

  it("implements search, filters, selection, detail reuse and progressive history without persistence claims", () => {
    for (const evidence of [
      "Search Library",
      "More filters",
      "Load older",
      "Use in Canvas",
      "Add to collection",
      "References used",
      "onKeyDown",
      "updateAssetRoute",
    ]) expect(REFERENCE).toContain(evidence)
    expect(REFERENCE).not.toMatch(/localStorage|fetch\(|server action|deleteAsset|uploadAsset/)
  })

  it("closes an official-avatar detail when active filters exclude that actor", () => {
    expect(OFFICIAL_AVATARS_REFERENCE).toContain("const selectedAvatar = visible.find((avatar) => avatar.id === selectedAvatarId)")
    expect(OFFICIAL_AVATARS_REFERENCE).toContain("selectedAvatarId && !selectedAvatar")
    expect(OFFICIAL_AVATARS_REFERENCE).toContain("onCloseAvatar()")
  })

  it("filters the same canonical asset list by search, media, Canvas, chat, date and source", () => {
    expect(filterAndSortLibraryAssets({ ...defaultFilters, query: "jasmine" }).map((asset) => asset.id)).toEqual([
      "jasmine-product",
      "jasmine-still-life",
      "perfume-motion",
    ])
    expect(filterAndSortLibraryAssets({ ...defaultFilters, mediaFilter: "video" }).every((asset) => asset.mediaType === "video")).toBe(true)
    expect(filterAndSortLibraryAssets({ ...defaultFilters, canvasFilter: "Hari Raya gifting" }).every((asset) => asset.canvas === "Hari Raya gifting")).toBe(true)
    expect(filterAndSortLibraryAssets({ ...defaultFilters, chatFilter: "Uploaded references" }).every((asset) => asset.chat === "Uploaded references")).toBe(true)
    expect(filterAndSortLibraryAssets({ ...defaultFilters, dateFilter: "today" }).every((asset) => asset.group === "Today")).toBe(true)
    expect(filterAndSortLibraryAssets({ ...defaultFilters, sourceFilters: new Set(["Upload"] as const) }).every((asset) => asset.source === "Upload")).toBe(true)
  })

  it("sorts newest, oldest and both name directions deterministically", () => {
    expect(filterAndSortLibraryAssets(defaultFilters)[0]?.id).toBe(LIBRARY_ASSETS[0]?.id)
    expect(filterAndSortLibraryAssets({ ...defaultFilters, sortOrder: "oldest" })[0]?.id).toBe(LIBRARY_ASSETS.at(-1)?.id)
    const ascending = filterAndSortLibraryAssets({ ...defaultFilters, sortOrder: "name-asc" }).map((asset) => asset.title)
    const descending = filterAndSortLibraryAssets({ ...defaultFilters, sortOrder: "name-desc" }).map((asset) => asset.title)
    expect(ascending).toEqual([...ascending].sort((left, right) => left.localeCompare(right)))
    expect(descending).toEqual([...ascending].reverse())
  })
})
