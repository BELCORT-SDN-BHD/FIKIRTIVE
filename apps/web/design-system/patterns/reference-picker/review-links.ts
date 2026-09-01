import type { ReferencePickerState } from "./model"

export const REFERENCE_PICKER_REVIEW_HREF = "/product-patterns/reference-picker"

export function referencePickerReviewHref(state: ReferencePickerState): string {
  return `${REFERENCE_PICKER_REVIEW_HREF}?state=${state}`
}
