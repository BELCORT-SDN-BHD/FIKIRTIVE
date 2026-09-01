import type { GenerationQuote } from "./model"

export const DEFAULT_PROMPT =
  "Create four Merdeka gift-box product photo directions."

export const INITIAL_CONTEXT = ["Brand", "Audience", "Visual guidelines"]

export const CONTEXT_OPTIONS = [
  "Upload",
  "URL",
  "Library",
  "Brand",
  "Campaign",
  "Previous project",
]

export const INITIAL_QUOTE: GenerationQuote = {
  id: "quote-image-directions",
  kind: "image",
  title: "Generate 4 product-photo directions",
  spec: "Portrait · 4:5 · Brand and product photo attached",
  credits: 8,
}

export const RECENT_PROJECTS = [
  { name: "Hari Raya gifting", meta: "3 generations · Updated today" },
  { name: "Weekend tea launch", meta: "8 generations · Updated yesterday" },
  { name: "New arrivals", meta: "5 generations · Updated 3 days ago" },
]
