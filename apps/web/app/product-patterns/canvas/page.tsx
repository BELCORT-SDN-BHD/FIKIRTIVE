import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { CanvasReference } from "@/design-system/patterns/canvas/CanvasReference"
import { createWorkspaceReviewHref } from "@/design-system/patterns/canvas/review-links"

import { assertReviewFixtureRoute } from "@/lib/review-fixture-guard"
export const metadata: Metadata = {
  title: "Canvas · Fikirtive",
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ share?: string; surface?: string; context?: string; mention?: string; new?: string; prompt?: string; mode?: string }>
}) {
  assertReviewFixtureRoute()
  const { share, surface, context, mention, new: newProject, prompt, mode } = await searchParams
  if (surface === "lab") redirect(createWorkspaceReviewHref(context))

  return (
    <CanvasReference
      shareMode={share === "selected"}
      newProject={newProject === "1"}
      initialPrompt={prompt}
      initialMode={mode === "video" ? "video" : "image"}
      initialContext={context}
      initialContextLabel={mention}
    />
  )
}
