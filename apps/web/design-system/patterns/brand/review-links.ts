export const BRAND_REVIEW_HREF = "/product-patterns/brand"

export function brandSectionReviewHref(section: string): string {
  return `${BRAND_REVIEW_HREF}?section=${encodeURIComponent(section)}`
}
