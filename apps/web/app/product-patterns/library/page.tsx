import type { Metadata } from "next"

import { LibraryReference } from "@/design-system/patterns/library/LibraryReference"
import { ELEMENT_VIEWS, type LibraryView } from "@/design-system/patterns/library/model"

import { assertReviewFixtureRoute } from "@/lib/review-fixture-guard"
export const metadata: Metadata = {
  title: "Library · Fikirtive",
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ asset?: string; avatar?: string; element?: string; view?: string }>
}) {
  assertReviewFixtureRoute()
  const { asset, avatar, element, view } = await searchParams
  const initialView: LibraryView = ["history", "uploads", "favorites", "collections", "elements"].includes(view ?? "")
    ? view as LibraryView
    : "history"
  const initialElementView = ELEMENT_VIEWS.find((item) => item.toLowerCase().replaceAll(" ", "-") === element) ?? "Products"

  return (
    <LibraryReference
      initialAssetId={asset}
      initialAvatarId={avatar}
      initialView={initialView}
      initialElementView={initialElementView}
    />
  )
}
