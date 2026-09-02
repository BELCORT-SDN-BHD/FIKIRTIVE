export type LibraryView = "history" | "uploads" | "favorites" | "collections" | "elements"

export type LibraryMediaType = "image" | "video"

export type LibrarySource = "Generated" | "Upload"

export type LibraryTimeGroup = "Today" | "Yesterday" | "Earlier this month"

export type LibraryAsset = {
  id: string
  title: string
  src: string
  alt: string
  mediaType: LibraryMediaType
  source: LibrarySource
  group: LibraryTimeGroup
  canvas: string
  chat: string
  createdAt: string
  dimensions: string
  duration?: string
  prompt: string
  references: readonly string[]
}

export type OfficialAvatarGender = "Women" | "Men"

export type OfficialAvatarAgeGroup = "20s" | "30s"

export type OfficialAvatar = {
  id: string
  mention: `@${string}`
  name: string
  tagline: string
  demographic: string
  gender: OfficialAvatarGender
  ageGroup: OfficialAvatarAgeGroup
  vibeTags: readonly string[]
  industries: readonly string[]
  wardrobe: string
  portrait: string
  sheet?: string
  sceneStills?: readonly string[]
}

export const LIBRARY_VIEWS: readonly { value: LibraryView; label: string }[] = [
  { value: "history", label: "Generation history" },
  { value: "uploads", label: "Uploads" },
  { value: "favorites", label: "Favorites" },
  { value: "collections", label: "Collections" },
  { value: "elements", label: "Elements" },
]

export const ELEMENT_VIEWS = ["Products", "Characters", "Official avatars", "Clothes", "Locations"] as const
