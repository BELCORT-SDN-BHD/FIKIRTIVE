import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { redactProviderNames } from "@fikirtive/core/provider-secrecy";
import { TEMPLATES as CORE_TEMPLATES } from "@fikirtive/core/templates";
import {
  TEMPLATES,
  buildTemplatePrompt,
  templateRunCredits,
  templateCategories,
  filterTemplates,
} from "../templates";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PANEL = path.join(REPO_ROOT, "apps/web/components/otto/OttoTemplates.tsx");
const MODAL = path.join(REPO_ROOT, "apps/web/components/otto/TemplateModal.tsx");

// The catalog itself is proved in packages/core/src/templates.test.ts. This file proves the
// APP side of #783: the panel and the modal read that one catalog, and nothing about it was
// quietly forked on the way into the browser.

describe("the app reads the shared catalog, not a copy", () => {
  it("re-exports the very same array core owns", () => {
    expect(TEMPLATES).toBe(CORE_TEMPLATES);
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(30);
  });

  it("keeps the helpers the panel and modal call", () => {
    expect(typeof buildTemplatePrompt).toBe("function");
    expect(typeof templateRunCredits).toBe("function");
    expect(templateRunCredits()).toBe(1);
    expect(templateCategories(TEMPLATES).length).toBeGreaterThan(1);
    expect(filterTemplates(TEMPLATES, { search: "raya" }).length).toBeGreaterThan(0);
  });

  it("defines no template data of its own", () => {
    const shim = fs.readFileSync(path.join(REPO_ROOT, "apps/web/lib/templates.ts"), "utf8");
    expect(shim).not.toContain("promptTemplate:");
    expect(shim).toContain("@fikirtive/core/templates");
  });
});

describe("template names and questions fit the panel", () => {
  it("names stay short and unpunctuated", () => {
    for (const t of TEMPLATES) {
      expect(t.name.length, t.id).toBeLessThanOrEqual(40);
      expect(t.name.endsWith("."), t.id).toBe(false);
      expect(t.name, t.id).not.toBe(t.name.toUpperCase());
    }
  });

  it("every question has a label and a worked example", () => {
    for (const t of TEMPLATES) {
      if (!t.question) continue;
      expect(t.question.label.length, t.id).toBeGreaterThan(0);
      expect(t.question.placeholder.startsWith("e.g. "), t.id).toBe(true);
    }
  });
});

describe("the Templates panel", () => {
  const src = fs.readFileSync(PANEL, "utf8");

  it("browses the whole library by category and by search", () => {
    expect(src).toContain("templateCategories");
    expect(src).toContain("filterTemplates");
    expect(src).toContain('aria-label="Search templates"');
    expect(src).toContain("aria-pressed");
  });

  it("keeps its own template list — it never hardcodes one", () => {
    expect(src).not.toContain("promptTemplate");
    expect(src).toContain('from "@/lib/templates"');
  });
});

describe("the template run", () => {
  const src = fs.readFileSync(MODAL, "utf8");

  it("sends the scenario's own shape when it declares one", () => {
    // A marketplace main image is square and a story is tall; a template without an
    // aspectRatio must keep inheriting the uploaded photo's shape (today's behaviour).
    expect(src).toContain("template.aspectRatio ? { aspectRatio: template.aspectRatio } : {}");
  });

  it("still charges one image per run, priced centrally", () => {
    expect(src).toContain("templateRunCredits()");
    expect(src).toContain("count: 1");
    expect(src).not.toMatch(/\bRM\s*\d/i);
  });

  it("hands the merchant the ready caption once the image is done", () => {
    expect(src).toContain("template.captions");
    expect(src).toContain("TEMPLATE_CAPTION_LANGUAGE_LABELS");
  });
});

describe("white label holds on both merchant-facing surfaces", () => {
  it("names no generation provider in the panel or the modal", () => {
    for (const file of [PANEL, MODAL]) {
      const src = fs.readFileSync(file, "utf8");
      expect(redactProviderNames(src), file).toBe(src);
    }
  });
});

describe("buildTemplatePrompt", () => {
  it("fills {q} with the trimmed answer", () => {
    const t = TEMPLATES.find((x) => x.id === "remove-object")!;
    expect(buildTemplatePrompt(t, "  the logo  ")).toBe(
      "remove the the logo from the image and fill the area naturally, photorealistic",
    );
  });
  it("returns the template verbatim when there is no question (ignores any answer)", () => {
    const t = TEMPLATES.find((x) => x.id === "remove-bg")!;
    expect(buildTemplatePrompt(t, "anything")).toBe(t.promptTemplate);
    expect(buildTemplatePrompt(t)).toBe(t.promptTemplate);
  });
});
