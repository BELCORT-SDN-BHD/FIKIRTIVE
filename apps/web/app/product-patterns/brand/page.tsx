import type { Metadata } from "next"

import { BrandReference } from "@/design-system/patterns/brand/BrandReference"
import { isBrandSectionKey } from "@/design-system/patterns/brand/model"

import { assertReviewFixtureRoute } from "@/lib/review-fixture-guard"
export const metadata: Metadata = {
  title: "Brand · Fikirtive",
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>
}) {
  assertReviewFixtureRoute()
  const { section } = await searchParams
  return <BrandReference initialSection={isBrandSectionKey(section) ? section : "brand-voice"} />
}
