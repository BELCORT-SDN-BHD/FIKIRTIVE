export const LIBRARY_REVIEW_HREF = "/product-patterns/library"

export function libraryAssetReviewHref(assetId: string): string {
  const params = new URLSearchParams({ asset: assetId })
  return `${LIBRARY_REVIEW_HREF}?${params.toString()}`
}
