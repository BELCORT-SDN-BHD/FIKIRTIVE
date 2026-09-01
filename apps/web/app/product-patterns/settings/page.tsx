import type { Metadata } from "next"

import { SettingsReference } from "@/design-system/patterns/settings/SettingsReference"
import { isSettingsSectionKey } from "@/design-system/patterns/settings/model"

export const metadata: Metadata = {
  title: "Settings · Fikirtive",
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; connection?: string }>
}) {
  const { section, connection } = await searchParams
  return (
    <SettingsReference
      initialSection={isSettingsSectionKey(section) ? section : "general"}
      initialConnectionId={connection}
    />
  )
}
