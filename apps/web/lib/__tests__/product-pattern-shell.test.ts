import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import navigationContract from "@/design-system/information-architecture/navigation-contract.json"

const WEB_ROOT = path.resolve(__dirname, "../..")
const PATTERNS_ROOT = path.join(WEB_ROOT, "design-system/patterns")
const REVIEW_SHELL = fs.readFileSync(
  path.join(PATTERNS_ROOT, "application-shell/ProductPatternShellFrame.tsx"),
  "utf8",
)
const REVIEW_SURFACES = [
  "founder-home/FounderHomeReference.tsx",
  "canvas/CreateWorkspaceReference.tsx",
  "library/LibraryReference.tsx",
  "brand/BrandReference.tsx",
  "settings/SettingsReference.tsx",
] as const

describe("Product-pattern review shell", () => {
  it("reuses the production shell rather than maintaining a second navigation implementation", () => {
    expect(REVIEW_SHELL).toContain('from "@/components/global-navigation"')
    expect(REVIEW_SHELL).toContain("<MerchantShellFrame")
  })

  it("owns the frozen beta destinations and all review routes in one place", () => {
    expect(navigationContract.activeMainNavigationKeys).toEqual([
      "home",
      "create",
      "library",
      "brand",
      "settings",
    ])
    expect(REVIEW_SHELL).toContain("navigationContract.activeMainNavigationKeys")
    for (const destination of ["home", "create", "library", "brand", "settings"]) {
      expect(REVIEW_SHELL).toContain(`${destination}:`)
    }
    expect(REVIEW_SHELL).not.toMatch(/campaign:|schedule:/)
  })

  it("is consumed by every shell-based product-pattern surface", () => {
    for (const relativePath of REVIEW_SURFACES) {
      const source = fs.readFileSync(path.join(PATTERNS_ROOT, relativePath), "utf8")
      expect(source).toContain("<ProductPatternShellFrame")
      expect(source).not.toContain("<MerchantShellFrame")
    }
  })

  it("keeps profile, credits and sign-out behavior consistent across review surfaces", () => {
    expect(REVIEW_SHELL).toContain('profileHref={settingsSectionReviewHref("profile")}')
    expect(REVIEW_SHELL).toContain('creditsHref={settingsSectionReviewHref("billing")}')
    expect(REVIEW_SHELL).toContain("showSignOutAction={false}")
  })
})
