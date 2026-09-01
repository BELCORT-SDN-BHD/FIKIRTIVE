import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { INITIAL_QUOTE } from "../../design-system/patterns/canvas/fixtures"
import { autoNameProject, inferGenerationKind } from "../../design-system/patterns/canvas/model"
import { createWorkspaceReviewHref, newCanvasReviewHref } from "../../design-system/patterns/canvas/review-links"

const webRoot = path.resolve(__dirname, "../..")
const patternRoot = path.join(webRoot, "design-system/patterns/canvas")
const referencePath = path.join(patternRoot, "CanvasReference.tsx")
const createReferencePath = path.join(patternRoot, "CreateWorkspaceReference.tsx")
const readmePath = path.join(patternRoot, "README.md")
const specPath = path.join(patternRoot, "stitch-image-video-parity-spec.md")
const routePath = path.join(webRoot, "app/product-patterns/canvas/page.tsx")
const createRoutePath = path.join(webRoot, "app/product-patterns/create/page.tsx")

describe("Creation product pattern", () => {
  it("keeps project naming and exact price fixtures deterministic", () => {
    expect(autoNameProject("Create a Merdeka launch image")).toBe("Merdeka launch")
    expect(autoNameProject("Make a gifting visual")).toBe("Gift box launch")
    expect(autoNameProject("Make a product video")).toBe("Product video")
    expect(inferGenerationKind("Animate this product photo")).toBe("video")
    expect(inferGenerationKind("Create a campaign poster")).toBe("image")
    expect(inferGenerationKind("Make another direction", "video")).toBe("video")
    expect(INITIAL_QUOTE.title).toBe("Generate 4 product-photo directions")
    expect(INITIAL_QUOTE.credits).toBe(8)
  })

  it("records the approved R22 convergence spec as the current source of truth", () => {
    const readme = fs.readFileSync(readmePath, "utf8")
    const spec = fs.readFileSync(specPath, "utf8")
    expect(readme).toContain("stitch-image-video-parity-spec.md")
    expect(readme).toContain("是的。")
    expect(spec).toContain("Approved and frozen")
    expect(spec).toContain("R22 是当前视觉与空间实现基线")
    expect(spec).toContain("批准冻结 spec")
    expect(spec).toContain("first-class Create workspace amendment")
    expect(spec).toContain("Stitch-minimal interaction pass")
    expect(spec).toContain("Design-system convergence pass")
    expect(spec).toContain("是的。")
  })

  it("uses a thin fixture-only review route", () => {
    const source = fs.readFileSync(routePath, "utf8")
    expect(source).toContain("CanvasReference")
    expect(source).toContain('share === "selected"')
    expect(source).toContain('if (surface === "lab") redirect(createWorkspaceReviewHref(context))')
    expect(source).toContain('newProject={newProject === "1"}')
    expect(source).toContain("initialContext={context}")
    expect(source).not.toMatch(/force-dynamic|auth\(|fetch\(/)
  })

  it("routes Create as a first-class workspace before active work enters Canvas", () => {
    expect(createWorkspaceReviewHref()).toBe("/product-patterns/create")
    expect(createWorkspaceReviewHref("Review the strongest sales campaign")).toBe(
      "/product-patterns/create?context=Review+the+strongest+sales+campaign",
    )
    expect(newCanvasReviewHref({ prompt: "Create a launch image", mode: "image" })).toBe(
      "/product-patterns/canvas?new=1&prompt=Create+a+launch+image&mode=image",
    )
  })

  it("gives Create its own route and application-shell workspace", () => {
    const source = fs.readFileSync(createReferencePath, "utf8")
    const route = fs.readFileSync(createRoutePath, "utf8")
    expect(route).toContain("CreateWorkspaceReference")
    expect(source).toContain("ProductPatternShellFrame")
    expect(source).toContain('pathname={SHELL_ROUTES.create}')
    expect(source).toContain("Create with Otto")
    expect(source).toContain("Canvas history")
    expect(source).toContain("CreationComposer")
    expect(source).not.toContain("Marketing is growing efficiently")
    expect(source).not.toContain("STARTING_POINTS")
    expect(source).not.toContain("recent canvases")
  })

  it("does not import production generation, persistence or navigation", () => {
    const source = fs.readFileSync(referencePath, "utf8")
    expect(source).not.toMatch(/gen-actions|canvas-actions|account-actions|@\/lib\/data|@\/lib\/actions|next\/navigation|localStorage|fetch\(/)
    expect(source).toContain("Review fixture only")
  })

  it("uses the approved R22 workspace anatomy", () => {
    const source = fs.readFileSync(referencePath, "utf8")
    const composer = fs.readFileSync(path.join(patternRoot, "CreationComposer.tsx"), "utf8")
    const patternSource = `${source}\n${composer}`
    for (const label of [
      "Conversation",
      "Describe an image or video to create",
      "Saved just now",
      "Otto current turn",
      "Generation confirmation",
    ]) expect(patternSource).toContain(label)
    expect(source).toContain("I created four starting directions")
    expect(source).not.toContain("Batch · 4 images · 4:5 · 8 credits")
    expect(source).not.toContain("Featured templates")
    expect(source).not.toContain("Imagine history")
  })

  it("keeps one prompt-led omnibox with inferred media, attachment and selection context", () => {
    const source = fs.readFileSync(referencePath, "utf8")
    const composer = fs.readFileSync(path.join(patternRoot, "CreationComposer.tsx"), "utf8")
    expect(source).toContain("CreationComposer")
    expect(composer).toContain('aria-label="Otto creation prompt"')
    expect(composer).toContain('aria-label="Add a reference"')
    expect(source).toContain("inferGenerationKind")
    expect(composer).not.toContain('aria-pressed={mode === "image"}')
    expect(composer).not.toContain('aria-pressed={mode === "video"}')
    expect(source).toContain("Selected context")
    expect(composer).toContain("Upload image")
    expect(composer).toContain("Choose from Library")
  })

  it("keeps the programmatic upload input out of the keyboard and accessibility trees", () => {
    const composer = fs.readFileSync(path.join(patternRoot, "CreationComposer.tsx"), "utf8")
    expect(composer).toMatch(/<input\s+hidden\s+ref=\{uploadRef\}/)
    expect(composer).not.toContain('className="sr-only"')
  })

  it("supports current-turn questions and exact paid confirmation", () => {
    const source = fs.readFileSync(referencePath, "utf8")
    expect(source).toContain("Which product should lead this concept?")
    expect(source).toContain("Which format should Otto prepare first?")
    expect(source).toContain("Something else…")
    expect(source).toContain('"needs-answer"')
    expect(source).toContain('"needs-confirmation"')
    expect(source).toContain("questionStep")
    expect(source).toContain('answers.join(" · ")')
    expect(source).toContain("Generate · {turn.credits} credits")
    expect(source).toContain("0 credits while waiting")
    expect(source).toContain("Cancelled before generation started")
  })

  it("puts generation progress and actions on Canvas artifacts", () => {
    const source = fs.readFileSync(referencePath, "utf8")
    expect(source).toContain('status: "generating"')
    expect(source).toContain("Generating {artifact.kind}…")
    expect(source).toContain("Edit with Otto")
    expect(source).toContain("Create variations")
    expect(source).toContain("Animate")
    expect(source).toContain("Download")
  })

  it("supports non-destructive edit, variations, image-to-video and turn history", () => {
    const source = fs.readFileSync(referencePath, "utf8")
    expect(source).toContain("startEditWithOtto")
    expect(source).toContain("startVariations")
    expect(source).toContain("startAnimation")
    expect(source).toContain("setActiveTurnId")
    expect(source).toContain("place every version beside it")
  })

  it("restores functional Stitch spatial Canvas mechanics", () => {
    const source = fs.readFileSync(referencePath, "utf8")
    expect(source).toContain("data-canvas-artifact")
    expect(source).toContain("data-canvas-node")
    expect(source).toContain("INITIAL_NOTES")
    expect(source).toContain("beginNodeDrag")
    expect(source).toContain("moveNode")
    expect(source).toContain("setPointerCapture")
    expect(source).toContain("pointerSessionRef")
    expect(source).toContain('aria-label="Canvas board"')
    expect(source).toContain("ZoomInIcon")
    expect(source).toContain("activeTool")
    expect(source).toContain("radial-gradient")
  })

  it("returns to the Create workspace and keeps a chronological Stitch-style conversation dock", () => {
    const source = fs.readFileSync(referencePath, "utf8")
    expect(source).not.toContain("CreationLab")
    expect(source).not.toContain('surface === "lab"')
    expect(source).toContain('Back to Create')
    expect(source).toContain("CREATE_WORKSPACE_REVIEW_HREF")
    expect(source).toContain("chronologicalTurns")
    expect(source).not.toContain("My projects")
    expect(source).not.toContain("Shared with me")
  })

  it("keeps Canvas controls, surfaces, typography and motion on canonical design-system owners", () => {
    const sourceFiles = fs.readdirSync(patternRoot)
      .filter((fileName) => fileName.endsWith(".tsx"))
      .map((fileName) => fs.readFileSync(path.join(patternRoot, fileName), "utf8"))
    const patternSource = sourceFiles.join("\n")
    const composer = fs.readFileSync(path.join(patternRoot, "CreationComposer.tsx"), "utf8")

    expect(patternSource).not.toMatch(/<button\b/)
    expect(patternSource).not.toMatch(/<textarea\b/)
    expect(patternSource).not.toMatch(/rounded-(?:xl|2xl)/)
    expect(patternSource).not.toMatch(/text-\[\d+px\]/)
    expect(patternSource).not.toContain("tracking-[")
    expect(patternSource).not.toContain("duration-150")
    expect(patternSource).not.toContain(" ease-out")
    expect(patternSource).toContain("rounded-[var(--radius-card)]")
    expect(composer).toContain("InputGroupTextarea")
    expect(composer).toContain("InputGroupButton")
  })
})
