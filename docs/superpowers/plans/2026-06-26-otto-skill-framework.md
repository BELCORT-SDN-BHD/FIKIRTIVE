# Otto Skill Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Otto's informal per-tool "gate" convention with a fail-closed `defineOttoSkill()` factory + a registry + a dual-audience authoring standard, migrating the 5 existing tools as proof, with zero runtime behavior change.

**Architecture:** `defineOttoSkill()` is a build-time factory in `packages/otto/src/skill.ts`. It derives `needsApproval` from a 3-field declaration (`cost`/`effect`/`reach`), enforces fail-closed rules at definition time, and returns an `OttoSkill` object `{…meta, tool}` whose `.tool` is a plain `@openai/agents` `tool()` — byte-for-byte what Otto gets today. Each skill file **also** re-exports the bare `.tool` under its original name so existing imports/tests are unchanged. A `registry.ts` collects skills → `otto.tools` + metadata for a generated `CATALOG.md`. A `scripts/check-skill-imports.sh` tripwire (house pattern, like `check-no-raw-prisma.sh`) fences the spend/provider-bypass class. The `@openai/agents` runtime is untouched.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `@openai/agents@^0.11.8`, `zod@^4.4.3` (ZodObject `.shape` accessor), Vitest 3, pnpm workspaces (`@fikirtive/otto`).

## Global Constraints

- **Do NOT touch the agent runtime** (`@openai/agents` `run()`/`RunState`/approval engine).
- **Behavior-preserving.** `generate` must keep: `needsApproval` resolving to **literal `true`**, the `cardId`-only input, the `cowork:<cardId>` exactly-once guard, owner-scope by `ctx.orgId`. **`generate.test.ts`, `propose` tests, and the otto suite stay green UNMODIFIED.**
- **Do NOT touch money/generation internals.** `executeGenerate`, `ctx.startGen`, `reserveCredits`, `meter.ts`, the worker, and credit schema are off-limits. The factory wraps the *definition*, not the spend.
- **No new external network calls.** `searchWeb`/`postToMeta` are documentation examples only — NOT implemented.
- **ESM import specifiers** end in `.js` (e.g. `from "./skill.js"`). Match the existing files.
- **Identity never from the model.** Skill `parameters` must not contain `orgId`/`ownerId`/`userId`; identity comes from `ctx`.
- **Pinned:** `zod@^4.4.3` → read a ZodObject's keys via `.shape`. `@openai/agents@^0.11.8`.
- **Test command:** `pnpm --filter @fikirtive/otto test <file>` (runs `vitest run <file>`). Typecheck: `pnpm --filter @fikirtive/otto typecheck` (may require 总司令's real env per repo norms).

---

### Task 1: The `defineOttoSkill()` factory

**Files:**
- Create: `packages/otto/src/skill.ts`
- Test: `packages/otto/src/skill.test.ts`

**Interfaces:**
- Produces:
  - `type Cost = "free" | "spend"`, `type Effect = "read" | "write"`, `type Reach = "internal" | "external"`
  - `deriveNeedsApproval(cost: Cost, effect: Effect, reach: Reach): boolean`
  - `interface OttoSkill { name: string; cost: Cost; effect: Effect; reach: Reach; needsApproval: boolean; description: string; tool: ReturnType<typeof import("@openai/agents").tool> }`
  - `defineOttoSkill<P extends z.ZodObject<any>>(spec: OttoSkillSpec<P>): OttoSkill`
  - `interface OttoSkillSpec<P>` = `{ name; description; parameters: P; cost; effect; reach; execute: (input, runContext: RunContext<OttoContext>) => Promise<unknown>; idempotencyKey?: (input) => string }`

- [ ] **Step 1: Write the failing test**

Create `packages/otto/src/skill.test.ts`:

```ts
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
  it("sets needsApproval (literal boolean) on the built tool for a gated skill", () => {
    const s = defineOttoSkill({ ...base, name: "gated", cost: "spend", effect: "write", reach: "internal", idempotencyKey: () => "k" });
    expect(s.needsApproval).toBe(true);
    expect(s.tool.needsApproval).toBeTruthy();
  });

  it("free+internal skill is not gated", () => {
    const s = defineOttoSkill({ ...base, name: "ungated", cost: "free", effect: "write", reach: "internal" });
    expect(s.needsApproval).toBe(false);
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

  it("fail-closed: undefined classification is treated as most-dangerous (gated)", () => {
    // @ts-expect-error — deliberately omit cost/effect/reach to test the runtime backstop
    const s = defineOttoSkill({ ...base, name: "unclassified", idempotencyKey: () => "k" });
    expect(s.needsApproval).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/otto test src/skill.test.ts`
Expected: FAIL — `Cannot find module './skill.js'` / `defineOttoSkill is not a function`.

- [ ] **Step 3: Write the factory**

Create `packages/otto/src/skill.ts`:

```ts
/**
 * defineOttoSkill — the fail-closed skill factory (the "standard").
 *
 * A BUILD-TIME wrapper: it derives needsApproval from a 3-field declaration,
 * enforces fail-closed rules at definition time, and returns an OttoSkill whose
 * `.tool` is a plain @openai/agents tool() — identical in shape to a hand-written one.
 * It sits ON the runtime; it does not run the agent loop.
 *
 * What it enforces (definition time): see docs/superpowers/specs/2026-06-26-otto-skill-framework-design.md §3.1.
 * What it CANNOT enforce (#5/#6 — inside execute): fenced by scripts/check-skill-imports.sh + tests.
 */
import { tool } from "@openai/agents";
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import type { OttoContext } from "./context.js";

export type Cost = "free" | "spend";
export type Effect = "read" | "write";
export type Reach = "internal" | "external";

export interface OttoSkillSpec<P extends z.ZodObject<any>> {
  name: string;
  description: string;
  parameters: P;
  cost: Cost;
  effect: Effect;
  reach: Reach;
  execute: (input: z.infer<P>, runContext: RunContext<OttoContext>) => Promise<unknown>;
  /** Required when cost === "spend": documents/justifies the exactly-once key. */
  idempotencyKey?: (input: z.infer<P>) => string;
}

export interface OttoSkill {
  name: string;
  cost: Cost;
  effect: Effect;
  reach: Reach;
  needsApproval: boolean;
  description: string;
  /** The @openai/agents tool, ready for the agent's `tools` array. */
  tool: ReturnType<typeof tool>;
}

const IDENTITY_KEYS = ["orgId", "ownerId", "userId"];

/** Pure: spend OR (external write) needs the boss's approval. */
export function deriveNeedsApproval(cost: Cost, effect: Effect, reach: Reach): boolean {
  return cost === "spend" || (effect === "write" && reach === "external");
}

export function defineOttoSkill<P extends z.ZodObject<any>>(spec: OttoSkillSpec<P>): OttoSkill {
  // Fail-closed: any missing classification → most-dangerous value.
  const cost: Cost = spec.cost ?? "spend";
  const effect: Effect = spec.effect ?? "write";
  const reach: Reach = spec.reach ?? "external";

  // #3 — identity must come from ctx, never the model.
  const leaked = Object.keys(spec.parameters.shape).filter((k) => IDENTITY_KEYS.includes(k));
  if (leaked.length > 0) {
    throw new Error(
      `[defineOttoSkill] "${spec.name}" parameters must not include identity field(s): ${leaked.join(", ")}. ` +
        `Identity comes from ctx (orgId/userId), never the model. Remove them from the schema.`,
    );
  }

  // #4 — a spend skill must declare an idempotency key.
  if (cost === "spend" && !spec.idempotencyKey) {
    throw new Error(
      `[defineOttoSkill] "${spec.name}" is cost:"spend" but declares no idempotencyKey.\n` +
        "Add:  idempotencyKey: (i) => `...:${i.id}`",
    );
  }

  const needsApproval = deriveNeedsApproval(cost, effect, reach);

  const built = tool<P, OttoContext>({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    needsApproval, // literal boolean — SDK normalizes to an async () => needsApproval
    execute: async (input, runContext) => {
      if (!runContext) throw new Error("OttoContext required");
      return spec.execute(input as z.infer<P>, runContext);
    },
  });

  return { name: spec.name, cost, effect, reach, needsApproval, description: spec.description, tool: built };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fikirtive/otto test src/skill.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add packages/otto/src/skill.ts packages/otto/src/skill.test.ts
git commit -m "feat(otto): defineOttoSkill() fail-closed factory + gate derivation"
```

---

### Task 2: Rename `tools/` → `skills/`

**Files:**
- Rename: `packages/otto/src/tools/` → `packages/otto/src/skills/` (all files incl. `*.test.ts`, `*.helpers.ts`)
- Modify: `packages/otto/src/otto.ts` (import paths), `packages/otto/src/index.ts` (import paths)

**Interfaces:**
- Consumes: nothing new. Pure path rename; all exports keep their names.
- Produces: same module exports at new paths (`./skills/propose.js`, etc.).

- [ ] **Step 1: Move the directory (preserve git history)**

```bash
cd packages/otto/src
git mv tools skills
cd -
```

- [ ] **Step 2: Update import paths in `otto.ts`**

In `packages/otto/src/otto.ts`, change the five tool imports from `./tools/<x>.js` to `./skills/<x>.js`:

```ts
import { propose } from "./skills/propose.js";
import { generate } from "./skills/generate.js";
import { updateBrief } from "./skills/update-brief.js";
import { describeRefs } from "./skills/describe-refs.js";
import { setTitle } from "./skills/set-title.js";
```

- [ ] **Step 3: Update import paths in `index.ts`**

In `packages/otto/src/index.ts`, change the five re-exports from `./tools/<x>.js` to `./skills/<x>.js`:

```ts
export { propose } from "./skills/propose.js";
export { generate } from "./skills/generate.js";
export { updateBrief } from "./skills/update-brief.js";
export { describeRefs, sanitizeRefDescription } from "./skills/describe-refs.js";
export { setTitle } from "./skills/set-title.js";
```

- [ ] **Step 4: Run the full otto suite to verify the rename is behavior-neutral**

Run: `pnpm --filter @fikirtive/otto test`
Expected: PASS — every existing test green (imports inside test files use relative `./` paths that moved with them, so they resolve unchanged).

- [ ] **Step 5: Commit**

```bash
git add -A packages/otto/src
git commit -m "refactor(otto): rename tools/ -> skills/ (path-only, behavior-neutral)"
```

---

### Task 3: Migrate the 3 trivial skills (`setTitle`, `updateBrief`, `describeRefs`)

**Files:**
- Modify: `packages/otto/src/skills/set-title.ts`, `update-brief.ts`, `describe-refs.ts`
- Test: existing `*.test.ts` for these stay green; add `packages/otto/src/skills/migration.test.ts` (gate-derivation assertions)

**Interfaces:**
- Consumes: `defineOttoSkill` (Task 1).
- Produces (per file, ADDITIVE — old bare-tool export name preserved):
  - `export const setTitleSkill: OttoSkill` and `export const setTitle = setTitleSkill.tool;`
  - `export const updateBriefSkill` + `export const updateBrief = updateBriefSkill.tool;`
  - `export const describeRefsSkill` + `export const describeRefs = describeRefsSkill.tool;`

> **Per-file cleanup (applies to every migration in Tasks 3–5):** after replacing the `tool({...})` block with `defineOttoSkill(...)`, the `import { tool } from "@openai/agents";` line becomes unused — **remove it** (the package's tsconfig is strict; an unused import is noise and may trip CI). Keep `import type { RunContext }`, `z`, and `prisma` — they are still used by the retained `executeXxx`. Verified: each file has a separate `import type { RunContext }` line, so dropping `tool` is safe.

- [ ] **Step 1: Write the failing gate-derivation test**

Create `packages/otto/src/skills/migration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setTitleSkill } from "./set-title.js";
import { updateBriefSkill } from "./update-brief.js";
import { describeRefsSkill } from "./describe-refs.js";

describe("migrated trivial skills carry the right gate", () => {
  it("setTitle: free/write/internal → not gated", () => {
    expect(setTitleSkill.cost).toBe("free");
    expect(setTitleSkill.needsApproval).toBe(false);
  });
  it("updateBrief: free/write/internal → not gated", () => {
    expect(updateBriefSkill.needsApproval).toBe(false);
  });
  it("describeRefs: free/read/internal → not gated", () => {
    expect(describeRefsSkill.effect).toBe("read");
    expect(describeRefsSkill.needsApproval).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/otto test src/skills/migration.test.ts`
Expected: FAIL — `setTitleSkill` is not exported.

- [ ] **Step 3: Migrate `set-title.ts`**

In `packages/otto/src/skills/set-title.ts`, replace the `tool(...)` definition block (the `export const setTitle = tool<...>({...})`) with the factory call, keeping `executeSetTitle` and `setTitleInput` exactly as-is:

```ts
import { defineOttoSkill } from "../skill.js";
// (remove the now-unused `import { tool } from "@openai/agents";` if nothing else uses it)

export const setTitleSkill = defineOttoSkill({
  name: "setTitle",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Set a concise ≤6-word title for the current conversation. " +
    "Call once early in a new conversation when a good title is clear. " +
    "This is $0.",
  parameters: setTitleInput,
  execute: executeSetTitle,
});

// Backward-compatible bare-tool export (keeps existing imports + tests unchanged).
export const setTitle = setTitleSkill.tool;
```

- [ ] **Step 4: Migrate `update-brief.ts`** (same shape)

```ts
import { defineOttoSkill } from "../skill.js";

export const updateBriefSkill = defineOttoSkill({
  name: "updateBrief",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Refine the project's creative brief with durable creative direction " +
    "(tone, visual style, recurring constraints like aspect ratio or language, key characters). " +
    "Call only when you have a clear, durable signal — ≤60 words. The user can edit it anytime. " +
    "This is $0 and persists across turns.",
  parameters: updateBriefInput,
  execute: executeUpdateBrief,
});

export const updateBrief = updateBriefSkill.tool;
```

- [ ] **Step 5: Migrate `describe-refs.ts`** (read effect)

```ts
import { defineOttoSkill } from "../skill.js";

export const describeRefsSkill = defineOttoSkill({
  name: "describeRefs",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Cache visual descriptions of reference images shown to you this turn. " +
    "For each reference image, provide its @name and a concise visual description " +
    "(appearance, wardrobe, style, distinctive features). " +
    "This is cached so later turns recall the look without re-sending the image. " +
    "See-once: a description is only written if one does not already exist (never overwrites). " +
    "This is $0.",
  parameters: describeRefsInput,
  execute: executeDescribeRefs,
});

export const describeRefs = describeRefsSkill.tool;
```

> Note: `describeRefs` writes `descriptionJson` to owned entities, but it is classified `effect: "read"` because it is an idempotent see-once cache fill (never overwrites, never spends, never crosses tenants) — the gate cares about *approval risk*, and a see-once internal cache has none. If a reviewer prefers `effect: "write"`, the derived `needsApproval` is identical (`false`) for `internal`, so it is purely a labeling choice with no behavior impact. Keep `read` to match the file's own "$0 see-once cache" intent.

- [ ] **Step 6: Run tests (new + existing) to verify all pass**

Run: `pnpm --filter @fikirtive/otto test`
Expected: PASS — `migration.test.ts` green; the existing set-title/update-brief/describe-refs tests still green (they import `executeSetTitle` etc., which are unchanged, and `setTitle` which is still a tool).

- [ ] **Step 7: Commit**

```bash
git add packages/otto/src/skills/set-title.ts packages/otto/src/skills/update-brief.ts packages/otto/src/skills/describe-refs.ts packages/otto/src/skills/migration.test.ts
git commit -m "refactor(otto): migrate setTitle/updateBrief/describeRefs onto defineOttoSkill"
```

---

### Task 4: Migrate `propose`

**Files:**
- Modify: `packages/otto/src/skills/propose.ts`
- Test: existing `propose` tests stay green; extend `migration.test.ts`

**Interfaces:**
- Produces: `export const proposeSkill: OttoSkill` + `export const propose = proposeSkill.tool;` (the `proposeInput`, `executePropose`, `buildProposeCard`, and type re-exports stay as-is).

- [ ] **Step 1: Add the failing assertion to `migration.test.ts`**

Append to `packages/otto/src/skills/migration.test.ts`:

```ts
import { proposeSkill } from "./propose.js";

describe("propose gate", () => {
  it("free/write/internal → not gated", () => {
    expect(proposeSkill.cost).toBe("free");
    expect(proposeSkill.needsApproval).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/otto test src/skills/migration.test.ts`
Expected: FAIL — `proposeSkill` is not exported.

- [ ] **Step 3: Migrate `propose.ts`**

In `packages/otto/src/skills/propose.ts`, replace the `export const propose = tool<typeof proposeInput, OttoContext>({...})` block with the factory call; keep `executePropose` and the `proposeInput` import and all re-exports unchanged:

```ts
import { defineOttoSkill } from "../skill.js";

export const proposeSkill = defineOttoSkill({
  name: "propose",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Build a generation proposal (GEN_CARD) the user can approve and generate later. " +
    "Call this when the user wants to create an image or video. " +
    "Provide kind, an English structuredPrompt, and any referenced entity ids. " +
    "Do NOT pick a model or set a price — those are computed server-side. " +
    "When the user wants a few options to choose from (an 'ad pack'), pass count (2–4) " +
    "to offer that many image variants — images only; video is always a single clip.",
  parameters: proposeInput,
  execute: executePropose,
});

export const propose = proposeSkill.tool;
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm --filter @fikirtive/otto test`
Expected: PASS — propose's existing tests (which use `executePropose`/`buildProposeCard`) and the new assertion green.

- [ ] **Step 5: Commit**

```bash
git add packages/otto/src/skills/propose.ts packages/otto/src/skills/migration.test.ts
git commit -m "refactor(otto): migrate propose onto defineOttoSkill"
```

---

### Task 5: Migrate `generate` (the money path — guarded)

**Files:**
- Modify: `packages/otto/src/skills/generate.ts`
- Test: `packages/otto/src/skills/generate.test.ts` **stays unmodified and green** (proof of behavior preservation)

**Interfaces:**
- Produces: `export const generateSkill: OttoSkill` + `export const generate = generateSkill.tool;` (the `generateInput` and `executeGenerate` exports stay exactly as-is — `executeGenerate` is **not edited**).

- [ ] **Step 1: Confirm the existing money-path tests are green BEFORE touching the file**

Run: `pnpm --filter @fikirtive/otto test src/skills/generate.test.ts`
Expected: PASS (baseline — these assert `needsApproval()` resolves to `true`, the `cardId`-only schema, the `cowork:<cardId>` guard, etc.). Record the pass count.

- [ ] **Step 2: Migrate the tool definition only (do NOT touch `executeGenerate`)**

In `packages/otto/src/skills/generate.ts`, replace the final `export const generate = tool<typeof generateInput, OttoContext>({...})` block with the factory call. **`executeGenerate`, `generateInput`, and every comment above them stay byte-for-byte.**

```ts
import { defineOttoSkill } from "../skill.js";

export const generateSkill = defineOttoSkill({
  name: "generate",
  cost: "spend",
  effect: "write",
  reach: "internal",
  // The exactly-once guard itself lives in executeGenerate + the DB unique index
  // (GenJob_cowork_idempotency_once). This declaration satisfies the factory's
  // "spend must declare an idempotency key" rule and documents the key shape.
  idempotencyKey: (i) => `cowork:${i.cardId}`,
  description:
    "Execute a generation proposal (GEN_CARD) that the user has approved. " +
    "This SPENDS the user's credits and REQUIRES the user's approval — only call it when " +
    "the user has clearly asked to go ahead with that specific card. " +
    "One card generates at most once. Pass only the card's id — model and params come from " +
    "the persisted card, not from this call.",
  parameters: generateInput,
  execute: executeGenerate,
});

// Backward-compatible bare-tool export — keeps generate.test.ts UNCHANGED.
export const generate = generateSkill.tool;
```

- [ ] **Step 3: Run the unmodified money-path tests to prove behavior preserved**

Run: `pnpm --filter @fikirtive/otto test src/skills/generate.test.ts`
Expected: PASS — **same pass count as Step 1, with the test file unmodified.** In particular `generate.needsApproval` is still the SDK-normalized async fn resolving to `true` (because `generate === generateSkill.tool`, the built SDK tool with `needsApproval: true`).

- [ ] **Step 4: Add a gate assertion to `migration.test.ts`**

Append:

```ts
import { generateSkill } from "./generate.js";

describe("generate gate (money path)", () => {
  it("spend → gated; needsApproval is literal-derived true", () => {
    expect(generateSkill.cost).toBe("spend");
    expect(generateSkill.needsApproval).toBe(true);
  });
});
```

Run: `pnpm --filter @fikirtive/otto test src/skills/migration.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/otto/src/skills/generate.ts packages/otto/src/skills/migration.test.ts
git commit -m "refactor(otto): migrate generate onto defineOttoSkill (money path; existing tests unchanged)"
```

---

### Task 6: Registry + rewire `otto.ts`

**Files:**
- Create: `packages/otto/src/registry.ts`
- Modify: `packages/otto/src/otto.ts`, `packages/otto/src/index.ts`
- Test: `packages/otto/src/registry.test.ts`

**Interfaces:**
- Consumes: the five `*Skill` exports (Tasks 3–5).
- Produces:
  - `export const allSkills: OttoSkill[]`
  - `interface SkillMeta { name; cost; effect; reach; needsApproval; description }`
  - `export const skillCatalog: SkillMeta[]`

- [ ] **Step 1: Write the failing test**

Create `packages/otto/src/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { allSkills, skillCatalog } from "./registry.js";
import { otto } from "./otto.js";

describe("registry", () => {
  it("collects all five skills", () => {
    const names = allSkills.map((s) => s.name).sort();
    expect(names).toEqual(["describeRefs", "generate", "propose", "setTitle", "updateBrief"]);
  });
  it("every registered skill carries a built SDK tool", () => {
    expect(allSkills.every((s) => s.tool != null)).toBe(true);
  });
  it("otto constructs from the registry without throwing", () => {
    // Importing otto.js (which builds the Agent from allSkills.map(s => s.tool)) must succeed.
    expect(otto).toBeDefined();
    expect(otto.name).toBe("Otto");
  });
  it("catalog exposes the gate metadata for each skill", () => {
    const gen = skillCatalog.find((m) => m.name === "generate")!;
    expect(gen.needsApproval).toBe(true);
    expect(gen.cost).toBe("spend");
  });
});
```

> The test deliberately does NOT assert on `otto.tools` — whether `@openai/agents` re-exposes the constructor's `tools` as a readable array is an SDK internal we don't couple to. Asserting `otto` builds (the Agent constructor consumed `allSkills.map(s => s.tool)`) is the meaningful wiring check.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/otto test src/registry.test.ts`
Expected: FAIL — `Cannot find module './registry.js'`.

- [ ] **Step 3: Write `registry.ts`**

```ts
/** The Otto skill registry: the single place skills are collected into the agent + catalog. */
import type { OttoSkill, Cost, Effect, Reach } from "./skill.js";
import { proposeSkill } from "./skills/propose.js";
import { generateSkill } from "./skills/generate.js";
import { updateBriefSkill } from "./skills/update-brief.js";
import { describeRefsSkill } from "./skills/describe-refs.js";
import { setTitleSkill } from "./skills/set-title.js";

/** Add a new skill here (one line). Order is the agent's tool order. */
export const allSkills: OttoSkill[] = [
  proposeSkill,
  generateSkill,
  updateBriefSkill,
  describeRefsSkill,
  setTitleSkill,
];

export interface SkillMeta {
  name: string;
  cost: Cost;
  effect: Effect;
  reach: Reach;
  needsApproval: boolean;
  description: string;
}

export const skillCatalog: SkillMeta[] = allSkills.map((s) => ({
  name: s.name,
  cost: s.cost,
  effect: s.effect,
  reach: s.reach,
  needsApproval: s.needsApproval,
  description: s.description,
}));
```

- [ ] **Step 4: Rewire `otto.ts` to read from the registry**

In `packages/otto/src/otto.ts`, remove the five individual `./skills/*.js` tool imports and the literal `tools: [propose, generate, updateBrief, describeRefs, setTitle]`. Replace with:

```ts
import { allSkills } from "./registry.js";
// …
export const otto = new Agent<OttoContext>({
  name: "Otto",
  instructions: ottoInstructions,
  model: ottoModel,
  modelSettings: { maxTokens: OTTO_OUTPUT_CAP_TOKENS },
  tools: allSkills.map((s) => s.tool),
});
```

- [ ] **Step 5: Export the registry from `index.ts`**

Append to `packages/otto/src/index.ts`:

```ts
export { allSkills, skillCatalog } from "./registry.js";
export type { SkillMeta } from "./registry.js";
export { defineOttoSkill, deriveNeedsApproval } from "./skill.js";
export type { OttoSkill, OttoSkillSpec, Cost, Effect, Reach } from "./skill.js";
```

(The existing bare `propose`/`generate`/… re-exports stay — backward compatible.)

- [ ] **Step 6: Run the full suite**

Run: `pnpm --filter @fikirtive/otto test`
Expected: PASS — registry test + all migration + all existing tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/otto/src/registry.ts packages/otto/src/registry.test.ts packages/otto/src/otto.ts packages/otto/src/index.ts
git commit -m "feat(otto): skill registry + wire otto.tools from registry"
```

---

### Task 7: Authoring standard (AGENTS.md + CLAUDE.md + template)

**Files:**
- Create: `packages/otto/src/skills/AGENTS.md`, `packages/otto/src/skills/CLAUDE.md`, `packages/otto/src/skills/_template.ts`
- Test: `packages/otto/src/skills/_template.test.ts`

**Interfaces:**
- Consumes: `defineOttoSkill`.
- Produces: a compilable, registry-excluded `templateSkill` example for the author to copy. The template is NOT added to `registry.ts`.

- [ ] **Step 1: Write the failing test (the template must compile + derive correctly)**

Create `packages/otto/src/skills/_template.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { templateSkill } from "./_template.js";

describe("_template.ts is a valid, copyable skill", () => {
  it("compiles and derives a sane gate", () => {
    expect(templateSkill.name).toBe("TODO_rename");
    expect(typeof templateSkill.needsApproval).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @fikirtive/otto test src/skills/_template.test.ts`
Expected: FAIL — `Cannot find module './_template.js'`.

- [ ] **Step 3: Write `_template.ts`**

```ts
/**
 * _template.ts — copy this file to skills/<your-skill>.ts and fill the blanks.
 * Do NOT add this template to registry.ts. Steps: see skills/AGENTS.md.
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";

const templateInput = z.object({
  // Your params. NEVER include orgId/ownerId/userId — identity comes from ctx.
  example: z.string().min(1),
});

export const templateSkill = defineOttoSkill({
  name: "TODO_rename",
  // cost:   does it spend FIKIRTIVE credits?      "free" | "spend"   (spend ⇒ also add idempotencyKey)
  // effect: does it change state (our DB OR outside)? "read" | "write"
  // reach:  does it touch the outside world?       "internal" | "external"
  cost: "free",
  effect: "read",
  reach: "internal",
  description: "TODO: one or two sentences telling Otto when to use this.",
  parameters: templateInput,
  execute: async (input, { context }) => {
    // Reach the outside world ONLY through an injected ctx port (e.g. context.somePort),
    // never by importing the fal provider / reserveCredits / Prisma directly (see AGENTS.md).
    void context;
    return { ok: true, echoed: input.example };
  },
});
```

- [ ] **Step 4: Write `skills/AGENTS.md`** (the rulebook)

```markdown
# Authoring an Otto skill

A skill = `defineOttoSkill({...})` in `skills/<name>.ts`. The factory derives `needsApproval`
from your 3-field declaration and fails closed. See the design spec:
`docs/superpowers/specs/2026-06-26-otto-skill-framework-design.md`.

## The 3 fields (answer these — you cannot omit them)
- `cost`: `"free" | "spend"` — spends FIKIRTIVE credits? `spend` also REQUIRES `idempotencyKey`.
- `effect`: `"read" | "write"` — changes state (our DB OR the outside world)?
- `reach`: `"internal" | "external"` — touches the outside world (network/3rd-party)?

`needsApproval = (cost === "spend") || (effect === "write" && reach === "external")`.
External **reads** (web lookups) are NOT gated; external **writes** (post/send/publish) are.

## The 5 steps to add a skill (worked example: `searchWeb`)
1. **Declare a port** on `OttoContext` in `../context.ts` (the seam to the outside). Skills never
   call `fetch()`/Prisma-for-external/fal directly — only injected `ctx` ports.
2. **Inject the real port** in the web/worker `buildOttoContext` (API key, rate-limit, logging).
3. **Write the skill**: copy `_template.ts` → `skills/<name>.ts`, fill the 3 fields + `execute`.
   Add `export const <name> = <name>Skill.tool;` for the bare-tool export.
4. **Register**: add `import { <name>Skill }` + an entry in `../registry.ts` `allSkills`.
5. **Test**: a gate assertion in `migration.test.ts` (or a `<name>.test.ts`) + a port-required guard.
   Then regenerate the catalog: `pnpm --filter @fikirtive/otto run catalog`.

## Hard rules (enforced)
- No identity fields (`orgId`/`ownerId`/`userId`) in `parameters` — the factory throws.
- `cost:"spend"` without `idempotencyKey` — the factory throws.
- `skills/*` must not import `@fikirtive/generation` (fal) or `reserveCredits` — the CI fence fails
  (`scripts/check-skill-imports.sh`). Route spend through an injected port.
```

- [ ] **Step 5: Write `skills/CLAUDE.md`** (one-line pointer, matches `apps/web` pattern)

```markdown
@AGENTS.md
```

- [ ] **Step 6: Run the template test**

Run: `pnpm --filter @fikirtive/otto test src/skills/_template.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/otto/src/skills/AGENTS.md packages/otto/src/skills/CLAUDE.md packages/otto/src/skills/_template.ts packages/otto/src/skills/_template.test.ts
git commit -m "docs(otto): skill authoring standard — AGENTS.md + CLAUDE.md + _template.ts"
```

---

### Task 8: `CATALOG.md` generator + freshness test

**Files:**
- Create: `packages/otto/scripts/gen-catalog.ts`, `packages/otto/src/skills/CATALOG.md` (generated), `packages/otto/src/catalog.ts` (pure formatter)
- Modify: `packages/otto/package.json` (add `catalog` + `catalog:check` scripts)
- Test: `packages/otto/src/catalog.test.ts`

**Interfaces:**
- Consumes: `skillCatalog` (Task 6).
- Produces: `renderCatalog(meta: SkillMeta[]): string` (pure, deterministic markdown table).

- [ ] **Step 1: Write the failing test for the pure formatter**

Create `packages/otto/src/catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderCatalog } from "./catalog.js";
import { skillCatalog } from "./registry.js";

describe("renderCatalog", () => {
  it("emits one table row per skill, sorted by name, with a gate column", () => {
    const md = renderCatalog(skillCatalog);
    expect(md).toContain("| generate | spend | write | internal | ✅ |");
    expect(md).toContain("| setTitle | free | write | internal | ❌ |");
    // rows are sorted: describeRefs before setTitle
    expect(md.indexOf("| describeRefs |")).toBeLessThan(md.indexOf("| setTitle |"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @fikirtive/otto test src/catalog.test.ts`
Expected: FAIL — `Cannot find module './catalog.js'`.

- [ ] **Step 3: Write the pure formatter `catalog.ts`**

```ts
import type { SkillMeta } from "./registry.js";

/** Deterministic markdown table of all skills. Pure — same input, same bytes. */
export function renderCatalog(meta: SkillMeta[]): string {
  const rows = [...meta]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (m) =>
        `| ${m.name} | ${m.cost} | ${m.effect} | ${m.reach} | ${m.needsApproval ? "✅" : "❌"} | ${m.description.replace(/\n/g, " ").slice(0, 80)} |`,
    );
  return [
    "<!-- GENERATED by `pnpm --filter @fikirtive/otto run catalog`. Do not edit by hand. -->",
    "# Otto Skill Catalog",
    "",
    "| skill | cost | effect | reach | needsApproval | description |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
```

- [ ] **Step 4: Run to verify the formatter test passes**

Run: `pnpm --filter @fikirtive/otto test src/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the generator script `packages/otto/scripts/gen-catalog.ts`**

```ts
/** Writes skills/CATALOG.md from the registry. `--check` exits non-zero if stale. */
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { skillCatalog } from "../src/registry.js";
import { renderCatalog } from "../src/catalog.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "skills", "CATALOG.md");
const next = renderCatalog(skillCatalog);

if (process.argv.includes("--check")) {
  const cur = readFileSync(out, "utf8");
  if (cur !== next) {
    console.error("CATALOG.md is stale. Run: pnpm --filter @fikirtive/otto run catalog");
    process.exit(1);
  }
  console.log("CATALOG.md is fresh.");
} else {
  writeFileSync(out, next);
  console.log("Wrote " + out);
}
```

- [ ] **Step 6: Add scripts to `packages/otto/package.json`**

In the `"scripts"` block add:

```json
"catalog": "tsx scripts/gen-catalog.ts",
"catalog:check": "tsx scripts/gen-catalog.ts --check"
```

(If `tsx` is not already available in the workspace, run via `node --import tsx scripts/gen-catalog.ts`. Confirm `tsx` presence with `pnpm --filter @fikirtive/otto exec tsx --version`; the worker app uses tsx, so it is in the monorepo.)

- [ ] **Step 7: Generate the catalog and verify the freshness check passes**

```bash
pnpm --filter @fikirtive/otto run catalog
pnpm --filter @fikirtive/otto run catalog:check
```
Expected: first writes `src/skills/CATALOG.md`; second prints "CATALOG.md is fresh."

- [ ] **Step 8: Commit**

```bash
git add packages/otto/scripts/gen-catalog.ts packages/otto/src/catalog.ts packages/otto/src/catalog.test.ts packages/otto/src/skills/CATALOG.md packages/otto/package.json
git commit -m "feat(otto): generated skill CATALOG.md + freshness check"
```

---

### Task 9: Lint fence — `check-skill-imports.sh`

**Files:**
- Create: `scripts/check-skill-imports.sh`
- Modify: root `package.json` (add `lint:skills` script)
- Test: `packages/otto/src/skills/fence.test.ts` (asserts the fence trips on a banned import)

**Interfaces:**
- Consumes: nothing (static grep over `packages/otto/src/skills/*.ts`).
- Produces: a CI tripwire. HARD-fails on `@fikirtive/generation` / `reserveCredits` imports in skills; WARN-counts `@fikirtive/db`.

- [ ] **Step 1: Write `scripts/check-skill-imports.sh`** (mirror `check-no-raw-prisma.sh`)

```bash
#!/usr/bin/env bash
# Fence (Otto skill framework §3.3): skills/* must reach spend/providers ONLY via injected ctx ports.
# HARD-fail: importing the fal provider (@fikirtive/generation) or reserveCredits directly.
# WARN: direct @fikirtive/db (Prisma) use — current skills do owner-scoped reads this way; migrate
#       behind read-ports incrementally (does not fail CI yet).
set -uo pipefail
DIR="packages/otto/src/skills"

hard=$(grep -rnE "from \"@fikirtive/generation\"|reserveCredits" "$DIR" --include='*.ts' 2>/dev/null \
  | grep -v '\.test\.ts' | grep -vE ':\s*(\*|//)' || true)   # anchor after the grep -rn "file:lineno:" prefix

if [ -n "$hard" ]; then
  echo "FAIL: skills/ must not import the fal provider or reserveCredits — route spend through a ctx port:"
  echo "$hard"
  exit 1
fi

warn=$(grep -rnE "from \"@fikirtive/db\"" "$DIR" --include='*.ts' 2>/dev/null | grep -v '\.test\.ts' | wc -l | tr -d ' ' || true)
echo "skill-imports fence: 0 spend/provider bypass (hard-clean); $warn direct-Prisma sites (warn baseline)."
exit 0
```

- [ ] **Step 2: Make it executable and run it (expect clean pass on current code)**

```bash
chmod +x scripts/check-skill-imports.sh
bash scripts/check-skill-imports.sh
```
Expected: prints "0 spend/provider bypass (hard-clean); 5 direct-Prisma sites (warn baseline)." and exits 0. (No current skill imports fal/reserveCredits.)

- [ ] **Step 3: Write the fence behavior test**

Create `packages/otto/src/skills/fence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ESM idiom (the package is "type": "module"; existing otto tests use import.meta.url).
const HERE = dirname(fileURLToPath(import.meta.url)); // packages/otto/src/skills
const ROOT = join(HERE, "..", "..", "..", ".."); // repo root
const BAD = join("packages/otto/src/skills", "__fence_probe__.ts");

describe("check-skill-imports fence", () => {
  it("hard-fails when a skill imports reserveCredits", () => {
    writeFileSync(join(ROOT, BAD), `import { reserveCredits } from "@fikirtive/db";\nexport const x = reserveCredits;\n`);
    try {
      let failed = false;
      try {
        execFileSync("bash", ["scripts/check-skill-imports.sh"], { cwd: ROOT });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(join(ROOT, BAD));
    }
  });
});
```

> `ROOT` is derived from `import.meta.url` (ESM), matching the existing otto tests — `generate.test.ts` already uses `import.meta.url` + `node:fs`, so fs/child_process access from tests is established. Do not use bare `__dirname` (undefined under this package's ESM config).

- [ ] **Step 4: Run the fence test**

Run: `pnpm --filter @fikirtive/otto test src/skills/fence.test.ts`
Expected: PASS — the probe import trips the fence (non-zero exit), and the probe file is cleaned up.

- [ ] **Step 5: Wire into root `package.json`**

Add to root `package.json` `"scripts"`:

```json
"lint:skills": "bash scripts/check-skill-imports.sh"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/check-skill-imports.sh package.json packages/otto/src/skills/fence.test.ts
git commit -m "feat(otto): skill-imports fence — hard-ban fal/reserveCredits in skills/ (§3.3)"
```

---

## Final verification (run before handing to 总司令)

- [ ] `pnpm --filter @fikirtive/otto test` → all green (factory, migration, registry, catalog, template, fence + every pre-existing test, **generate.test.ts unmodified**).
- [ ] `pnpm --filter @fikirtive/otto run catalog:check` → "fresh".
- [ ] `bash scripts/check-skill-imports.sh` → exits 0, "0 spend/provider bypass".
- [ ] `pnpm --filter @fikirtive/otto typecheck` (in 总司令's real env — sandbox may not typecheck per repo norms).
- [ ] `git log --oneline` shows the 9 task commits; the diff to `apps/web`/`apps/worker`/`meter.ts`/credit schema is **empty** (runtime + money path untouched).

---

## Self-Review notes (author check vs spec)

- **Spec §2 taxonomy** → Task 1 test truth table (all rows) + Task 3–5 per-skill assertions. ✓
- **Spec §3.1 enforcement #1–#4** → Task 1 (`needsApproval` derive; identity-key throw; spend-idempotency throw; fail-closed default). ✓
- **Spec §3.1 #5/#6 (un-enforceable)** → honored: not faked in the factory; fenced in Task 9 + left to existing tests. ✓
- **Spec §3.3 lint fence (warn+allowlist, fal/reserveCredits hard, Prisma warn)** → Task 9. ✓
- **Spec §4 file system + registry** → Tasks 2 (rename), 6 (registry). ✓
- **Spec §5 dual-audience artifacts (AGENTS.md/CLAUDE.md/_template/fail-loud/CATALOG)** → Tasks 7, 8 (+ fail-loud errors in Task 1). ✓
- **Spec §6 migration (behavior-preserving, generate last + guarded, tools/→skills/)** → Tasks 2–5; `generate.test.ts` unmodified (Task 5 Steps 1+3). ✓
- **Spec §7 testing (factory tests, migration regression, CATALOG freshness, fence)** → Tasks 1, 3–5, 8, 9 + Final verification. ✓
- **Spec §8 #1 (return type)** → resolved: `OttoSkill {…meta, tool}` + bare `.tool` re-export. **#2 (Zod `.shape`)** → used in Task 1. **#3 (rememberBrandFact off-main)** → out of scope; migrates when #16 lands (note for 总司令). ✓
- **Type consistency:** `OttoSkill`, `SkillMeta`, `skillCatalog`, `allSkills`, `*Skill`, `renderCatalog` used identically across Tasks 1/6/8. ✓
- **Placeholder scan:** no TBD/TODO-as-instruction; `TODO_rename`/`TODO:` strings are intentional template content. ✓
