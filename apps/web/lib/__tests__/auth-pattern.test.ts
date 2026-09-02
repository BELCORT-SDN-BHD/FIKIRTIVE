import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { AUTH_REVIEW_STEPS, isAuthReviewStep } from "@/design-system/patterns/auth/model"
import { AUTH_REVIEW_HREF, authReviewHref } from "@/design-system/patterns/auth/review-links"

const WEB_ROOT = path.resolve(__dirname, "../..")
const ROUTE = fs.readFileSync(path.join(WEB_ROOT, "app/product-patterns/auth/page.tsx"), "utf8")
const REFERENCE = fs.readFileSync(
  path.join(WEB_ROOT, "design-system/patterns/auth/AuthAccessJourneyReference.tsx"),
  "utf8",
)

describe("Auth access journey review pattern", () => {
  it("has one canonical review route and route-backed review steps", () => {
    expect(AUTH_REVIEW_HREF).toBe("/product-patterns/auth")
    expect(authReviewHref("hub")).toBe("/product-patterns/auth?from=%2Fcreate")
    expect(authReviewHref("code", "/library")).toBe(
      "/product-patterns/auth?step=code&from=%2Flibrary",
    )
    for (const step of AUTH_REVIEW_STEPS) expect(isAuthReviewStep(step)).toBe(true)
    expect(isAuthReviewStep("dashboard")).toBe(false)
  })

  it("keeps the review route outside the merchant shell and inside the Auth pattern", () => {
    expect(ROUTE).toContain("AuthAccessJourneyReference")
    expect(ROUTE).not.toContain("ProductPatternShellFrame")
    expect(REFERENCE).toContain("Review fixture · No account is accessed")
    expect(REFERENCE).not.toContain("SAML")
    expect(REFERENCE).not.toContain("passkey")
  })

  it("uses the shared design system and exposes every approved representative path", () => {
    for (const owner of [
      "@/components/auth/AuthPageShell",
      "@/components/auth/AuthStepCard",
      "@/components/ui/button",
      "@/components/ui/field",
      "@/components/ui/input",
      "@/components/ui/input-otp",
      "@/components/auth/PasswordInput",
    ]) {
      expect(REFERENCE).toContain(owner)
    }
    for (const copy of [
      "Continue with email",
      "Continue with Google",
      "Use password instead",
      "Forgot password?",
      "Create your account",
      "Continue with login code",
    ]) {
      expect(REFERENCE).toContain(copy)
    }
  })
})
