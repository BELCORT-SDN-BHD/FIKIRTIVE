import type { Metadata } from "next"

import { isReferencePickerState } from "@/design-system/patterns/reference-picker/model"
import { ReferencePickerReference } from "@/design-system/patterns/reference-picker/ReferencePickerReference"

import { assertReviewFixtureRoute } from "@/lib/review-fixture-guard"
export const metadata: Metadata = {
  title: "Otto Reference picker · Fikirtive",
}

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  assertReviewFixtureRoute()
  const { state } = await searchParams
  return <ReferencePickerReference initialState={isReferencePickerState(state) ? state : "recent"} />
}
