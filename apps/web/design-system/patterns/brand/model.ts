export const BRAND_SECTIONS = [
  { key: "brand-voice", label: "Brand voice", action: "Add brand voice" },
  { key: "audiences", label: "Audiences", action: "Add audience" },
  { key: "knowledge-base", label: "Knowledge base", action: "Add knowledge" },
  { key: "style-guide", label: "Style guide", action: "Add style guide" },
  { key: "visual-guidelines", label: "Visual guidelines", action: "Add visual guideline" },
] as const

export type BrandSectionKey = (typeof BRAND_SECTIONS)[number]["key"]
export type ContextStatus = "Ready" | "Draft" | "Processing"

export type ContextRecord = {
  id: string
  name: string
  description: string
  status: ContextStatus
  updated: string
  source: string
  sourceDetail: string
  instructions: readonly string[]
  usage: readonly string[]
  history: readonly string[]
  withoutPreview: string
  withPreview: string
}

export function isBrandSectionKey(value?: string): value is BrandSectionKey {
  return BRAND_SECTIONS.some((section) => section.key === value)
}

export function sectionLabel(key: BrandSectionKey): string {
  return BRAND_SECTIONS.find((section) => section.key === key)?.label ?? "Brand voice"
}

export function sectionAction(key: BrandSectionKey): string {
  return BRAND_SECTIONS.find((section) => section.key === key)?.action ?? "Add brand voice"
}
