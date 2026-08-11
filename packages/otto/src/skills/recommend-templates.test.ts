import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { TEMPLATES, templateById } from "@fikirtive/core/templates";
import {
  executeRecommendTemplates,
  recommendTemplatesSkill,
  templateForModel,
} from "./recommend-templates.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext } from "../context.js";

const ctx = { context: {} as OttoContext } as Pick<RunContext<OttoContext>, "context">;

type Reply = {
  ok: boolean;
  count?: number;
  templates?: { id: string; prompt?: string; askFirst?: string; captions: { language: string }[] }[];
  askUserFirst?: string;
  nextStep?: string;
  error?: string;
};

describe("recommendTemplates gate", () => {
  it("is a free internal read — it never needs approval", () => {
    expect(recommendTemplatesSkill.cost).toBe("free");
    expect(recommendTemplatesSkill.effect).toBe("read");
    expect(recommendTemplatesSkill.reach).toBe("internal");
    expect(recommendTemplatesSkill.needsApproval).toBe(false);
  });

  it("takes no identity field from the model", () => {
    // defineOttoSkill throws at definition time on an identity key, so importing this module at
    // all is half the proof; the other half is that nobody adds one back in a later edit.
    const src = readFileSync(new URL("./recommend-templates.ts", import.meta.url), "utf8");
    for (const forbidden of ["orgId", "ownerId", "userId", "tenantId"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it("refuses to run without an Otto context", async () => {
    await expect(
      executeRecommendTemplates({}, undefined as unknown as Pick<RunContext<OttoContext>, "context">),
    ).rejects.toThrow(/OttoContext required/);
  });
});

describe("recommendTemplates reads the ONE shared library", () => {
  it("returns ids that exist in the merchant-facing catalog", async () => {
    const out = (await executeRecommendTemplates({ industry: "kopitiam" }, ctx)) as Reply;
    expect(out.ok).toBe(true);
    expect(out.count).toBeGreaterThan(0);
    for (const t of out.templates!) expect(templateById(t.id)).not.toBeNull();
  });

  it("hands back the catalog's own prompt, not a rewrite", async () => {
    const out = (await executeRecommendTemplates({ templateId: "remove-bg" }, ctx)) as Reply;
    expect(out.templates![0]!.prompt).toBe(templateById("remove-bg")!.promptTemplate);
  });
});

describe("recommendTemplates matching", () => {
  it("recommends by the industry the merchant named", async () => {
    const out = (await executeRecommendTemplates({ industry: "nasi lemak stall", limit: 3 }, ctx)) as Reply;
    const ids = out.templates!.map((t) => t.id);
    expect(ids.every((id) => templateById(id)!.industries.includes("food-drink"))).toBe(true);
  });

  it("recommends by the occasion the merchant named", async () => {
    const out = (await executeRecommendTemplates({ occasion: "Hari Raya", limit: 3 }, ctx)) as Reply;
    expect(out.templates!.some((t) => t.id.startsWith("raya-"))).toBe(true);
  });

  it("respects the limit", async () => {
    const out = (await executeRecommendTemplates({ industry: "salon", limit: 2 }, ctx)) as Reply;
    expect(out.count).toBe(2);
  });
});

describe("recommendTemplates question handling", () => {
  it("asks the merchant first instead of returning a half-filled prompt", async () => {
    const out = (await executeRecommendTemplates({ templateId: "raya-sale" }, ctx)) as Reply;
    expect(out.askUserFirst).toBe(templateById("raya-sale")!.question!.label);
    expect(out.templates![0]!.prompt).toBeUndefined();
    expect(out.templates![0]!.askFirst).toBeTruthy();
  });

  it("fills the answer in once it has one", async () => {
    const out = (await executeRecommendTemplates(
      { templateId: "raya-sale", answer: "JUALAN RAYA 50%" },
      ctx,
    )) as Reply;
    expect(out.templates![0]!.prompt).toContain("JUALAN RAYA 50%");
    expect(out.templates![0]!.prompt).not.toContain("{q}");
  });

  it("says so plainly when the id does not exist", async () => {
    const out = (await executeRecommendTemplates({ templateId: "no-such-template" }, ctx)) as Reply;
    expect(out.ok).toBe(false);
    expect(out.error).toContain("no-such-template");
  });
});

describe("what the model is told", () => {
  it("routes making through propose, and never claims it generated anything", async () => {
    const out = (await executeRecommendTemplates({ industry: "bakery" }, ctx)) as Reply;
    expect(out.nextStep).toContain("propose");
    expect(out.nextStep).toContain("Nothing has been made or charged");
  });

  it("points the merchant at the panel they can use themselves", async () => {
    const out = (await executeRecommendTemplates({}, ctx)) as Reply;
    expect(out.nextStep).toContain("/otto?view=templates");
  });

  it("carries the ready captions by language", () => {
    const view = templateForModel(templateById("cny-prosperity")!) as {
      captions: { language: string }[];
    };
    expect(view.captions.map((c) => c.language)).toEqual(["en", "ms", "zh"]);
  });

  it("flags the templates that draw the merchant's own words", () => {
    const drawn = templateForModel(templateById("raya-sale")!, "JUALAN RAYA") as Record<string, unknown>;
    const notDrawn = templateForModel(templateById("remove-bg")!) as Record<string, unknown>;
    expect(drawn.drawsTheirWordsOnTheImage).toBe(true);
    expect(notDrawn.drawsTheirWordsOnTheImage).toBeUndefined();
  });
});

describe("this skill spends nothing and touches nothing", () => {
  it("makes no network call and reaches no provider port", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await executeRecommendTemplates({ industry: "kopitiam", occasion: "Ramadan" }, ctx);
    await executeRecommendTemplates({ templateId: "fnb-hero-dish" }, ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("imports no generation engine and no credit reservation", () => {
    const src = readFileSync(new URL("./recommend-templates.ts", import.meta.url), "utf8");
    expect(src).not.toContain("@fikirtive/generation");
    expect(src).not.toContain("reserveCredits");
    expect(src).not.toContain("prisma");
  });

  it("quotes no price — the credit cost stays with the paying surface", () => {
    const src = readFileSync(new URL("./recommend-templates.ts", import.meta.url), "utf8");
    expect(src).not.toContain("templateRunCredits");
    expect(src).not.toMatch(/\bRM\s*\d/i);
  });
});

describe("the library the skill exposes stays merchant-safe", () => {
  it("never returns a template the catalog does not carry", async () => {
    const all = new Set(TEMPLATES.map((t) => t.id));
    for (const probe of ["Hari Raya", "Deepavali", "11.11", "grand opening", "delivery"]) {
      const out = (await executeRecommendTemplates({ query: probe }, ctx)) as Reply;
      for (const t of out.templates!) expect(all).toContain(t.id);
    }
  });
});
