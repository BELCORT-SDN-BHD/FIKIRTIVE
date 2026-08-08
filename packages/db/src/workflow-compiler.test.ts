import { describe, expect, it, vi } from "vitest";
import {
  canonicalHash,
  canonicalJson,
  compileWorkflowSource,
  parseWorkflowSource,
  WORKFLOW_COMPILER_VERSION,
  WORKFLOW_MAX_SOURCE_BYTES,
  WORKFLOW_MAX_STEPS,
  type ResolvedWorkflowDependency,
  type WorkflowDependencyResolver,
} from "./workflow-compiler.js";

const SOURCE = `version: fikirtive-workflow/v1
name: Outside-hours reply
trigger:
  type: customer_message
conditions:
  - type: outside_business_hours
    policyRef: bhp_opaque
steps:
  - key: reply_once
    action:
      type: conversation_reply
      templateVersionRef: tmplv_opaque
  - key: finish
    action:
      type: complete
`;

const RESOLVED: Record<string, ResolvedWorkflowDependency> = {
  "business_hours_policy:bhp_opaque": {
    ownerId: "org_a",
    kind: "business_hours_policy",
    resourceId: "bhp_exact_1",
    resourceRevision: 3,
    contentHash: "policy:v3:abc123",
  },
  "customer_message_template_version:tmplv_opaque": {
    ownerId: "org_a",
    kind: "customer_message_template_version",
    resourceId: "tmplv_exact_7",
    resourceRevision: 7,
    contentHash: "template:v7:def456",
  },
};

function resolver(overrides: Partial<Record<string, ResolvedWorkflowDependency>> = {}): WorkflowDependencyResolver {
  const rows = { ...RESOLVED, ...overrides };
  return async ({ kind, sourceRef }) => rows[`${kind}:${sourceRef}`] ?? null;
}

describe("canonical JSON and hashes", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalJson({ z: 1, a: { y: true, b: [2, 1] } })).toBe('{"a":{"b":[2,1],"y":true},"z":1}');
  });

  it("domain-separates deterministic SHA-256 hashes", () => {
    const value = { b: 2, a: 1 };
    expect(canonicalHash("domain-a", value)).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalHash("domain-a", value)).toBe(canonicalHash("domain-a", { a: 1, b: 2 }));
    expect(canonicalHash("domain-a", value)).not.toBe(canonicalHash("domain-b", value));
  });

  it("rejects non-JSON and prototype-sensitive values", () => {
    expect(() => canonicalJson({ value: undefined })).toThrow(/JSON/);
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/finite/);
    expect(() => canonicalJson(new Date())).toThrow(/plain/);
    expect(() => canonicalJson(JSON.parse('{"__proto__":1}'))).toThrow(/forbidden/);
  });
});

describe("restricted workflow YAML parser", () => {
  it("parses only the frozen envelope and canonicalizes key order/comments", () => {
    const first = parseWorkflowSource(SOURCE);
    const reordered = parseWorkflowSource(`# harmless full-line comment
name: Outside-hours reply
steps:
  - key: reply_once
    action:
      templateVersionRef: tmplv_opaque
      type: conversation_reply
  - key: finish
    action:
      type: complete
conditions:
  - policyRef: bhp_opaque
    type: outside_business_hours
trigger:
  type: customer_message
version: fikirtive-workflow/v1
`);
    expect(first.ok).toBe(true);
    expect(reordered.ok).toBe(true);
    if (first.ok && reordered.ok) expect(reordered.canonicalSourceJson).toBe(first.canonicalSourceJson);
  });

  it.each([
    ["duplicate key", SOURCE.replace("name: Outside-hours reply", "name: One\nname: Two")],
    ["anchor", SOURCE.replace("Outside-hours reply", "&name Outside-hours reply")],
    ["alias", SOURCE.replace("Outside-hours reply", "*name")],
    ["tag", SOURCE.replace("Outside-hours reply", "!unsafe value")],
    ["multi-document", `${SOURCE}\n---\n${SOURCE}`],
    ["merge key", SOURCE.replace("  type: customer_message", "  type: customer_message\n  <<: *defaults")],
    ["expression", SOURCE.replace("Outside-hours reply", "${{ dangerous }}")],
    ["script action", SOURCE.replace("type: complete", "type: script")],
    ["script key", SOURCE.replace("  type: customer_message", "  type: customer_message\n  script: run")],
    ["unknown root", `${SOURCE}ownerId: org_b\n`],
    ["unknown nested key", SOURCE.replace("    policyRef: bhp_opaque", "    policyRef: bhp_opaque\n    latest: true")],
    ["wrong nesting", SOURCE.replace("  type: customer_message", "    type: customer_message")],
    ["flow mapping", SOURCE.replace("trigger:\n  type: customer_message", "trigger: { type: customer_message }")],
    ["block scalar", SOURCE.replace("name: Outside-hours reply", "name: |\n  arbitrary script")],
    ["tab indentation", SOURCE.replace("  type: customer_message", "\ttype: customer_message")],
  ])("rejects %s", (_label, source) => {
    const result = parseWorkflowSource(source);
    expect(result).toMatchObject({ ok: false, validationState: "invalid" });
  });

  it.each(["current", "latest", "https://example.test/policy", "+60123456789"])(
    "rejects non-opaque policy ref %s",
    (policyRef) => {
      expect(parseWorkflowSource(SOURCE.replace("bhp_opaque", policyRef))).toMatchObject({ ok: false });
    },
  );

  it("rejects oversized source, too many conditions, steps, and duplicate step keys", () => {
    expect(parseWorkflowSource("x".repeat(WORKFLOW_MAX_SOURCE_BYTES + 1))).toMatchObject({
      ok: false,
      errors: [{ code: "SOURCE_TOO_LARGE" }],
    });
    const step = `  - key: step_KEY\n    action:\n      type: complete\n`;
    const tooMany = `version: fikirtive-workflow/v1\nname: Many\ntrigger:\n  type: manual\nconditions: []\nsteps:\n${step.repeat(WORKFLOW_MAX_STEPS + 1)}`;
    expect(parseWorkflowSource(tooMany)).toMatchObject({ ok: false });
    const condition = `  - type: outside_business_hours\n    policyRef: bhp_opaque\n`;
    const tooManyConditions = `version: fikirtive-workflow/v1\nname: Many\ntrigger:\n  type: customer_message\nconditions:\n${condition.repeat(17)}steps:\n  - key: done\n    action:\n      type: complete\n`;
    expect(parseWorkflowSource(tooManyConditions)).toMatchObject({ ok: false });
    expect(parseWorkflowSource(SOURCE.replace("key: finish", "key: reply_once"))).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "DUPLICATE_STEP_KEY" })]),
    });
  });

  it("tells a rule with no steps apart from a rule with too many (#723)", () => {
    // Both used to be reported as LIMIT_EXCEEDED, so a rule holding ZERO steps was told it had
    // more steps than the limit allows. Following that sentence (delete steps) can only make it
    // worse, so the two states get their own codes and the panel can say what is actually wrong.
    const none = `version: fikirtive-workflow/v1\nname: Empty\ntrigger:\n  type: manual\nconditions: []\nsteps: []\n`;
    expect(parseWorkflowSource(none)).toMatchObject({
      ok: false,
      errors: [{ code: "EMPTY_STEPS", path: "$.steps" }],
    });

    const step = `  - key: step_key\n    action:\n      type: complete\n`;
    const tooMany = `version: fikirtive-workflow/v1\nname: Many\ntrigger:\n  type: manual\nconditions: []\nsteps:\n${step.repeat(WORKFLOW_MAX_STEPS + 1)}`;
    expect(parseWorkflowSource(tooMany)).toMatchObject({
      ok: false,
      errors: [{ code: "LIMIT_EXCEEDED", path: "$.steps" }],
    });
  });

  it("accepts every frozen trigger/action shape without inventing cadence or wait duration", () => {
    for (const trigger of ["manual", "schedule", "customer_message", "journey_due"]) {
      const source = `version: fikirtive-workflow/v1
name: Closed shapes
trigger:
  type: ${trigger}
conditions: []
steps:
  - key: broadcast
    action:
      type: broadcast_run
      templateVersionRef: tmplv_opaque
  - key: wait
    action:
      type: wait
  - key: done
    action:
      type: complete
`;
      expect(parseWorkflowSource(source).ok).toBe(true);
    }
  });
});

describe("workflow compiler dependencies and hashes", () => {
  it("passes server owner context to the resolver and emits exact sorted dependencies", async () => {
    const resolve = vi.fn(resolver());
    const result = await compileWorkflowSource({ ownerId: "org_a", source: SOURCE }, resolve);
    expect(result.ok).toBe(true);
    expect(resolve.mock.calls.map(([input]) => input)).toEqual([
      { ownerId: "org_a", kind: "business_hours_policy", sourceRef: "bhp_opaque" },
      { ownerId: "org_a", kind: "customer_message_template_version", sourceRef: "tmplv_opaque" },
    ]);
    if (!result.ok) return;
    expect(result.compilerVersion).toBe(WORKFLOW_COMPILER_VERSION);
    expect(result.dependencyManifestJson).toHaveLength(2);
    expect(result.canonicalCompiledRuleJson).toBe(canonicalJson(result.compiledRuleJson));
    expect(result.dependencyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain("org_a");
  });

  it("is deterministic for semantic source and resolver order", async () => {
    const one = await compileWorkflowSource({ ownerId: "org_a", source: SOURCE }, resolver());
    const two = await compileWorkflowSource({ ownerId: "org_a", source: SOURCE.replace(/\n/g, "\r\n") }, resolver());
    expect(one.ok && two.ok).toBe(true);
    if (one.ok && two.ok) {
      expect(two.canonicalCompiledRuleJson).toBe(one.canonicalCompiledRuleJson);
      expect(two.dependencyHash).toBe(one.dependencyHash);
      expect(two.contentHash).toBe(one.contentHash);
    }
  });

  it("changes dependencyHash and contentHash when an exact dependency hash changes", async () => {
    const before = await compileWorkflowSource({ ownerId: "org_a", source: SOURCE }, resolver());
    const changed = await compileWorkflowSource(
      { ownerId: "org_a", source: SOURCE },
      resolver({
        "business_hours_policy:bhp_opaque": { ...RESOLVED["business_hours_policy:bhp_opaque"]!, contentHash: "policy:v4:changed" },
      }),
    );
    expect(before.ok && changed.ok).toBe(true);
    if (before.ok && changed.ok) {
      expect(changed.dependencyHash).not.toBe(before.dependencyHash);
      expect(changed.contentHash).not.toBe(before.contentHash);
    }
  });

  it("deduplicates repeated refs in the manifest and resolver calls", async () => {
    const repeated = SOURCE.replace(
      "  - key: finish\n    action:\n      type: complete",
      "  - key: reply_again\n    action:\n      type: conversation_reply\n      templateVersionRef: tmplv_opaque",
    );
    const resolve = vi.fn(resolver());
    const result = await compileWorkflowSource({ ownerId: "org_a", source: repeated }, resolve);
    expect(result.ok).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(2);
    if (result.ok) expect(result.dependencyManifestJson).toHaveLength(2);
  });

  it("returns unavailable for missing, unreadable, cross-owner, or malformed dependencies", async () => {
    const cases: WorkflowDependencyResolver[] = [
      async () => null,
      async () => { throw new Error("database details must not leak"); },
      resolver({ "business_hours_policy:bhp_opaque": { ...RESOLVED["business_hours_policy:bhp_opaque"]!, ownerId: "org_b" } }),
      resolver({ "business_hours_policy:bhp_opaque": { ...RESOLVED["business_hours_policy:bhp_opaque"]!, resourceRevision: 0 } }),
    ];
    for (const resolve of cases) {
      const result = await compileWorkflowSource({ ownerId: "org_a", source: SOURCE }, resolve);
      expect(result).toMatchObject({ ok: false, validationState: "unavailable" });
      expect(JSON.stringify(result)).not.toMatch(/database details|org_b/);
    }
  });
});
