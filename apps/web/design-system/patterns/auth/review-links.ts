import type { AuthReviewStep } from "./model"

export const AUTH_REVIEW_HREF = "/product-patterns/auth"

export function authReviewHref(step: AuthReviewStep, from = "/create"): string {
  const search = new URLSearchParams()
  if (step !== "hub") search.set("step", step)
  search.set("from", from)
  return `${AUTH_REVIEW_HREF}?${search.toString()}`
}
