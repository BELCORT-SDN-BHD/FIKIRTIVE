import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineOttoSkill, deriveNeedsApproval } from "./skill.js";

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
});
