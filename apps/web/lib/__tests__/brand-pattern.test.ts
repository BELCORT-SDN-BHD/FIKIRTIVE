import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { BRAND_CONTEXT_FIXTURES } from "@/design-system/patterns/brand/fixtures"
import { BRAND_SECTIONS, isBrandSectionKey, sectionLabel } from "@/design-system/patterns/brand/model"
import { BRAND_REVIEW_HREF, brandSectionReviewHref } from "@/design-system/patterns/brand/review-links"

const WEB_ROOT = path.resolve(__dirname, "../..")
const PATTERN_ROOT = path.join(WEB_ROOT, "design-system/patterns/brand")
const REFERENCE = fs.readFileSync(path.join(PATTERN_ROOT, "BrandReference.tsx"), "utf8")
const README = fs.readFileSync(path.join(PATTERN_ROOT, "README.md"), "utf8")
const ROUTE = fs.readFileSync(path.join(WEB_ROOT, "app/product-patterns/brand/page.tsx"), "utf8")
const AUTHORITY = JSON.parse(fs.readFileSync(path.join(WEB_ROOT, "design-system/authority.json"), "utf8")) as {
  current: Record<string, string>
}

describe("Brand / Otto IQ product pattern", () => {
  it("keeps the frozen Brand taxonomy in one deterministic registry", () => {
    expect(BRAND_SECTIONS.map((section) => section.label)).toEqual([
      "Brand voice",
      "Audiences",
      "Knowledge base",
      "Style guide",
      "Visual guidelines",
    ])
    expect(isBrandSectionKey("brand-voice")).toBe(true)
    expect(isBrandSectionKey("overview")).toBe(false)
    expect(sectionLabel("audiences")).toBe("Audiences")
    expect(Object.keys(BRAND_CONTEXT_FIXTURES)).toEqual(BRAND_SECTIONS.map((section) => section.key))
  })

  it("records the Founder-selected visual and canonical pattern owner", () => {
    expect(README).toContain("Founder approved and frozen")
    expect(README).toContain("latest一组 Option 1".replace("latest", "最新"))
    expect(README).toContain("scan first, details on demand")
    expect(fs.existsSync(path.join(PATTERN_ROOT, "selected-direction.png"))).toBe(true)
    expect(AUTHORITY.current.brandPattern).toBe("apps/web/design-system/patterns/brand")
  })

  it("uses a thin route with query-backed section state", () => {
    expect(BRAND_REVIEW_HREF).toBe("/product-patterns/brand")
    expect(brandSectionReviewHref("audiences")).toBe("/product-patterns/brand?section=audiences")
    expect(ROUTE).toContain('from "@/design-system/patterns/brand/BrandReference"')
    expect(ROUTE).toContain("isBrandSectionKey(section)")
    expect(ROUTE).not.toMatch(/auth\(|fetch\(|force-dynamic/)
  })

  it("composes the formal shell, Otto panel and canonical primitives", () => {
    expect(REFERENCE).toContain('from "@/design-system/patterns/application-shell/ProductPatternShellFrame"')
    expect(REFERENCE).toContain('from "@/components/otto/panel/OttoPanelFlowReference"')
    expect(REFERENCE).toContain("<ProductPatternShellFrame")
    expect(REFERENCE).toContain("pathname={SHELL_ROUTES.brand}")
    expect(REFERENCE).toContain("<OttoPanelFlowReference")
    for (const primitive of ["accordion", "button", "dialog", "input", "label", "tabs", "textarea", "toast"]) {
      expect(REFERENCE).toContain(`@/design-system/primitives/${primitive}`)
    }
  })

  it("keeps controls on the design system and coral reserved for Otto", () => {
    expect(REFERENCE).not.toMatch(/<button\b|<select\b/)
    expect(REFERENCE).not.toMatch(/border-brand|bg-brand|text-brand/)
    expect(REFERENCE).not.toMatch(/rounded-(?:xl|2xl)/)
    expect(REFERENCE).not.toMatch(/text-\[\d+px\]/)
  })

  it("implements the selected progressive-disclosure flow without persistence claims", () => {
    for (const evidence of [
      "Evidence",
      "Usage",
      "Instructions",
      "Change history",
      "Preview effect",
      "Without context",
      "With context",
      "Text",
      "URL",
      "File",
      "updateSectionRoute",
      "popstate",
      "Preview only",
      "{sectionLabel(section)}",
      "STATUS_ART[selected.status]",
    ]) expect(REFERENCE).toContain(evidence)
    expect(REFERENCE).not.toMatch(/localStorage|fetch\(|server action|saveContext|persistContext/)
  })

  it("serves Otto status art from the canonical vector masters", () => {
    for (const name of ["otto-thinking.svg", "otto-approving.svg", "otto-success.svg"]) {
      const delivery = path.join(WEB_ROOT, "public/brand", name)
      const master = path.join(WEB_ROOT, "design-system/brand/otto", name)
      expect(fs.lstatSync(delivery).isSymbolicLink(), name).toBe(true)
      expect(fs.realpathSync(delivery), name).toBe(fs.realpathSync(master))
    }
  })
})
