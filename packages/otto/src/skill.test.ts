import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineOttoSkill, deriveNeedsApproval, missingRequired, skillErrorCategory } from "./skill.js";

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

  it("throws when parameters contain identity synonyms", () => {
    expect(() =>
      defineOttoSkill({
        name: "tenant-leak", description: "d", cost: "free", effect: "read", reach: "internal",
        parameters: z.object({ tenantId: z.string(), accountId: z.string() }), execute: noop,
      }),
    ).toThrow(/tenantId, accountId/);
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

  it("ENGINE-A4:readOnlyActions 的判别键必须是 parameters 的一个 key(定义期就拦)", () => {
    expect(() =>
      defineOttoSkill({
        name: "badreadonly", description: "d", cost: "free", effect: "write", reach: "internal",
        parameters: z.object({ x: z.string() }),
        readOnlyActions: { field: "action", actions: ["view"] },
        execute: noop,
      }),
    ).toThrow(/readOnlyActions/);
  });

  it("ENGINE-A4:readOnlyActions 原样挂在 OttoSkill 上(未声明则为 null)", () => {
    const plain = defineOttoSkill({ ...base, name: "noreadonly", cost: "free", effect: "write", reach: "internal" });
    expect(plain.readOnlyActions).toBeNull();
    const declared = defineOttoSkill({
      name: "withreadonly", description: "d", cost: "free", effect: "write", reach: "internal",
      parameters: z.object({ action: z.enum(["view", "place"]) }),
      readOnlyActions: { field: "action", actions: ["view"] },
      execute: noop,
    });
    expect(declared.readOnlyActions).toEqual({ field: "action", actions: ["view"] });
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

describe("defineOttoSkill requires wiring", () => {
  const withReq = () =>
    defineOttoSkill({
      name: "reqskill", description: "Base description.", cost: "free", effect: "write", reach: "internal",
      parameters: z.object({ goal: z.string().optional() }),
      requires: [{ field: "goal", question: "What is the goal?" }],
      execute: async () => ({ ok: true, ran: true }),
    });

  it("appends the requires questions to the tool description (model-facing)", () => {
    const s = withReq();
    const desc = (s.tool as { description?: string }).description ?? "";
    expect(desc).toContain("Base description.");
    expect(desc).toContain("What is the goal?");
  });

  it("keeps OttoSkill.description clean (no appended questions)", () => {
    const s = withReq();
    expect(s.description).toBe("Base description.");
  });

  it("preflight: execute returns needMoreInfo and does NOT run when a required field is empty", async () => {
    const s = withReq();
    const invoke = s.tool as unknown as { invoke: (rc: unknown, args: string) => Promise<unknown> };
    const out = await invoke.invoke({ context: {} }, JSON.stringify({ goal: "" }));
    expect(out).toEqual({ needMoreInfo: [{ field: "goal", question: "What is the goal?" }] });
  });

  it("preflight: execute runs when required fields are present", async () => {
    const s = withReq();
    const invoke = s.tool as unknown as { invoke: (rc: unknown, args: string) => Promise<unknown> };
    const out = await invoke.invoke({ context: {} }, JSON.stringify({ goal: "drive signups" }));
    expect(out).toEqual({ ok: true, ran: true });
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
  it("non-string falsy values (0, false) count as present, not missing", () => {
    expect(missingRequired([{ field: "n", question: "?" }], { n: 0 })).toEqual([]);
    expect(missingRequired([{ field: "n", question: "?" }], { n: false })).toEqual([]);
  });
});

// ── #566 R2: the server log must never carry merchant content ────────────────
//
// The wrapper logs every skill failure so a broken gate can't run silently again (#566 ran five
// weeks with zero log lines). But skill failure messages routinely embed merchant-controlled text:
// packages/core/src/url-safety.ts throws `Invalid URL: "<the whole submitted URL>"` and
// `URL hostname "<host>" is not allowed`, and research-web puts the underlying exception message
// straight into its { error }. So a private customer domain, an internal service name, or a secret
// encoded in a subdomain or query string would otherwise be written to the log verbatim.
describe("skill failure logging carries no merchant content (#566 R2)", () => {
  /** A message shaped exactly like the reachable leak: real url-safety wording, secret payload. */
  const LEAKY = 'Invalid URL: "https://tenant-acme.internal.example.com/callback?token=SHHH-9f2a"';
  const SECRETS = ["tenant-acme", "internal.example.com", "SHHH-9f2a", "/callback", "token="];

  function captureConsole() {
    const lines: string[] = [];
    const record = (...args: unknown[]) => { lines.push(args.map((a) => String(a)).join(" ")); };
    const warn = console.warn;
    const error = console.error;
    console.warn = record;
    console.error = record;
    return { lines, restore: () => { console.warn = warn; console.error = error; } };
  }

  function invokerFor(execute: (input: { x: string }, rc: unknown) => Promise<unknown>) {
    const s = defineOttoSkill({
      ...base,
      name: "leakProbe",
      cost: "free",
      effect: "read",
      reach: "external",
      execute: execute as never,
    });
    return (s.tool as unknown as { invoke: (rc: unknown, args: string) => Promise<unknown> });
  }

  it("a THROWN error: the log names the skill and a category, never the message", async () => {
    const tool = invokerFor(async () => { throw new Error(LEAKY); });
    const cap = captureConsole();
    let out: unknown;
    try {
      out = await tool.invoke({ context: {} }, JSON.stringify({ x: "go" }));
    } finally {
      cap.restore();
    }
    const log = cap.lines.join("\n");
    expect(log).toContain("leakProbe");
    expect(log).toContain("category=Error");
    for (const secret of SECRETS) expect(log).not.toContain(secret);
    expect(log).not.toContain("Invalid URL");
    // Both halves of the contract, not just the log half: the merchant's reason is untouched —
    // the SDK folds the throw into the tool result the model reads and answers from.
    expect(String(out)).toContain("SHHH-9f2a");
  });

  // #566 R3 review: the earlier spoof case used LEAKY as the fake `name`, which carries punctuation
  // and so was rejected by the (now removed) shape regex — it never exercised a name that PASSED
  // validation. This is that case: a plausible identifier-shaped secret. The category must come from
  // the hardcoded class table, so a settable `.name` cannot smuggle anything into the log.
  it("a THROWN error with an identifier-shaped spoofed name: still logs the fixed category", async () => {
    const smuggled = "TenantSecret123";
    const tool = invokerFor(async () => {
      const e = new Error("harmless");
      e.name = smuggled; // Error.name is writable — shape validation would have accepted this
      throw e;
    });
    const cap = captureConsole();
    let out: unknown;
    try {
      out = await tool.invoke({ context: {} }, JSON.stringify({ x: "go" }));
    } finally {
      cap.restore();
    }
    const log = cap.lines.join("\n");
    expect(log).toContain("leakProbe");
    expect(log).toContain("category=Error");
    expect(log).not.toContain(smuggled);
    // The SDK does surface the spoofed name to the MODEL (observed: "Error: TenantSecret123:
    // harmless"). That is the conversation channel, which this change deliberately leaves alone;
    // the assertion above is that the LOG channel stays clean.
    expect(String(out)).toContain(smuggled);
  });

  it("a getter-supplied name is never invoked into the log either", async () => {
    const smuggled = "GetterLeak456";
    const tool = invokerFor(async () => {
      const e = new Error("harmless");
      Object.defineProperty(e, "name", { get: () => smuggled });
      throw e;
    });
    const cap = captureConsole();
    try {
      await tool.invoke({ context: {} }, JSON.stringify({ x: "go" }));
    } finally {
      cap.restore();
    }
    const log = cap.lines.join("\n");
    expect(log).toContain("category=Error");
    expect(log).not.toContain(smuggled);
  });

  it("a RETURNED { error }: same — the merchant still gets the reason, the log does not", async () => {
    const tool = invokerFor(async () => ({ error: LEAKY }));
    const cap = captureConsole();
    let out: unknown;
    try {
      out = await tool.invoke({ context: {} }, JSON.stringify({ x: "go" }));
    } finally {
      cap.restore();
    }
    const log = cap.lines.join("\n");
    expect(log).toContain("leakProbe");
    expect(log).toContain("category=string");
    for (const secret of SECRETS) expect(log).not.toContain(secret);
    // The reason is NOT suppressed — it still rides the tool result the model answers from.
    expect(JSON.stringify(out)).toContain("SHHH-9f2a");
  });

  it("a non-Error throw: the whole object is never stringified into the log", async () => {
    const tool = invokerFor(async () => { throw { hostname: "tenant-acme.internal.example.com", token: "SHHH-9f2a" }; });
    const cap = captureConsole();
    let out: unknown;
    try {
      out = await tool.invoke({ context: {} }, JSON.stringify({ x: "go" }));
    } finally {
      cap.restore();
    }
    const log = cap.lines.join("\n");
    expect(log).toContain("category=object");
    for (const secret of SECRETS) expect(log).not.toContain(secret);
    // Return-value half, recorded honestly: for a NON-Error throw the SDK's own default error
    // function stringifies the value, so the payload becomes "[object Object]" and never reaches
    // the model either. That is upstream SDK behaviour on a shape no production skill uses (they
    // all throw Errors or return { error }) — pinned here so a future SDK change is visible, NOT
    // presented as this change preserving the merchant's reason on this path.
    expect(String(out)).toContain("[object Object]");
    for (const secret of SECRETS) expect(String(out)).not.toContain(secret);
  });

  it("skillErrorCategory returns only hardcoded literals, never anything read off the value", () => {
    expect(skillErrorCategory(new Error(LEAKY))).toBe("Error");
    expect(skillErrorCategory(new TypeError(LEAKY))).toBe("TypeError");
    expect(skillErrorCategory(new RangeError(LEAKY))).toBe("RangeError");
    expect(skillErrorCategory(LEAKY)).toBe("string");
    expect(skillErrorCategory({ msg: LEAKY })).toBe("object");
    expect(skillErrorCategory(null)).toBe("null");
    expect(skillErrorCategory(undefined)).toBe("undefined");
    // A settable `.name` cannot smuggle content — not with punctuation…
    const punctuated = new Error("x");
    punctuated.name = LEAKY;
    expect(skillErrorCategory(punctuated)).toBe("Error");
    // …and not with an identifier shape that any regex would have waved through (R3 review).
    const identifierShaped = new Error("x");
    identifierShaped.name = "TenantSecret123";
    expect(skillErrorCategory(identifierShaped)).toBe("Error");
    // A getter is never invoked either.
    const viaGetter = new Error("x");
    Object.defineProperty(viaGetter, "name", { get: () => "GetterLeak456" });
    expect(skillErrorCategory(viaGetter)).toBe("Error");
    // A custom subclass collapses to the generic token rather than exposing its author-chosen name.
    class TenantScopedFailure extends Error {}
    expect(skillErrorCategory(new TenantScopedFailure("x"))).toBe("Error");
    // A spoofed name on a REAL built-in subclass still reports the built-in, from the table.
    const spoofedType = new TypeError("x");
    spoofedType.name = "TenantSecret123";
    expect(skillErrorCategory(spoofedType)).toBe("TypeError");
  });
});
