# Otto `requires` 资讯门（工厂预检）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal（一句话）：** 给 `defineOttoSkill` 加一个 `requires` 声明 + 工厂预检，让 skill 在必要资讯没齐时机械地拦下（返回 `needMoreInfo` 让 Otto 追问），并把它应用到 `propose`（要求 `goal`），实现创始人要的"刨根问底 · 硬门"。

**Architecture（2–3 句）：** 纯 build-time 层，坐在 `@openai/agents` 之上——不动 agent loop、不动钱路、不动 seam。`defineOttoSkill` 从 `requires` 声明派生三件事：①定义时校验（字段必须在 `parameters` 里）②把问题追加进 tool description（让模型主动先问）③execute 前预检（缺字段则跳过 execute、返回 `needMoreInfo`）。这和现有"从 3 字段派生 needsApproval、fail-closed"的哲学一致。

**Tech Stack：** TypeScript、Zod（已有）、`@openai/agents`（已有、pinned）、vitest。`packages/otto`。无新增运行时依赖。

## Global Constraints（每个 task 都隐含遵守）

- **不动 agent loop / 钱路 / seam。** 本计划不碰 `run()`/`RunState`/审批引擎、`ctx.startGen`、`reserveCredits`、`meter.ts`、worker。
- **行为保持。** 现有 12 个非-propose skill 行为不变；现有测试全绿。`generate` 的 `needsApproval` 仍解析为字面 `true`。
- **`propose` 唯一的行为变化**是新增 `goal` 资讯门（本计划的目标），其余不变（$0、GEN_CARD 形状、owner scoping）。
- **CI fence 不违反**：`skills/*` 不 import fal/`reserveCredits`。
- **文档华语。** 本计划及 skill 注释/文档用华语（创始人偏好）。生成 prompt（`structuredPrompt`）仍须英文。
- **`requires` 字段的 waive 语义**：字段"用户说不需要/没有"= Otto 用用户的答案把该字段填成非空值（如 `goal: "用户只想要这张图，无营销目标"`）。预检只判空，不做单独的豁免通道——保持最简。

---

## 文件结构（改哪些、各自职责）

- `packages/otto/src/skill.ts` — 加 `requires` 到 `OttoSkillSpec`/`OttoSkill`；加 `missingRequired` 纯函数；`defineOttoSkill` 加定义时校验 + description 追加 + execute 预检。**框架核心。**
- `packages/otto/src/skill.test.ts` — 新增：定义时校验抛错、`missingRequired` 逻辑、description 追加、`OttoSkill.requires` 填充。
- `packages/otto/src/registry.ts` — `SkillMeta` + `skillCatalog` 带上 `requires`。
- `packages/otto/src/registry.test.ts` — 新增：catalog 携带 `requires`。
- `packages/otto/src/skills/propose.helpers.ts` — `proposeInput` 加 `goal`；`CardPayload` 加 `goal?`。
- `packages/otto/src/skills/propose.ts` — `proposeSkill` 声明 `requires: [{field:"goal"}]`；`executePropose` 把 `goal` 持久化进 payload。
- `packages/otto/src/skills/propose.test.ts` — 新增：`proposeSkill.requires` 含 goal；`proposeInput` 能带/不带 goal 解析；execute 持久化 goal。
- `packages/otto/src/instructions.ts` — 加"先弄清意图再创作（刨根问底）"块。
- `packages/otto/src/instructions.test.ts` — 新增：断言该块存在。
- `packages/otto/src/skills/CATALOG.md` — 由 `pnpm --filter @fikirtive/otto run catalog` 重生成。

**测试命令约定：** 单文件 `pnpm --filter @fikirtive/otto exec vitest run <相对路径>`；全套 `pnpm --filter @fikirtive/otto exec vitest run`。

---

## Task 1: `requires` 字段 + 定义时校验（字段必须在 parameters 里）

**Files:**
- Modify: `packages/otto/src/skill.ts`
- Test: `packages/otto/src/skill.test.ts`

**Interfaces:**
- Produces: `OttoSkillSpec.requires?: { field: string; question: string }[]`；`OttoSkill.requires: { field: string; question: string }[]`。`defineOttoSkill` 在任一 `requires[].field` 不在 `parameters` 的 shape 里时 **throw**（fail-loud）。

- [ ] **Step 1: 写失败测试**（追加到 `skill.test.ts` 的 `describe("defineOttoSkill enforcement", ...)` 内）

```typescript
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skill.test.ts`
Expected: FAIL —`requires` 不是 `OttoSkillSpec` 的属性（类型错误）/ `s.requires` undefined。

- [ ] **Step 3: 改 `skill.ts` 类型 + 校验**

在 `OttoSkillSpec` 接口内（`idempotencyKey?` 之后）加：

```typescript
  /** 可选：此 skill 动手前需要的资讯。每个 field 必须也是 `parameters` 的一个 key。
   *  工厂据此 (a) 把问题追加进 description 让模型先问，(b) 在 execute 前预检——
   *  缺字段则跳过 execute、返回 { needMoreInfo }，让 agent 去追问。 */
  requires?: { field: string; question: string }[];
```

在 `OttoSkill` 接口内（`description` 之后、`tool` 之前）加：

```typescript
  /** 声明的资讯门（空数组表示无）。 */
  requires: { field: string; question: string }[];
```

在 `defineOttoSkill` 里，紧接 `#4`（idempotencyKey 检查）之后、`const needsApproval = ...` 之前加：

```typescript
  // requires: 每个声明的 field 必须存在于 parameters 的 shape（fail-loud，同 #3 身份键检查）。
  const requires = spec.requires ?? [];
  const unknownReq = requires.filter((r) => !(r.field in shape));
  if (unknownReq.length > 0) {
    throw new Error(
      `[defineOttoSkill] "${spec.name}" declares requires field(s) not in parameters: ` +
        `${unknownReq.map((r) => r.field).join(", ")}. Add them to the z.object({...}) schema.`,
    );
  }
```

在 `return { ... }` 里加 `requires`：

```typescript
  return { name: spec.name, cost, effect, reach, needsApproval, description: spec.description, requires, tool: built };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skill.test.ts`
Expected: PASS（含既有全部用例）。

- [ ] **Step 5: commit**

```bash
git add packages/otto/src/skill.ts packages/otto/src/skill.test.ts
git commit -m "feat(otto): requires field on defineOttoSkill + definition-time field validation"
```

---

## Task 2: `missingRequired` 纯函数（预检逻辑）

**Files:**
- Modify: `packages/otto/src/skill.ts`
- Test: `packages/otto/src/skill.test.ts`

**Interfaces:**
- Produces: `export function missingRequired(requires: { field: string; question: string }[], input: Record<string, unknown>): { field: string; question: string }[]` —— 返回 input 中缺失（undefined/null/空串-trim 后）的必要字段。

- [ ] **Step 1: 写失败测试**（在 `skill.test.ts` 顶部 import 加 `missingRequired`，并新增一个 describe）

```typescript
import { defineOttoSkill, deriveNeedsApproval, missingRequired } from "./skill.js";

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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skill.test.ts`
Expected: FAIL — `missingRequired` 未导出。

- [ ] **Step 3: 在 `skill.ts` 加纯函数**（放在 `deriveNeedsApproval` 之后）

```typescript
/** 纯：返回 input 中缺失（undefined/null/空串）的必要字段。空 requires → []。 */
export function missingRequired(
  requires: { field: string; question: string }[],
  input: Record<string, unknown>,
): { field: string; question: string }[] {
  return requires.filter((r) => {
    const v = input[r.field];
    return v == null || (typeof v === "string" && v.trim() === "");
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skill.test.ts`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add packages/otto/src/skill.ts packages/otto/src/skill.test.ts
git commit -m "feat(otto): missingRequired preflight helper"
```

---

## Task 3: 工厂接线 —— description 追加 + execute 预检

**Files:**
- Modify: `packages/otto/src/skill.ts`
- Test: `packages/otto/src/skill.test.ts`

**Interfaces:**
- Consumes: `missingRequired`（Task 2）、`requires`（Task 1）。
- Produces: 当 `requires` 非空时，built tool 的 `description` 追加"先问什么"的提示；execute 在缺字段时返回 `{ needMoreInfo: {field,question}[] }` 而不跑 `spec.execute`。`OttoSkill.description` 保持**原始** description（catalog 用干净版）。

- [ ] **Step 1: 写失败测试**（新增 describe）

```typescript
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
```

> 注：`@openai/agents` 的 `tool()` 返回的 `FunctionTool` 通过 `.invoke(runContext, argsJson)` 调用其 execute。若该 SDK 版本的调用签名不同（先 typecheck / 看 `node_modules/@openai/agents` 的 `FunctionTool` 类型），把上面两个 `invoke` 用例改成 SDK 实际的调用形式；`missingRequired` 的纯逻辑已在 Task 2 覆盖，这两个用例只验证"接线"。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skill.test.ts`
Expected: FAIL — description 未含问题；execute 未预检。

- [ ] **Step 3: 改 `defineOttoSkill` 接线**

在构建 tool 之前，算出 model-facing description：

```typescript
  // requires 非空时，把"先确认什么"追加进 model-facing description（单一事实源：同一份 requires）。
  const modelDescription =
    requires.length > 0
      ? `${spec.description}\n\nBefore calling, make sure you have (ask the user for anything still missing; ` +
        `autofill from brand memory when you can): ${requires.map((r) => r.question).join(" ")}`
      : spec.description;
```

把 `tool<...>({ ... })` 里的 `description: spec.description` 改成 `description: modelDescription`，并把 execute 换成带预检的版本：

```typescript
    execute: async (input, runContext) => {
      if (!runContext) throw new Error("OttoContext required");
      if (requires.length > 0) {
        const missing = missingRequired(requires, input as Record<string, unknown>);
        if (missing.length > 0) return { needMoreInfo: missing };
      }
      return spec.execute(input as z.infer<P>, runContext);
    },
```

（`OttoSkill.description` 仍返回 `spec.description` —— 已在 Task 1 的 return 里，保持不变。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skill.test.ts`
Expected: PASS（既有用例仍绿——无 requires 的 skill：`modelDescription === spec.description`，execute 不变）。

- [ ] **Step 5: commit**

```bash
git add packages/otto/src/skill.ts packages/otto/src/skill.test.ts
git commit -m "feat(otto): wire requires into defineOttoSkill (description hint + execute preflight)"
```

---

## Task 4: registry —— catalog 携带 `requires`

**Files:**
- Modify: `packages/otto/src/registry.ts`
- Test: `packages/otto/src/registry.test.ts`

**Interfaces:**
- Consumes: `OttoSkill.requires`（Task 1）。
- Produces: `SkillMeta.requires: { field: string; question: string }[]`；`skillCatalog[].requires`。

- [ ] **Step 1: 写失败测试**（追加到 `registry.test.ts` 的 `describe("registry", ...)`）

```typescript
  it("catalog carries the requires declaration for each skill", () => {
    const propose = skillCatalog.find((m) => m.name === "propose")!;
    expect(Array.isArray(propose.requires)).toBe(true);
    // 每个 skill 至少有一个空数组（不是 undefined）
    expect(skillCatalog.every((m) => Array.isArray(m.requires))).toBe(true);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/registry.test.ts`
Expected: FAIL — `m.requires` undefined。

- [ ] **Step 3: 改 `registry.ts`**

在 `SkillMeta` 接口加：

```typescript
  requires: { field: string; question: string }[];
```

在 `skillCatalog` 的 map 里加 `requires: s.requires`：

```typescript
export const skillCatalog: SkillMeta[] = allSkills.map((s) => ({
  name: s.name,
  cost: s.cost,
  effect: s.effect,
  reach: s.reach,
  needsApproval: s.needsApproval,
  description: s.description,
  requires: s.requires,
}));
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/registry.test.ts`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add packages/otto/src/registry.ts packages/otto/src/registry.test.ts
git commit -m "feat(otto): carry requires onto skillCatalog"
```

---

## Task 5: 给 `propose` 装上 `goal` 资讯门

**Files:**
- Modify: `packages/otto/src/skills/propose.helpers.ts`
- Modify: `packages/otto/src/skills/propose.ts`
- Test: `packages/otto/src/skills/propose.test.ts`

**Interfaces:**
- Consumes: `requires`（Task 1–3）。
- Produces: `proposeInput` 多一个 `goal?: string`；`CardPayload` 多一个 `goal?: string`；`proposeSkill.requires = [{ field: "goal", question: ... }]`；`executePropose` 把 `input.goal` 持久化进 GEN_CARD 的 payload。

- [ ] **Step 1: 写失败测试**（追加到 `propose.test.ts`）

```typescript
// 顶部已 import { proposeSkill } 吗？没有则加：
import { proposeSkill } from "./propose.js";

describe("propose requires-gate + goal", () => {
  it("proposeSkill declares a goal requirement", () => {
    expect(proposeSkill.requires.map((r) => r.field)).toContain("goal");
  });

  it("proposeInput accepts an optional goal and still parses without it", async () => {
    const { proposeInput } = await import("./propose.helpers.js");
    expect(proposeInput.safeParse({ kind: "image", structuredPrompt: "x" }).success).toBe(true);
    const withGoal = proposeInput.safeParse({ kind: "image", structuredPrompt: "x", goal: "drive signups" });
    expect(withGoal.success).toBe(true);
  });

  it("executePropose persists goal onto the GEN_CARD payload", async () => {
    // ISOLATION (required): clear prior tests' create() call-history so .mock.calls[0]
    // is THIS test's call, not an earlier one. Prefer a beforeEach(() => vi.clearAllMocks())
    // in this describe — and reuse that pattern when copying this test to propose-pack /
    // propose-ad-build requires-gates in later blocks (avoids cross-test mock pollution).
    (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mockClear();
    const ctx = makeCtx({ orgId: "org-goal", threadId: "thread-goal" });
    await executePropose(
      { kind: "image", structuredPrompt: "A hero shot", entityIds: [], variantSel: {}, goal: "launch teaser" },
      { context: ctx },
    );
    const createArg = (mockPrisma.chatMessage.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: { payload: Record<string, unknown> };
    };
    expect(createArg.data.payload["goal"]).toBe("launch teaser");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/propose.test.ts`
Expected: FAIL — `proposeSkill.requires` 无 goal；payload 无 goal。

- [ ] **Step 3: 改 `propose.helpers.ts`**

在 `proposeInput` 里加（放在 `forVideo` 之后）：

```typescript
  // 创作意图/目的 —— requires 资讯门要求它非空。琐碎请求可由 Otto 从上下文推断填入。
  goal: z.string().optional(),
```

在 `CardPayload` 类型里加（放在 `sourceGenerationId?` 之后）：

```typescript
  /** 这条创作的目的/意图（来自 propose 的资讯门）。展示/审计用。 */
  goal?: string;
```

- [ ] **Step 4: 改 `propose.ts`**

给 `proposeSkill` 加 `requires`（放在 `parameters: proposeInput,` 之前或之后）：

```typescript
  requires: [
    {
      field: "goal",
      question:
        "What is this creative for — its goal/purpose (e.g. an ad to drive signups, a product hero shot for the site)?",
    },
  ],
```

在 `executePropose` 里，把 `goal` 并入持久化的 payload。将：

```typescript
      payload: cardPayload,
```

改为：

```typescript
      payload: { ...cardPayload, ...(input.goal ? { goal: input.goal } : {}) },
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/propose.test.ts`
Expected: PASS（既有 buildProposeCard/executePropose 用例仍绿——它们不传 goal，payload.goal 省略）。

- [ ] **Step 6: commit**

```bash
git add packages/otto/src/skills/propose.ts packages/otto/src/skills/propose.helpers.ts packages/otto/src/skills/propose.test.ts
git commit -m "feat(otto): propose requires a goal (info-gate) + persists it on the card"
```

---

## Task 6: 指令 —— "先弄清意图再创作（刨根问底）"块

**Files:**
- Modify: `packages/otto/src/instructions.ts`
- Test: `packages/otto/src/instructions.test.ts`

**Interfaces:**
- Produces: `ottoInstructions` 含一个新块，指导 Otto 先从品牌记忆自动补齐、只问缺的、琐碎请求别过度追问、遇 `needMoreInfo` 就追问后重试。

- [ ] **Step 1: 写失败测试**（追加到 `instructions.test.ts`）

```typescript
describe("ottoInstructions — 刨根问底 (intent before creating)", () => {
  it("has the intent-first section", () => {
    expect(ottoInstructions).toMatch(/刨根问底|before you propose|before creating/i);
  });
  it("tells Otto to autofill from brand memory and ask only for gaps", () => {
    expect(ottoInstructions).toMatch(/brand memory/i);
    expect(ottoInstructions).toMatch(/only for what.?s (genuinely )?missing|only for the gaps|only ask/i);
  });
  it("tells Otto how to handle a needMoreInfo tool result", () => {
    expect(ottoInstructions).toContain("needMoreInfo");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/instructions.test.ts`
Expected: FAIL — 无该块。

- [ ] **Step 3: 在 `ottoInstructions` 里加块**（放在 "When to call \`propose\`" 之前，作为创作前的总规矩）

```typescript
## Understand intent before you create (刨根问底)

When the user wants a marketing asset — especially an ad or campaign — first use what you already know about their brand (it's provided to you above) to fill in the picture, then briefly ask for anything essential that's still missing before you propose: the goal/purpose, and for an ad also the product, audience, format, and length. Ask only for what's genuinely missing — at most 2–3 short questions — never interrogate. For a simple, clear one-off request (e.g. "make an image of a cat"), don't over-ask: infer the goal and proceed.

If a tool returns \`needMoreInfo\`, it means a required detail is missing — ask the user those exact questions, then call the tool again with the answers filled in. If the user says a detail isn't needed or doesn't exist, proceed by filling that field with their answer (e.g. goal: "just wants this image, no campaign goal").
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/instructions.test.ts`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add packages/otto/src/instructions.ts packages/otto/src/instructions.test.ts
git commit -m "feat(otto): instructions — understand intent (刨根问底) before creating"
```

---

## Task 7: 重生成 CATALOG.md + 全套回归

**Files:**
- Modify: `packages/otto/src/skills/CATALOG.md`（自动生成）

- [ ] **Step 1: 重生成 catalog**

Run: `pnpm --filter @fikirtive/otto run catalog`
Expected: `CATALOG.md` 更新（若 catalog 表也渲染 requires 则出现 goal；若只渲染 gate 字段则内容可能不变——两者皆可）。

- [ ] **Step 2: 跑全套 otto 测试**

Run: `pnpm --filter @fikirtive/otto exec vitest run`
Expected: 全绿（含 `skill.test.ts`/`registry.test.ts`/`propose.test.ts`/`instructions.test.ts`/`migration.test.ts` 及其余）。

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @fikirtive/otto exec tsc --noEmit`（或仓库既有 typecheck 命令，如 `pnpm -r typecheck`）
Expected: 无类型错误。

- [ ] **Step 4: commit**

```bash
git add packages/otto/src/skills/CATALOG.md
git commit -m "chore(otto): regenerate skill catalog"
```

---

## Self-Review（对照 spec）

**1. Spec 覆盖：**
- spec §4.1-A（`requires` 字段，唯一框架改动）→ Task 1–3 ✓
- spec §4.2「工厂预检硬门」（创始人拍板）→ Task 3 execute 预检 + Task 5 应用到 propose ✓
- spec §4.2「先读 brandbrain 自动补齐，只问缺的」→ Task 6 指令（靠已有的 brandContext 自动注入）✓
- spec §4.2「不做独立 recallBrandFact」（创始人拍板）→ 本计划无该 skill ✓
- spec money-safety（钱路不动）→ 本计划零触碰 startGen/generate/worker ✓
- 注：spec §4.1-B `clarify`（结构化问题卡）与 D/E（prompt 精通）、F（storyboard）、G（执行）**不在本块**——它们是后续 block，本块只做"资讯门框架 + 应用到 propose + 指令"。

**2. 占位符扫描：** 无 TBD；每个代码步骤都是完整可粘贴代码。Task 3 对 SDK `invoke` 签名给了明确的兜底说明（先 typecheck 确认）。

**3. 类型一致：** `{ field: string; question: string }[]` 在 spec/skill/OttoSkill/SkillMeta/propose 全程一致；`missingRequired`/`requires`/`needMoreInfo` 命名前后统一。

**4. 待复审的取舍（founder）：** 把 `goal` 门装到**通用 `propose`**（不止 ad flow）——琐碎请求 Otto 需推断填 goal。若嫌过度，删掉 `proposeSkill.requires` 一项即可解除，框架仍在、留给 block 3 的 `proposeStoryboard` 用。
