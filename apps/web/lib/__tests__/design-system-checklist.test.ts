import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");

function source(file: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, file), "utf8");
}

describe("Phase 1C design-system checklist closure", () => {
  const reference = source("app/design-system/checklist/ChecklistReference.tsx");

  it("maps the four public checklist areas to a Fikirtive decision matrix", () => {
    for (const section of ["Design language", "Foundations", "Components", "Maintenance"]) {
      expect(reference).toContain(`name: "${section}"`);
    }

    expect(reference).toContain("https://www.designsystemchecklist.com/");
    expect(reference).toContain('data-scope="design-system-checklist"');
  });

  it("uses explicit status decisions with no remaining deferred work", () => {
    for (const status of ["ready", "needs-work", "later", "not-applicable"]) {
      expect(reference).toContain(`\"${status}\"`);
    }

    expect(reference).toContain("0 current blockers");
    expect(reference).toContain("Founder approved");
    expect(reference).toContain("24 decisions");
    expect(reference).toContain("Accordion, Calendar, Carousel, Pagination, and Radio");
    expect(reference).toContain("The design system checklist is complete.");
  });

  it("keeps product patterns outside the foundation and component stages", () => {
    expect(reference).toMatch(/name: "Product-specific compositions"[\s\S]*?status: "not-applicable"/);
    expect(reference).toContain("Dashboard, Otto conversation, work cards, and full-screen Canvas");
  });

  it("records internationalization, expanded primitives, and adoption reporting as ready", () => {
    for (const item of [
      "Internationalization guidance",
      "Extended primitives",
      "Usage analytics and adoption reporting",
    ]) {
      expect(reference).toMatch(new RegExp(`name: "${item}"[\\s\\S]*?status: "ready"`));
    }

    const packageJson = source("package.json");
    expect(packageJson).toContain('"design-system:audit": "node scripts/design-system-usage.mjs"');

    for (const component of ["accordion", "calendar", "carousel", "pagination", "radio-group"]) {
      expect(fs.existsSync(path.join(WEB_ROOT, `components/ui/${component}.tsx`))).toBe(true);
    }
  });

  it("documents the previously missing breakpoint, layer, and iconography evidence", () => {
    const foundations = source("app/design-system/DesignSystemReference.tsx");
    const globals = source("app/globals.css");

    expect(foundations).toContain("Responsive breakpoints");
    expect(foundations).toContain("Layer order");
    expect(foundations).toContain('title="Iconography"');
    expect(foundations).toContain('title="Internationalization"');

    for (const token of [
      "--z-dropdown",
      "--z-tooltip",
      "--z-drawer",
      "--z-modal",
      "--z-toast",
    ]) {
      expect(globals).toContain(token);
    }
  });

  it("links the component checkpoint to the closure review", () => {
    const components = source("app/design-system/components/ComponentSystemReference.tsx");
    expect(components).toContain('href="/design-system/checklist"');
    expect(components).toContain("Review readiness");
  });
});
