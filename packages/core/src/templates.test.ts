import { describe, it, expect } from "vitest";
import {
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_CAPTION_LANGUAGES,
  TEMPLATE_INDUSTRIES,
  RECOMMEND_LIMIT_MAX,
  buildTemplatePrompt,
  templateRunCredits,
  templateCategories,
  templateById,
  templateCaptions,
  filterTemplates,
  recommendTemplates,
  resolveTemplateIndustry,
  type Template,
} from "./templates.js";
import { GEN_IMAGE_ASPECTS } from "./gen.js";
import { redactProviderNames } from "./provider-secrecy.js";

/** Every merchant-visible or model-visible string a template carries. */
function templateText(t: Template): string {
  return [
    t.name,
    t.description,
    t.promptTemplate,
    t.question?.label ?? "",
    t.question?.placeholder ?? "",
    ...t.captions.map((c) => c.text),
  ].join(" \n ");
}

describe("TEMPLATES catalog shape", () => {
  it("carries dozens of scenarios with unique ids", () => {
    // #783 asked for "几十个" one-tap scenarios; this floor is the promise, not a guess.
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  it("every template has a real name, description, category and prompt", () => {
    for (const t of TEMPLATES) {
      expect(t.name.length, t.id).toBeGreaterThan(0);
      expect(t.description.length, t.id).toBeGreaterThan(0);
      expect(t.promptTemplate.length, t.id).toBeGreaterThan(30);
      expect(t.needsImage, t.id).toBe(true);
      expect(TEMPLATE_CATEGORIES).toContain(t.category);
    }
  });

  it("industries and tags come from the closed vocabularies", () => {
    for (const t of TEMPLATES) {
      expect(t.industries.length, t.id).toBeGreaterThan(0);
      for (const i of t.industries) expect(TEMPLATE_INDUSTRIES, `${t.id}: ${i}`).toContain(i);
      expect(t.tags.length, t.id).toBeGreaterThanOrEqual(3);
      for (const tag of t.tags) expect(tag, t.id).toBe(tag.toLowerCase());
    }
  });

  it("has {q} in the prompt iff the template has a question", () => {
    for (const t of TEMPLATES) {
      expect(t.promptTemplate.includes("{q}"), t.id).toBe(Boolean(t.question));
    }
  });

  it("a template that draws the merchant's words must ask for them", () => {
    for (const t of TEMPLATES) {
      if (!t.rendersHeadline) continue;
      expect(t.question, t.id).toBeTruthy();
      // The wording that buys correct spelling — a garbled headline is worse than no image.
      expect(t.promptTemplate, t.id).toContain("spelled exactly as given");
    }
  });

  it("templates that do NOT render a headline never ask the model for lettering", () => {
    for (const t of TEMPLATES) {
      if (t.rendersHeadline) continue;
      expect(t.promptTemplate.toLowerCase(), t.id).not.toContain("render the exact");
    }
  });

  it("declared aspect ratios are all on the engine's menu", () => {
    for (const t of TEMPLATES) {
      if (!t.aspectRatio) continue;
      expect(GEN_IMAGE_ASPECTS as readonly string[], t.id).toContain(t.aspectRatio);
    }
  });
});

describe("template content is Malaysian and merchant-safe", () => {
  it("covers the Malaysian commerce calendar", () => {
    const tags = new Set(TEMPLATES.flatMap((t) => t.tags));
    for (const occasion of [
      "raya",
      "cny",
      "deepavali",
      "christmas",
      "merdeka",
      "ramadan",
      "mid-autumn",
      "gawai",
      "11.11",
    ]) {
      expect(tags, occasion).toContain(occasion);
    }
  });

  it("covers every category with more than one scenario", () => {
    for (const category of TEMPLATE_CATEGORIES) {
      const inCategory = TEMPLATES.filter((t) => t.category === category);
      expect(inCategory.length, category).toBeGreaterThanOrEqual(5);
    }
  });

  it("names no generation provider anywhere a merchant can see", () => {
    for (const t of TEMPLATES) {
      const text = templateText(t);
      expect(redactProviderNames(text), t.id).toBe(text);
    }
  });

  it("carries no price or credit literal — money comes from the central config", () => {
    for (const t of TEMPLATES) {
      const text = templateText(t);
      expect(text, t.id).not.toMatch(/\bRM\s*\d/i);
      expect(text, t.id).not.toMatch(/\$\s*\d/);
      expect(text, t.id).not.toMatch(/\d+\s*credits?\b/i);
    }
  });
});

describe("captions", () => {
  it("every template ships an English and a Bahasa Melayu caption", () => {
    for (const t of TEMPLATES) {
      expect(templateCaptions(t, "en").length, t.id).toBeGreaterThan(0);
      expect(templateCaptions(t, "ms").length, t.id).toBeGreaterThan(0);
      for (const c of t.captions) expect(TEMPLATE_CAPTION_LANGUAGES, t.id).toContain(c.language);
    }
  });

  it("reaches the Chinese-speaking merchant segment too", () => {
    const withChinese = TEMPLATES.filter((t) => templateCaptions(t, "zh").length > 0);
    expect(withChinese.length).toBeGreaterThanOrEqual(6);
  });

  it("uses the same placeholders in every language, so one find-and-replace covers all", () => {
    const allowed = new Set(["[your product]", "[price]", "[date]", "[shop name]"]);
    for (const t of TEMPLATES) {
      for (const c of t.captions) {
        for (const found of c.text.match(/\[[^\]]+\]/g) ?? []) {
          expect(allowed, `${t.id}/${c.language}`).toContain(found);
        }
      }
    }
  });
});

describe("buildTemplatePrompt", () => {
  it("fills {q} with the trimmed answer", () => {
    const t = templateById("remove-object")!;
    expect(buildTemplatePrompt(t, "  the logo  ")).toBe(
      "remove the the logo from the image and fill the area naturally, photorealistic",
    );
  });
  it("returns the template verbatim when there is no question (ignores any answer)", () => {
    const t = templateById("remove-bg")!;
    expect(buildTemplatePrompt(t, "anything")).toBe(t.promptTemplate);
    expect(buildTemplatePrompt(t)).toBe(t.promptTemplate);
  });
});

describe("templateRunCredits", () => {
  it("is 1 credit for a single image", () => {
    expect(templateRunCredits()).toBe(1);
  });
});

describe("templateCategories", () => {
  it("returns each category once, in catalog order", () => {
    const cats = templateCategories();
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats).toEqual([...TEMPLATE_CATEGORIES]);
  });
});

describe("resolveTemplateIndustry", () => {
  it("understands how a Malaysian merchant describes the shop", () => {
    expect(resolveTemplateIndustry("nasi lemak stall")).toBe("food-drink");
    expect(resolveTemplateIndustry("mamak in Bangi")).toBe("food-drink");
    expect(resolveTemplateIndustry("hijab boutique")).toBe("fashion");
    expect(resolveTemplateIndustry("kedai runcit")).toBe("grocery");
    expect(resolveTemplateIndustry("bengkel kereta")).toBe("automotive");
    expect(resolveTemplateIndustry("tadika")).toBe("kids-education");
  });
  it("prefers the longest alias, so a compound phrase is not mis-read", () => {
    expect(resolveTemplateIndustry("phone accessories shop")).toBe("electronics");
    expect(resolveTemplateIndustry("car wash")).toBe("automotive");
  });
  it("returns null on nothing recognisable", () => {
    expect(resolveTemplateIndustry("")).toBeNull();
    expect(resolveTemplateIndustry(null)).toBeNull();
    expect(resolveTemplateIndustry("zzz qqq")).toBeNull();
  });
});

describe("recommendTemplates", () => {
  it("puts the industry's own scenarios first", () => {
    const out = recommendTemplates({ industry: "kopitiam", limit: 5 });
    expect(out.length).toBe(5);
    expect(out.every((t) => t.industries.includes("food-drink"))).toBe(true);
  });

  it("matches the occasion the merchant named", () => {
    const out = recommendTemplates({ occasion: "Hari Raya", limit: 3 });
    expect(out.map((t) => t.id).some((id) => id.startsWith("raya-"))).toBe(true);
    expect(out[0]!.tags).toContain("raya");
  });

  it("combines industry and occasion", () => {
    const ids = recommendTemplates({ industry: "bakery", occasion: "Chinese New Year", limit: 3 })
      .map((t) => t.id);
    expect(ids.filter((id) => id.startsWith("cny-")).length).toBe(2);
  });

  it("keeps calendar-bound scenarios out of the way until an occasion is named", () => {
    const noOccasion = recommendTemplates({ industry: "kopitiam", limit: 5 });
    expect(noOccasion.every((t) => t.category !== "Festivals & seasons")).toBe(true);
    const withOccasion = recommendTemplates({ industry: "kopitiam", occasion: "Ramadan", limit: 3 });
    expect(withOccasion.map((t) => t.id)).toContain("ramadan-bazar");
  });

  it("understands a marketplace ask in the merchant's own words", () => {
    const out = recommendTemplates({ query: "I need a main image for my Shopee listing", limit: 3 });
    expect(out[0]!.id).toBe("marketplace-main-image");
  });

  it("falls back to the general-purpose templates when nothing matches", () => {
    const out = recommendTemplates({ industry: "zzz", occasion: "zzz", limit: 4 });
    expect(out.length).toBe(4);
    expect(out.every((t) => t.industries.includes("any"))).toBe(true);
  });

  it("caps the limit and never returns nothing", () => {
    expect(recommendTemplates({ limit: 999 }).length).toBeLessThanOrEqual(RECOMMEND_LIMIT_MAX);
    expect(recommendTemplates({ limit: 0 }).length).toBe(1);
    expect(recommendTemplates().length).toBeGreaterThan(0);
  });

  it("is deterministic — same input, same order", () => {
    const a = recommendTemplates({ industry: "salon", occasion: "Deepavali" }).map((t) => t.id);
    const b = recommendTemplates({ industry: "salon", occasion: "Deepavali" }).map((t) => t.id);
    expect(a).toEqual(b);
  });
});

describe("filterTemplates", () => {
  it("filters by category", () => {
    const out = filterTemplates(TEMPLATES, { category: "Food & drink" });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((t) => t.category === "Food & drink")).toBe(true);
  });
  it("treats 'All' and empty as no filter", () => {
    expect(filterTemplates(TEMPLATES, { category: "All" }).length).toBe(TEMPLATES.length);
    expect(filterTemplates(TEMPLATES, {}).length).toBe(TEMPLATES.length);
  });
  it("searches name, description, category and tags", () => {
    expect(filterTemplates(TEMPLATES, { search: "angpau" }).map((t) => t.id)).toContain("cny-angpau");
    expect(filterTemplates(TEMPLATES, { search: "BAZAAR" }).map((t) => t.id)).toContain("ramadan-bazar");
    expect(filterTemplates(TEMPLATES, { search: "zzzz" })).toEqual([]);
  });
  it("combines category and search", () => {
    const out = filterTemplates(TEMPLATES, { category: "Marketplace listings", search: "bundle" });
    expect(out.map((t) => t.id)).toEqual(["marketplace-bundle"]);
  });
});
