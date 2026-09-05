import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CONTRACT_REFERENCE_TYPES } from "@fikirtive/core/reference-ref"

const component = readFileSync("design-system/patterns/reference-picker/ReferencePickerReference.tsx", "utf8")
const model = readFileSync("design-system/patterns/reference-picker/model.ts", "utf8")
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

  /**
   * FRONT-A10 — the fixture's taxonomy IS production's contract list, checked rather than claimed.
   *
   * `packages/core/src/reference-ref.ts` says the seven types are "mirrored verbatim from the
   * approved fixture". It could not check that itself: `packages/core` must not import from
   * `apps/web`, so its own test compares against a hand-copied literal — which drifts silently the
   * day someone edits the fixture. This test is the one that actually reads the fixture file, and
   * it lives here because apps/web is the side that owns it.
   */
  it("FRONT-A10 keeps the fixture taxonomy and the production contract type list identical", () => {
    const union = model.match(/export type ReferenceType =([\s\S]*?)\n\n/)?.[1] ?? ""
    const fixtureTypes = [...union.matchAll(/"([a-z-]+)"/g)].map((match) => match[1])

    // same members, same order, same count — a drift in any of the three fails here
    expect(fixtureTypes).toEqual([...CONTRACT_REFERENCE_TYPES])
    expect(fixtureTypes).toHaveLength(CONTRACT_REFERENCE_TYPES.length)
    for (const type of CONTRACT_REFERENCE_TYPES) expect(model).toContain(`"${type}"`)
  })

  it("uses one registered design-system pattern and a review-only route", () => {
    expect(route).toContain("ReferencePickerReference")
    expect(authority.current.referencePicker).toBe("apps/web/design-system/patterns/reference-picker")
  })
})
