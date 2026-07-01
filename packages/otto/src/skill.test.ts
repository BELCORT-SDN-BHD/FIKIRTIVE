import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineOttoSkill, deriveNeedsApproval, missingRequired } from "./skill.js";

const noop = async () => ({ ok: true });
const base = {
  description: "test skill",
  parameters: z.object({ x: z.string() }),
  execute: noop,
};

describe("deriveNeedsApproval — the §2 truth table", () => {
  const T: Array<[("free"|"spend"),("read"|"write"),("internal"|"external"),boolean]> = [
    ["free", "write", "internal", false],   // rememberBrandFact / propose
    ["free", "read", "internal", false],    // describeRefs
    ["free", "read", "external", false],    // searchWeb — external READ is safe
    ["spend", "write", "internal", true],   // generate
    ["free", "write", "external", true],    // postToMeta — external WRITE
    ["spend", "read", "internal", true],    // any spend → approval
  ];
  it.each(T)("cost=%s effect=%s reach=%s → %s", (c, e, r, expected) => {
    expect(deriveNeedsApproval(c, e, r)).toBe(expected);
  });
});

describe("defineOttoSkill enforcement", () => {
  it("sets needsApproval (literal boolean) on the built tool for a gated skill", async () => {
    const s = defineOttoSkill({ ...base, name: "gated", cost: "spend", effect: "write", reach: "internal", idempotencyKey: () => "k" });
    expect(s.needsApproval).toBe(true);
    // The SDK normalizes the literal boolean into an async () => Promise<boolean>;
    // prove it RESOLVES to true (the money-safety gate), not merely truthy.
    expect(await (s.tool.needsApproval as () => Promise<boolean>)()).toBe(true);
  });

  it("free+internal skill is not gated", async () => {
    const s = defineOttoSkill({ ...base, name: "ungated", cost: "free", effect: "write", reach: "internal" });
    expect(s.needsApproval).toBe(false);
    // Symmetric: the SDK tool's normalized gate resolves to literal false.
    expect(await (s.tool.needsApproval as () => Promise<boolean>)()).toBe(false);
  });

  it("throws when parameters contain an identity key", () => {
    expect(() =>
      defineOttoSkill({
        name: "leak", description: "d", cost: "free", effect: "read", reach: "internal",
        parameters: z.object({ ownerId: z.string() }), execute: noop,
      }),
    ).toThrow(/must not include identity field/i);
  });

  it("throws when a spend skill declares no idempotencyKey", () => {
    expect(() =>
      defineOttoSkill({ ...base, name: "charge", cost: "spend", effect: "write", reach: "internal" }),
    ).toThrow(/idempotencyKey/i);
  });

  it("throws a fail-loud message when parameters is not a z.object schema", () => {
    expect(() =>
      defineOttoSkill({
        name: "bad", description: "d", cost: "free", effect: "read", reach: "internal",
        // @ts-expect-error — deliberately a non-object schema (a JS/as-any caller could do this)
        parameters: z.string(), execute: noop,
      }),
    ).toThrow(/must be a z\.object/i);
  });

  it("fail-closed: undefined classification is treated as most-dangerous (gated)", () => {
    // @ts-expect-error — deliberately omit cost/effect/reach to test the runtime backstop
    // idempotencyKey is required here because the fail-closed default makes cost "spend".
    const s = defineOttoSkill({ ...base, name: "unclassified", idempotencyKey: () => "k" });
    expect(s.needsApproval).toBe(true);
  });

  it("throws when a requires field is not a key in parameters", () => {
    expect(() =>
      defineOttoSkill({
        name: "badreq", description: "d", cost: "free", effect: "write", reach: "internal",
        parameters: z.object({ x: z.string() }),
        requires: [{ field: "audience", question: "Who is the audience?" }],
        execute: noop,
      }),
    ).toThrow(/requires field/i);
  });

  it("exposes requires on the built OttoSkill (empty array when omitted)", () => {
    const s = defineOttoSkill({ ...base, name: "noreq", cost: "free", effect: "write", reach: "internal" });
    expect(s.requires).toEqual([]);
    const s2 = defineOttoSkill({
      ...base, name: "withreq", cost: "free", effect: "write", reach: "internal",
      parameters: z.object({ x: z.string() }),
      requires: [{ field: "x", question: "What is x?" }],
    });
    expect(s2.requires).toEqual([{ field: "x", question: "What is x?" }]);
  });
});

describe("missingRequired — preflight logic", () => {
  const reqs = [
    { field: "goal", question: "What is the goal?" },
    { field: "audience", question: "Who is it for?" },
  ];
  it("flags absent and empty-string fields", () => {
    expect(missingRequired(reqs, {})).toEqual(reqs);
    expect(missingRequired(reqs, { goal: "  ", audience: "" })).toEqual(reqs);
  });
  it("passes when all fields are non-empty", () => {
    expect(missingRequired(reqs, { goal: "drive signups", audience: "gym-goers" })).toEqual([]);
  });
  it("flags only the missing subset", () => {
    expect(missingRequired(reqs, { goal: "sell shoes" })).toEqual([{ field: "audience", question: "Who is it for?" }]);
  });
  it("empty requires → nothing missing", () => {
    expect(missingRequired([], { anything: 1 })).toEqual([]);
  });
});
