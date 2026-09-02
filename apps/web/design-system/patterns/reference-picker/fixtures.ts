import { LIBRARY_ASSETS, LIBRARY_ELEMENT_FIXTURES, OFFICIAL_AVATARS } from "@/design-system/patterns/library/fixtures"

import type { ReferenceItem } from "./model"

const alya = OFFICIAL_AVATARS.find((avatar) => avatar.id === "actor-alya")!
const mei = OFFICIAL_AVATARS.find((avatar) => avatar.id === "actor-mei")!
const product = LIBRARY_ELEMENT_FIXTURES.find((item) => item.type === "Products")!
const character = LIBRARY_ELEMENT_FIXTURES.find((item) => item.type === "Characters")!
const clothes = LIBRARY_ELEMENT_FIXTURES.find((item) => item.type === "Clothes")!
const location = LIBRARY_ELEMENT_FIXTURES.find((item) => item.type === "Locations")!
const generation = LIBRARY_ASSETS.find((asset) => asset.id === "gift-box-hero")!
const upload = LIBRARY_ASSETS.find((asset) => asset.id === "jasmine-product")!

export const REFERENCE_FIXTURES: readonly ReferenceItem[] = [
  { id: "product-jasmine", name: product.name, type: "product", meta: "Product · Otto IQ", image: product.cover },
  { id: "character-aisyah", name: character.name, type: "character", meta: "Character · Library", image: character.cover },
  { id: alya.id, name: alya.name, type: "official-avatar", meta: "Official avatar · Read only", image: alya.portrait },
  { id: mei.id, name: mei.name, type: "official-avatar", meta: "Official avatar · Read only", image: mei.portrait },
  { id: "location-storefront", name: location.name, type: "location", meta: "Location · Library", image: location.cover },
  { id: "clothes-emerald", name: clothes.name, type: "clothes", meta: "Clothes · Library", image: clothes.cover },
  { id: generation.id, name: generation.title, type: "generation", meta: `Generation · ${generation.canvas}`, image: generation.src },
  { id: upload.id, name: upload.title, type: "upload", meta: "Upload · Library", image: upload.src },
  {
    id: "generation-processing",
    name: "Night-market variation",
    type: "generation",
    meta: "Generation · Hari Raya gifting",
    image: generation.src,
    unavailableReason: "Still processing",
  },
]

export const RECENT_REFERENCE_IDS = [alya.id, "product-jasmine", generation.id, "location-storefront", "clothes-emerald"] as const
