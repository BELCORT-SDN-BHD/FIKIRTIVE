import { describe, it, expect } from "vitest";
import { validateKnowledgeBase } from "./meta-expertise.js";
import type { MetaExpertiseKB } from "./meta-expertise.types.js";

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
