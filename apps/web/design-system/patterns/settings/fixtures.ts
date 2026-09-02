import type { WorkspaceConnection } from "./model"

export const SETTINGS_BILLING_FIXTURE = {
  monthlyCredits: 1000,
  purchasedCredits: 240,
} as const

export const SETTINGS_CONNECTION_FIXTURES: readonly WorkspaceConnection[] = [
  {
    id: "meta-ads",
    name: "Meta Ads",
    identity: "Kedai Kopi",
    accountDetail: "Meta business account",
    icon: "/integrations/meta.svg",
    health: "Healthy",
    lastSync: "31 Aug 2026, 9:42 AM",
    access: "Available across this workspace",
    availableData: "Campaign performance and ad spend",
  },
  {
    id: "google-business-profile",
    name: "Google Business Profile",
    identity: "Kedai Kopi KL",
    accountDetail: "Google business profile",
    icon: "/integrations/google.svg",
    health: "Healthy",
    lastSync: "31 Aug 2026, 10:18 AM",
    access: "Available across this workspace",
    availableData: "Business details, reviews and local performance",
  },
  {
    id: "shopify",
    name: "Shopify",
    identity: "raya-store",
    accountDetail: "Shopify account",
    icon: "/integrations/shopify.svg",
    health: "Reconnect needed",
    lastSync: "29 Aug 2026, 10:42 AM",
    access: "Available across this workspace",
    availableData: "Products, orders and customers",
  },
]

export const AVAILABLE_CONNECTION_FIXTURES: readonly WorkspaceConnection[] = [
  {
    id: "google-ads",
    name: "Google Ads",
    identity: "Not connected",
    accountDetail: "Google advertising account",
    icon: "/integrations/google.svg",
    health: "Healthy",
    lastSync: "Not connected yet",
    access: "Available across this workspace after connecting",
    availableData: "Campaign performance and ad spend",
  },
]
