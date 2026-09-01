import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { SETTINGS_SECTIONS, SHELL_ROUTES } from "@fikirtive/core/navigation"

const WEB_ROOT = path.resolve(__dirname, "../..")
const source = (relativePath: string) => fs.readFileSync(path.join(WEB_ROOT, relativePath), "utf8")

describe("Settings Phase 4 production convergence", () => {
  it("keeps the four approved destinations in the navigation authority", () => {
    expect(SETTINGS_SECTIONS.map(({ key, label, href, scope }) => ({ key, label, href, scope }))).toEqual([
      { key: "profile", label: "Profile", href: SHELL_ROUTES.profile, scope: "Personal" },
      { key: "general", label: "General", href: SHELL_ROUTES.preferences, scope: "Workspace" },
      { key: "connections", label: "Connections", href: SHELL_ROUTES.connections, scope: "Workspace" },
      { key: "billing", label: "Billing & credits", href: SHELL_ROUTES.billing, scope: "Workspace" },
    ])
  })

  it("uses one shared production shell on every formal route", () => {
    for (const route of [
      "app/profile/page.tsx",
      "app/settings/page.tsx",
      "app/settings/connections/page.tsx",
      "app/billing/page.tsx",
    ]) {
      const page = source(route)
      expect(page, route).toContain('from "@/components/settings/SettingsShell"')
      expect(page, route).toContain("<SettingsShell")
      expect(page, route).not.toContain("design-system/patterns/settings")
    }
  })

  it("separates personal identity from workspace identity", () => {
    const profile = source("app/profile/page.tsx")
    const general = source("app/settings/page.tsx")

    expect(profile).toContain("<DisplayNameField")
    expect(profile).not.toContain("<WorkspaceNameField")
    expect(profile).toContain("names.email")
    expect(general).toContain("<WorkspaceNameField")
    expect(general).not.toContain("<DisplayNameField")
    expect(general).toContain("Changes affect everyone in this workspace.")
  })

  it("does not revive the retired legacy Settings account surface", () => {
    const general = source("app/settings/page.tsx")
    expect(general).not.toContain("OttoAccount")
    expect(general).not.toMatch(/Schedule|Publishing|Automation|spend cap/i)
  })

  it("keeps Billing on real balances, packs, checkout status and spend history", () => {
    const billing = source("app/billing/page.tsx")
    for (const truth of ["getMyAccount", "listCreditPacks", "getSpendOverview", "BuyPackButton", "SpendHistory"]) {
      expect(billing).toContain(truth)
    }
    expect(billing).not.toMatch(/payment method|invoice|subscription plan/i)
  })
})
