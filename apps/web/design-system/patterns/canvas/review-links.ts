export const CANVAS_REVIEW_HREF = "/product-patterns/canvas"
export const CREATE_WORKSPACE_REVIEW_HREF = "/product-patterns/create"

export function createWorkspaceReviewHref(context?: string): string {
  if (!context) return CREATE_WORKSPACE_REVIEW_HREF
  const params = new URLSearchParams()
  if (context) params.set("context", context)
  return `${CREATE_WORKSPACE_REVIEW_HREF}?${params.toString()}`
}

export function newCanvasReviewHref({
  prompt,
  mode,
  reference,
}: {
  prompt: string
  mode: "image" | "video"
  reference?: string
}): string {
  const params = new URLSearchParams({ new: "1", prompt, mode })
  if (reference) params.set("context", reference)
  return `${CANVAS_REVIEW_HREF}?${params.toString()}`
}
