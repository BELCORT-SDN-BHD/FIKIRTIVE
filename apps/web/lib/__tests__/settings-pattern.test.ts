import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import navigationContract from "@/design-system/information-architecture/navigation-contract.json"
import { REVIEW_ACCOUNT } from "@/design-system/patterns/application-shell/review-account"
import {
  SETTINGS_BILLING_FIXTURE,
  SETTINGS_CONNECTION_FIXTURES,
} from "@/design-system/patterns/settings/fixtures"
import { isSettingsSectionKey, SETTINGS_SECTIONS } from "@/design-system/patterns/settings/model"
import { SETTINGS_REVIEW_HREF, settingsSectionReviewHref } from "@/design-system/patterns/settings/review-links"

const WEB_ROOT = path.resolve(__dirname, "../..")
const PATTERN_ROOT = path.join(WEB_ROOT, "design-system/patterns/settings")
const REFERENCE = fs.readFileSync(path.join(PATTERN_ROOT, "SettingsReference.tsx"), "utf8")
const README = fs.readFileSync(path.join(PATTERN_ROOT, "README.md"), "utf8")
const ROUTE = fs.readFileSync(path.join(WEB_ROOT, "app/product-patterns/settings/page.tsx"), "utf8")

describe("Settings beta product pattern", () => {
  it("keeps the frozen beta taxonomy in one deterministic registry", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual([
      "Profile",
      "General",
      "Connections",
      "Billing & credits",
    ])
    expect(SETTINGS_SECTIONS.filter((section) => section.scope === "Personal")).toHaveLength(1)
    expect(isSettingsSectionKey("connections")).toBe(true)
    expect(isSettingsSectionKey("schedule")).toBe(false)
    expect(navigationContract.activeMainNavigationKeys).toEqual(["home", "create", "library", "brand", "settings"])
  })

  it("records the Founder-selected visual and approved implementation gate", () => {
    expect(README).toContain("Founder approved and frozen")
    expect(README).toContain("2那种我很喜欢")
    expect(README).toContain("detail inspector")
    expect(fs.existsSync(path.join(PATTERN_ROOT, "selected-direction.png"))).toBe(true)
  })

  it("uses a thin, deep-linkable review route", () => {
    expect(SETTINGS_REVIEW_HREF).toBe("/product-patterns/settings")
    expect(settingsSectionReviewHref("connections", "shopify")).toBe(
      "/product-patterns/settings?section=connections&connection=shopify",
    )
    expect(ROUTE).toContain('from "@/design-system/patterns/settings/SettingsReference"')
    expect(ROUTE).toContain("isSettingsSectionKey(section)")
    expect(ROUTE).not.toMatch(/auth\(|fetch\(|force-dynamic/)
  })

  it("models connected services with identity, scope, health and recovery", () => {
    expect(SETTINGS_CONNECTION_FIXTURES).toHaveLength(3)
    expect(SETTINGS_CONNECTION_FIXTURES.every((connection) => connection.identity.length > 0)).toBe(true)
    expect(SETTINGS_CONNECTION_FIXTURES.every((connection) => connection.access.includes("workspace"))).toBe(true)
    expect(SETTINGS_CONNECTION_FIXTURES.some((connection) => connection.health === "Reconnect needed")).toBe(true)
    expect(new Set(SETTINGS_CONNECTION_FIXTURES.map((connection) => connection.id)).size).toBe(
      SETTINGS_CONNECTION_FIXTURES.length,
    )
  })

  it("keeps the shell balance and billing balances on one fixture truth", () => {
    expect(
      SETTINGS_BILLING_FIXTURE.monthlyCredits + SETTINGS_BILLING_FIXTURE.purchasedCredits,
    ).toBe(REVIEW_ACCOUNT.balance)
    expect(REFERENCE).toContain("SETTINGS_BILLING_FIXTURE.monthlyCredits + purchasedCredits")
    expect(REFERENCE).toContain("onAddCredits={(amount) => setPurchasedCredits")
  })

  it("composes the formal shell, Otto panel and canonical primitives", () => {
    expect(REFERENCE).toContain('from "@/design-system/patterns/application-shell/ProductPatternShellFrame"')
    expect(REFERENCE).toContain('from "@/components/otto/panel/OttoPanelFlowReference"')
    expect(REFERENCE).toContain("<ProductPatternShellFrame")
    expect(REFERENCE).toContain("<OttoPanelFlowReference")
    for (const primitive of ["alert", "alert-dialog", "button", "dialog", "input", "label", "toast"]) {
      expect(REFERENCE).toContain(`@/design-system/primitives/${primitive}`)
    }
  })

  it("keeps controls on the design system and coral reserved for Otto", () => {
    expect(REFERENCE).not.toMatch(/<button\b|<select\b|<input\b/)
    expect(REFERENCE).not.toMatch(/border-brand|bg-brand|text-brand/)
    expect(REFERENCE).not.toMatch(/rounded-(?:xl|2xl)/)
  })

  it("implements the selected inspector flow without backend claims", () => {
    for (const evidence of [
      "Changes affect everyone in this workspace.",
      "Add connection",
      "Change account",
      "Manage access",
      "Reconnect",
      "Disconnect",
      "Monthly credits",
      "Purchased credits",
      "useSearchParams",
      "routeSearchParams",
      "useRouter",
      "router.push",
      "router.replace",
      "Workspace access",
      "Change payment method",
      "Invoices",
      "Credit usage",
      "setDisconnectOpen(false)",
      "Preview only",
    ]) expect(REFERENCE).toContain(evidence)
    for (const falseAction of [
      "Payment changes are disabled",
      "No real invoices",
      "Usage rows are outside",
      "Access controls are fixed",
    ]) expect(REFERENCE).not.toContain(falseAction)
    expect(REFERENCE).not.toMatch(/localStorage|fetch\(|server action|startCheckout|oauth/)
  })

  it("uses router-aware links so URL, content and browser history stay synchronized", () => {
    expect(REFERENCE).toContain('import Link from "next/link"')
    expect(REFERENCE).toContain("settingsSectionReviewHref(")
    expect(REFERENCE).toContain("scroll={false}")
    expect(REFERENCE).not.toContain("window.history")
    expect(REFERENCE).not.toContain("pushState")
    expect(REFERENCE).not.toContain("replaceState")
  })
})
