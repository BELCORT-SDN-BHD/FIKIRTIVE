import { describe, expect, it } from "vitest";
import {
  buildVipSegmentRules,
  compileSegmentPhrase,
  contactMatchesRules,
  validateSegmentRuleGroup,
  type SegmentContactFacts,
  type SegmentRuleGroup,
} from "./segment-rules.js";

const NOW = { evaluatedAt: "2026-07-15T00:00:00Z" };

function compiled(phrase: string): SegmentRuleGroup {
  const result = compileSegmentPhrase(phrase);
  if (!result.ok) throw new Error(`expected compiled rules, got ${result.reason}`);
  return result.rules;
}

describe("compileSegmentPhrase", () => {
  it("compiles all five leaf families into visible, serializable rules", () => {
    expect(
      compiled(
        "Lifetime spend at least RM500 and last order within 90 days and channel is WhatsApp and tag is Wholesale and contactable",
      ),
    ).toEqual({
      match: "all",
      rules: [
        { kind: "lifetime_spend", comparison: "at_least", amountMyr: 500 },
        { kind: "last_order_recency", withinDays: 90 },
        { kind: "channel", channel: "whatsapp" },
        { kind: "tag", tag: "wholesale" },
        { kind: "contactability", value: "contactable" },
      ],
    });
  });

  it("supports one-level any groups and preserves strict spend semantics", () => {
    expect(compiled("lifetime spend more than RM1,000 or not contactable")).toEqual({
      match: "any",
      rules: [
        { kind: "lifetime_spend", comparison: "more_than", amountMyr: 1000 },
        { kind: "contactability", value: "not_contactable" },
      ],
    });
  });

  it("normalizes case and whitespace deterministically", () => {
    const a = compileSegmentPhrase(" Channel is WhatsApp   AND   tag is Wholesale ");
    const b = compileSegmentPhrase("channel is whatsapp and tag is wholesale");
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("fails the whole phrase on mixed joins, nesting, unknown clauses, or duplicates", () => {
    expect(compileSegmentPhrase("channel is whatsapp and tag is wholesale or contactable")).toMatchObject({
      ok: false,
      reason: "ambiguous_join",
    });
    expect(compileSegmentPhrase("(channel is whatsapp or tag is wholesale) and contactable")).toMatchObject({
      ok: false,
      reason: "unsupported_structure",
    });
    expect(compileSegmentPhrase("channel is whatsapp and customers who love us")).toEqual({
      ok: false,
      normalizedPhrase: "channel is whatsapp and customers who love us",
      reason: "unrecognized_clause",
      uncompiledClauses: ["customers who love us"],
    });
    expect(compileSegmentPhrase("contactable and contactable")).toMatchObject({
      ok: false,
      reason: "duplicate_clause",
    });
    expect(compileSegmentPhrase("VIP customers")).toMatchObject({
      ok: false,
      reason: "unrecognized_clause",
    });
  });
});

describe("validateSegmentRuleGroup", () => {
  it("accepts exactly one all/any level and rejects nested or malformed rules", () => {
    expect(validateSegmentRuleGroup(compiled("channel is whatsapp or tag is wholesale"))).toMatchObject({ ok: true });

    expect(
      validateSegmentRuleGroup({
        match: "all",
        rules: [{ match: "any", rules: [{ kind: "contactability", value: "contactable" }] }],
      }),
    ).toMatchObject({ ok: false });
    expect(validateSegmentRuleGroup({ match: "all", rules: [] })).toMatchObject({ ok: false });
    expect(
      validateSegmentRuleGroup({
        match: "all",
        rules: [{ kind: "last_order_recency", withinDays: 0 }],
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("contactMatchesRules", () => {
  const complete: SegmentContactFacts = {
    lifetimeSpendMyr: 750,
    lastOrderAt: "2026-06-20T00:00:00Z",
    channels: ["whatsapp", "instagram"],
    tags: ["wholesale", "regular"],
    marketingConsent: "opt_in",
    doNotDisturb: false,
  };

  it("matches each leaf family and applies all/any semantics", () => {
    expect(contactMatchesRules(complete, compiled("lifetime spend at least RM500"), NOW)).toBe(true);
    expect(contactMatchesRules(complete, compiled("lifetime spend more than RM750"), NOW)).toBe(false);
    expect(contactMatchesRules(complete, compiled("last order within 30 days"), NOW)).toBe(true);
    expect(contactMatchesRules(complete, compiled("channel is whatsapp"), NOW)).toBe(true);
    expect(contactMatchesRules(complete, compiled("tag is wholesale"), NOW)).toBe(true);
    expect(contactMatchesRules(complete, compiled("contactable"), NOW)).toBe(true);
    expect(contactMatchesRules(complete, compiled("channel is email or tag is wholesale"), NOW)).toBe(true);
    expect(contactMatchesRules(complete, compiled("channel is email and tag is wholesale"), NOW)).toBe(false);
  });

  it("recomputes the same result from the same explicit inputs", () => {
    const rules = compiled("last order within 30 days and tag is wholesale");
    const first = contactMatchesRules(complete, rules, NOW);
    const second = contactMatchesRules(complete, rules, NOW);

    expect(first).toBe(true);
    expect(second).toBe(first);
  });

  it("fails closed when lastOrderAt or tags are absent and never consults lastSeenAt", () => {
    const recency = compiled("last order within 30 days");
    const tag = compiled("tag is wholesale");
    const noOrder = {
      ...complete,
      lastOrderAt: undefined,
      lastSeenAt: "2026-07-15T00:00:00Z",
    } as SegmentContactFacts & { lastSeenAt: string };
    const staleLastSeen = {
      ...noOrder,
      lastSeenAt: "2020-01-01T00:00:00Z",
    } as SegmentContactFacts & { lastSeenAt: string };

    expect(contactMatchesRules(noOrder, recency, NOW)).toBe(false);
    expect(contactMatchesRules(staleLastSeen, recency, NOW)).toBe(false);
    expect(contactMatchesRules({ ...complete, tags: undefined }, tag, NOW)).toBe(false);
  });

  it("requires explicit, valid consent facts for both contactability outcomes", () => {
    const canMessage = compiled("contactable");
    const cannotMessage = compiled("not contactable");
    expect(contactMatchesRules({ ...complete, marketingConsent: "unknown" }, canMessage, NOW)).toBe(false);
    expect(contactMatchesRules({ ...complete, doNotDisturb: true }, canMessage, NOW)).toBe(false);
    expect(contactMatchesRules({ ...complete, doNotDisturb: true }, cannotMessage, NOW)).toBe(true);
    expect(contactMatchesRules({ ...complete, marketingConsent: undefined }, cannotMessage, NOW)).toBe(false);
    expect(contactMatchesRules({ ...complete, doNotDisturb: undefined }, cannotMessage, NOW)).toBe(false);
  });

  it("fails closed on invalid groups, facts, or evaluation time", () => {
    const recency = compiled("last order within 30 days");
    expect(contactMatchesRules({ ...complete, lifetimeSpendMyr: Number.NaN }, compiled("lifetime spend at least RM1"), NOW)).toBe(false);
    expect(contactMatchesRules({ ...complete, lastOrderAt: "yesterday" }, recency, NOW)).toBe(false);
    expect(contactMatchesRules(complete, recency, { evaluatedAt: "today" })).toBe(false);
    expect(
      contactMatchesRules(
        complete,
        { match: "all", rules: [{ match: "any", rules: [] }] } as unknown as SegmentRuleGroup,
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects impossible calendar dates without rejecting leap days or offsets", () => {
    const oneDay = compiled("last order within 1 day");

    expect(
      contactMatchesRules(
        { ...complete, lastOrderAt: "2026-02-30T00:00:00Z" },
        oneDay,
        { evaluatedAt: "2026-03-03T00:00:00Z" },
      ),
    ).toBe(false);
    expect(
      contactMatchesRules(
        { ...complete, lastOrderAt: "2026-03-01T00:00:00Z" },
        oneDay,
        { evaluatedAt: "2026-02-30T00:00:00Z" },
      ),
    ).toBe(false);
    expect(
      contactMatchesRules(
        { ...complete, lastOrderAt: "2024-02-29T00:00:00Z" },
        oneDay,
        { evaluatedAt: "2024-03-01T00:00:00Z" },
      ),
    ).toBe(true);
    expect(
      contactMatchesRules(
        { ...complete, lastOrderAt: "2026-07-15T08:00:00+08:00" },
        oneDay,
        { evaluatedAt: "2026-07-15T00:00:00Z" },
      ),
    ).toBe(true);
  });
});

describe("buildVipSegmentRules", () => {
  it("requires caller-provided configuration and changes matching when configuration changes", () => {
    const facts: SegmentContactFacts = {
      lifetimeSpendMyr: 600,
      lastOrderAt: "2026-06-20T00:00:00Z",
    };
    const permissive = buildVipSegmentRules({ vipMinSpendMyr: 550, vipRecentOrderDays: 30 });
    const strict = buildVipSegmentRules({ vipMinSpendMyr: 650, vipRecentOrderDays: 30 });

    expect(permissive).toEqual({
      match: "all",
      rules: [
        { kind: "lifetime_spend", comparison: "at_least", amountMyr: 550 },
        { kind: "last_order_recency", withinDays: 30 },
      ],
    });
    expect(contactMatchesRules(facts, permissive, NOW)).toBe(true);
    expect(contactMatchesRules(facts, strict, NOW)).toBe(false);
    expect(() => buildVipSegmentRules({ vipMinSpendMyr: -1, vipRecentOrderDays: 30 })).toThrow();
    expect(() => buildVipSegmentRules({ vipMinSpendMyr: 550, vipRecentOrderDays: 0 })).toThrow();
  });
});

describe("@fikirtive/core root barrel", () => {
  it("exports the pure segment foundation", async () => {
    const core = await import("./index.js");
    expect(core).toHaveProperty("compileSegmentPhrase");
    expect(core).toHaveProperty("contactMatchesRules");
    expect(core).toHaveProperty("buildVipSegmentRules");
  });
});
