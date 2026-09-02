export const SETTINGS_SECTIONS = [
  { key: "profile", label: "Profile", scope: "Personal" },
  { key: "general", label: "General", scope: "Workspace" },
  { key: "connections", label: "Connections", scope: "Workspace" },
  { key: "billing", label: "Billing & credits", scope: "Workspace" },
] as const

export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]["key"]

export function isSettingsSectionKey(value: string | undefined): value is SettingsSectionKey {
  return SETTINGS_SECTIONS.some((section) => section.key === value)
}

export type ConnectionHealth = "Healthy" | "Reconnect needed"

export type WorkspaceConnection = {
  id: string
  name: string
  identity: string
  accountDetail: string
  icon: string
  health: ConnectionHealth
  lastSync: string
  access: string
  availableData: string
}
