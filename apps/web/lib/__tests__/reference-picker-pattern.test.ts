import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const component = readFileSync("design-system/patterns/reference-picker/ReferencePickerReference.tsx", "utf8")
const fixtures = readFileSync("design-system/patterns/reference-picker/fixtures.ts", "utf8")
const route = readFileSync("app/product-patterns/reference-picker/page.tsx", "utf8")
const authority = JSON.parse(readFileSync("design-system/authority.json", "utf8")) as { current: Record<string, string> }

describe("Otto Reference picker review pattern", () => {
  it("covers the frozen browse taxonomy", () => {
    for (const label of ["Products", "Characters", "Official avatars", "Locations", "Clothes", "Media"]) {
      expect(component).toContain(`\"${label}\"`)
    }
  })

  it("keeps the important accessibility and keyboard contracts visible", () => {
    expect(component).toContain('role="listbox"')
    expect(component).toContain('role="option"')
    expect(component).toContain('aria-activedescendant')
    expect(component).toContain('event.key === "ArrowDown"')
    expect(component).toContain('event.key === "ArrowUp"')
    expect(component).toContain('event.key === "Escape"')
    expect(component).toContain('event.key === "Tab"')
  })

  it("shows honest read-only, empty and unavailable states", () => {
    expect(fixtures).toContain("Official avatar · Read only")
    expect(component).toContain("No references found")
    expect(component).toContain("unavailableReason")
    expect(component).toContain("Browse Library")
  })

  it("uses one registered design-system pattern and a review-only route", () => {
    expect(route).toContain("ReferencePickerReference")
    expect(authority.current.referencePicker).toBe("apps/web/design-system/patterns/reference-picker")
  })
})
