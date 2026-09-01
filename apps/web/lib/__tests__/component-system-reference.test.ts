import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const WEB_ROOT = path.resolve(__dirname, "../..")

function source(file: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, file), "utf8")
}

describe("Phase 1B component-library reference", () => {
  const referencePath = "app/design-system/components/ComponentSystemReference.tsx"

  it("keeps components separate from the approved foundations reference", () => {
    const foundations = source("app/design-system/DesignSystemReference.tsx")
    const reference = source(referencePath)

    expect(foundations).toContain('data-scope="foundations-only"')
    expect(reference).toContain('data-scope="component-library-only"')
    expect(reference).not.toMatch(/Dashboard|Otto flow|Canvas screen|Library workspace/)
  })

  it("shows the finite component categories and state contract", () => {
    const reference = source(referencePath)

    for (const category of [
      "Actions",
      "Forms and selection",
      "Navigation",
      "Feedback and status",
      "Data and structure",
      "Overlays",
    ]) {
      expect(reference).toContain(`title="${category}"`)
    }

    for (const state of ["Default", "Filled", "Invalid", "Disabled", "Loading"]) {
      expect(reference).toContain(state)
    }
  })

  it("renders real shared components instead of local lookalikes", () => {
    const reference = source(referencePath)

    for (const component of [
      "Button",
      "Field",
      "Select",
      "Tabs",
      "Alert",
      "Card",
      "Dialog",
      "Sheet",
      "Popover",
      "Tooltip",
    ]) {
      expect(reference).toContain(`<${component}`)
    }
  })

  it("shows the completed extended primitive set as interactive shared components", () => {
    const reference = source(referencePath)

    for (const component of ["Accordion", "Calendar", "Carousel", "Pagination", "RadioGroup"]) {
      expect(reference).toContain(`<${component}`)
    }

    for (const file of ["accordion", "calendar", "carousel", "pagination", "radio-group"]) {
      expect(fs.existsSync(path.join(WEB_ROOT, `components/ui/${file}.tsx`))).toBe(true)
    }
  })

  it("keeps Otto coral scoped to explicit Otto ownership", () => {
    const reference = source(referencePath)

    expect(reference).toContain('variant="otto"')
    expect(reference).toContain('variant="otto-soft"')
    expect(reference).not.toContain('variant="brand"')
  })

  it("keeps Base UI as the shadcn primitive base", () => {
    const config = JSON.parse(source("components.json")) as { style?: string }
    const packageJson = source("package.json")
    const uiDirectory = path.join(WEB_ROOT, "components/ui")
    const uiSources = fs
      .readdirSync(uiDirectory)
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => source(`components/ui/${file}`))
      .join("\n")

    expect(config.style).toBe("base-nova")
    expect(packageJson).toContain('"@base-ui/react"')
    expect(packageJson).not.toContain('"radix-ui"')
    expect(packageJson).not.toContain('"sonner"')
    expect(uiSources).not.toMatch(/from ["']radix-ui["']/)
    expect(uiSources).not.toMatch(/from ["']sonner["']/)
  })
})
