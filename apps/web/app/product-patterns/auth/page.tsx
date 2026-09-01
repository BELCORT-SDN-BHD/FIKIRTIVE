import type { Metadata } from "next"

import { AuthAccessJourneyReference } from "@/design-system/patterns/auth/AuthAccessJourneyReference"
import { isAuthReviewStep } from "@/design-system/patterns/auth/model"

export const metadata: Metadata = {
  title: "Auth journey · Fikirtive",
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; step?: string }>
}) {
  const { from, step } = await searchParams
  return (
    <AuthAccessJourneyReference
      initialFrom={from || "/create"}
      initialStep={isAuthReviewStep(step) ? step : "hub"}
    />
  )
}
