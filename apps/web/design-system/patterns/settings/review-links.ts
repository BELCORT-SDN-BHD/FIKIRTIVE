import type { SettingsSectionKey } from "./model"

export const SETTINGS_REVIEW_HREF = "/product-patterns/settings"

export function settingsSectionReviewHref(section: SettingsSectionKey, connection?: string): string {
  const search = new URLSearchParams({ section })
  if (section === "connections" && connection) search.set("connection", connection)
  return `${SETTINGS_REVIEW_HREF}?${search.toString()}`
}
