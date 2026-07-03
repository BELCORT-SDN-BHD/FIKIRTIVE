import { describe, it, expect } from "vitest";
import { validateKnowledgeBase, queryMetaKnowledge, getBenchmark } from "./meta-expertise.js";
import type { MetaExpertiseKB } from "./meta-expertise.js";

const cite = { url: "https://www.facebook.com/business/help/x", title: "Meta Help", retrievedAt: "2026-07-03" };

function kb(entries: MetaExpertiseKB["entries"]): MetaExpertiseKB {
  return { version: "2026-07-03", entries, sources: [cite] };
}

describe("validateKnowledgeBase", () => {
  it("passes a well-formed entry", () => {
    const errs = validateKnowledgeBase(kb([
      { id: "ctr-benchmark-traffic", domain: "measurement", claim: "CTR benchmark for traffic ads.", citations: [cite] },
    ]));
    expect(errs).toEqual([]);
  });

  it("flags an entry with no citation (fabrication risk)", () => {
    const errs = validateKnowledgeBase(kb([
      { id: "no-cite", domain: "creative", claim: "Some claim.", citations: [] },
    ]));
    expect(errs.some((e) => /no-cite/.test(e) && /citation/i.test(e))).toBe(true);
  });

  it("flags an empty claim", () => {
    const errs = validateKnowledgeBase(kb([
      { id: "empty", domain: "creative", claim: "   ", citations: [cite] },
    ]));
    expect(errs.some((e) => /empty/.test(e) && /claim/i.test(e))).toBe(true);
  });

  it("flags duplicate ids", () => {
    const errs = validateKnowledgeBase(kb([
      { id: "dup", domain: "creative", claim: "A.", citations: [cite] },
      { id: "dup", domain: "bidding", claim: "B.", citations: [cite] },
    ]));
    expect(errs.some((e) => /duplicate/i.test(e) && /dup/.test(e))).toBe(true);
  });

  it("flags a non-http citation url", () => {
    const errs = validateKnowledgeBase(kb([
      { id: "bad-url", domain: "creative", claim: "A.", citations: [{ url: "ftp://x", title: "t", retrievedAt: "2026-07-03" }] },
    ]));
    expect(errs.some((e) => /bad-url/.test(e) && /url/i.test(e))).toBe(true);
  });
});

const KBX: MetaExpertiseKB = {
  version: "2026-07-03",
  sources: [cite],
  entries: [
    { id: "ctr-traffic", domain: "measurement", claim: "Traffic CTR benchmark.",
      benchmark: { metric: "CTR", objective: "traffic", range: "0.9%–1.6%" }, citations: [cite] },
    { id: "ctr-traffic-ecom", domain: "measurement", claim: "Ecom traffic CTR benchmark.",
      benchmark: { metric: "CTR", objective: "traffic", industry: "ecommerce", range: "1.0%–2.0%" }, citations: [cite] },
    { id: "roas-conv", domain: "measurement", claim: "Conversion ROAS context.",
      benchmark: { metric: "ROAS", objective: "conversions", range: "2x–4x" }, citations: [cite] },
    { id: "hook-3s", domain: "creative", claim: "Hook in first 3 seconds.", citations: [cite] },
  ],
};

describe("queryMetaKnowledge", () => {
  it("filters by domain", () => {
    expect(queryMetaKnowledge(KBX, { domain: "creative" }).map((e) => e.id)).toEqual(["hook-3s"]);
  });
  it("filters by metric (case-insensitive) on the benchmark", () => {
    expect(queryMetaKnowledge(KBX, { metric: "ctr" }).map((e) => e.id).sort()).toEqual(["ctr-traffic", "ctr-traffic-ecom"]);
  });
  it("ANDs metric + objective", () => {
    expect(queryMetaKnowledge(KBX, { metric: "ROAS", objective: "conversions" }).map((e) => e.id)).toEqual(["roas-conv"]);
  });
});

describe("getBenchmark", () => {
  it("prefers industry+objective match over objective-only", () => {
    expect(getBenchmark(KBX, { metric: "CTR", objective: "traffic", industry: "ecommerce" })?.id).toBe("ctr-traffic-ecom");
  });
  it("falls back to objective-only when no industry match", () => {
    expect(getBenchmark(KBX, { metric: "CTR", objective: "traffic", industry: "saas" })?.id).toBe("ctr-traffic");
  });
  it("returns null when the metric is unknown", () => {
    expect(getBenchmark(KBX, { metric: "frequency" })).toBeNull();
  });
});
