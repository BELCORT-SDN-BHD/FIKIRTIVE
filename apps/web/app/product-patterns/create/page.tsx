import type { Metadata } from "next"

import { CreateWorkspaceReference } from "@/design-system/patterns/canvas/CreateWorkspaceReference"

import { assertReviewFixtureRoute } from "@/lib/review-fixture-guard"
export const metadata: Metadata = {
  title: "Create · Fikirtive",
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ context?: string }>
}) {
  assertReviewFixtureRoute()
  const { context } = await searchParams
  return <CreateWorkspaceReference initialContext={context} />
}
