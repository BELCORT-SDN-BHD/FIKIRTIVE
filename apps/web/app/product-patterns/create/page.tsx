import type { Metadata } from "next"

import { CreateWorkspaceReference } from "@/design-system/patterns/canvas/CreateWorkspaceReference"

export const metadata: Metadata = {
  title: "Create · Fikirtive",
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ context?: string }>
}) {
  const { context } = await searchParams
  return <CreateWorkspaceReference initialContext={context} />
}
