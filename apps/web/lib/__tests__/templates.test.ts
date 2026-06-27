import { describe, it, expect } from "vitest";
import { TEMPLATES, buildTemplatePrompt, templateRunCredits } from "../templates";

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

describe("templateRunCredits", () => {
  it("is 1 credit for a single image", () => {
    expect(templateRunCredits()).toBe(1);
  });
});

describe("TEMPLATES catalog", () => {
  it("has 4 entries with unique ids and non-empty name/promptTemplate", () => {
    expect(TEMPLATES).toHaveLength(4);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(4);
    for (const t of TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.promptTemplate.length).toBeGreaterThan(0);
      expect(t.needsImage).toBe(true);
    }
  });
  it("has {q} in the prompt iff the template has a question", () => {
    for (const t of TEMPLATES) {
      expect(t.promptTemplate.includes("{q}")).toBe(Boolean(t.question));
    }
  });
});
