export type GenerationKind = "image" | "video"

export type GenerationQuote = {
  id: string
  kind: GenerationKind
  title: string
  spec: string
  credits: number
}

export const inferGenerationKind = (
  prompt: string,
  selectedKind?: GenerationKind,
): GenerationKind => {
  const normalized = prompt.trim().toLowerCase()
  if (/\b(video|animate|animation|motion|reel|clip|film)\b/.test(normalized)) return "video"
  if (/\b(image|photo|poster|visual|graphic|picture)\b/.test(normalized)) return "image"
  return selectedKind ?? "image"
}

export const autoNameProject = (prompt: string) => {
  const normalized = prompt.trim().toLowerCase()
  if (normalized.includes("merdeka")) return "Merdeka launch"
  if (normalized.includes("gift")) return "Gift box launch"
  if (normalized.includes("video") || normalized.includes("animate")) return "Product video"
  return "New creation"
}
