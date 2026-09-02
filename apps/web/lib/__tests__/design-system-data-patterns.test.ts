import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const WEB_ROOT = path.resolve(__dirname, "../..");
const reference = readFileSync(path.join(WEB_ROOT, "app/design-system/DesignSystemReference.tsx"), "utf8");
const globals = readFileSync(path.join(WEB_ROOT, "app/globals.css"), "utf8");
const brand = JSON.parse(
  readFileSync(path.resolve(WEB_ROOT, "../../docs/brand/colors.json"), "utf8"),
) as { semantic: { bad: string } };

describe("Phase 1A design foundations", () => {
  it("keeps the Founder review surface strictly foundations-only", () => {
    expect(reference).toContain('data-scope="foundations-only"');

    for (const section of [
      "Principles",
      "Color",
      "Typography",
      "Spacing and layout",
      "Shape and depth",
      "Motion",
      "Accessibility",
      "Voice and grammar",
    ]) {
      expect(reference).toContain(`title="${section}"`);
    }

    for (const deferred of [
      "Application shell language",
      "Library workspace language",
      "Otto panel language",
      "Otto work card language",
      "Canvas node language",
      "Data & state patterns",
    ]) {
      expect(reference).not.toContain(deferred);
    }
  });

  it("does not smuggle component or product-pattern galleries into Phase 1A", () => {
    expect(reference).not.toContain("ComponentCard");
    // The focus sample reuses the canonical Button; it is not a component gallery.
    const primitiveImports = Array.from(
      reference.matchAll(/from ["']@\/(?:components\/ui|design-system\/primitives)\/([^"']+)["']/g),
      (match) => match[1],
    );
    expect(primitiveImports).toEqual(["button"]);
    expect(reference).toContain("Focus preview");
    expect(reference).toContain("Review focus");
    expect(reference).not.toMatch(/<button\b/);
    expect(reference).not.toContain("ResearchCard");
    expect(reference).not.toContain("PackCard");
    expect(reference).not.toContain("recharts");
  });

  it("documents the active light and dark product-neutral themes", () => {
    expect(reference).toContain('data-theme={dark ? "dark" : "light"}');
    expect(reference).toContain("Product chrome uses one cold neutral family");
    expect(reference).toContain("Warm paper and gradients are not app chrome.");
  });

  it("locks typography, spacing, radius, motion, and focus at the token root", () => {
    for (const token of [
      "--text-display:",
      "--text-title:",
      "--text-heading:",
      "--text-body:",
      "--text-caption:",
      "--text-mono-meta:",
      "--radius: 0.625rem",
      "--radius-card: 0.75rem",
      "--radius-modal: 1rem",
      "--dur-1: 120ms",
      "--dur-2: 150ms",
      "--dur-3: 200ms",
      "--ease-standard: cubic-bezier(0.25, 0.1, 0.25, 1)",
      "--ease-out: cubic-bezier(0.23, 1, 0.32, 1)",
      "--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)",
      "--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)",
      "--ease-linear: linear",
    ]) {
      expect(globals).toContain(token);
    }

    expect(globals).toContain("--ring: #16171C");
    expect(globals).toContain("--border:#262629; --input:#262629; --ring:#FAFAFA;");
    expect(reference).toContain("Easing by purpose");
    expect(reference).toContain("Keyboard activation stays instant.");
    expect(reference).toContain("Remove spatial movement while retaining useful color and opacity feedback.");
    expect(globals).toContain("transition-property: color, background-color, border-color, box-shadow, opacity !important");
    expect(globals).toContain("transition-timing-function: var(--ease-standard) !important");
  });

  it("keeps coral owned by Fikirtive and Otto with accessible pairings", () => {
    expect(globals).toContain("--brand: #EC5828");
    expect(globals).toContain("--brand-ink: #2B1308");
    expect(globals).toContain("--color-brand-ink: var(--brand-ink)");
    expect(reference).toContain("Coral identifies Fikirtive and Otto");
    expect(reference).toContain('ratio="5.00:1"');
  });

  it("keeps semantic red and success text contrast aligned with the rendered tokens", () => {
    expect(brand.semantic.bad).toBe("#D02F35");
    expect(globals).toContain("--error:   #D02F35");
    expect(globals).toContain("--success-soft-foreground: #147A3A");
  });
});
