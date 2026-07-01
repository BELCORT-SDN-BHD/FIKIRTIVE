# Otto Prompt 精通 skills 实现计划 — `seedreamPrompt` + `seedancePrompt`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal（一句话）：** 加两个 $0 确定性"造 prompt"skill —— `seedreamPrompt`(图)/`seedancePrompt`(视频)：结构化创作意图 → 契合模型偏好的英文 prompt 字符串，喂进 `propose`。

**Architecture：** 纯 build-time 层，坐在 `@openai/agents` + `defineOttoSkill` 之上。两个 skill = `free/read/internal`（不审批、不建 GenJob、不碰钱路），execute 是**纯模板装配**（无额外 LLM）。共享一个 `prompt-vocab.ts`（词表 + reference 措辞）。Otto 被 skill 的 description/词表引导去填字段(用户不懂摄影)，装配器确定性拼装。

**Tech Stack：** TypeScript、Zod（已有）、`@openai/agents`（已有）、vitest。`packages/otto`。无新增运行时依赖。分支 `claude/otto-prompt-mastery`（stacked 在 block-1 / PR #83 之上）。

## Global Constraints（每个 task 都隐含遵守）

- **不动 agent loop / 钱路 / seam。** 不碰 `run()`/`RunState`/审批引擎、`ctx.startGen`/`reserveCredits`/worker/`byteplus.ts`。这两个 skill 纯装配字符串。
- **生成 prompt 一律英文**（模型英文调优）。skill 文档/注释用华语。
- **无面向用户的 `requires`。** 用户不懂 prompt/摄影 → Otto+skill 负责手艺。`subject`/`action` 是 zod 必填(Otto 从 goal/品牌上下文推断，不问用户)。
- **reference = 措辞 + 身份锁定，不搬像素。** skill 的 `references` 只承载 `role`/`name`（**禁止** `entityId`/身份字段 —— 会撞 `defineOttoSkill` 的身份键校验）。像素走 `propose` 的 `entityIds` → worker → API 参数（不在本计划）。
- **视频 `cleanFootage` 默认 true**（追加 `no on-screen text, watermark, or logo`）；图不默认加负向（图的 `textContent` 是刻意功能）。
- **不产出技术 flag。** `seedancePrompt` 只出创作 prompt；`--resolution/--duration/--ratio` 由 provider 追加。
- **行为保持。** 现有 13 skill + 全部既有测试不变；只新增 2 skill（registry.test 的计数 13→15）。
- Spec：`docs/superpowers/specs/2026-07-01-otto-prompt-mastery-seedream-seedance-design.md`。

---

## 文件结构（改哪些、各自职责）

- `packages/otto/src/skills/prompt-vocab.ts`（**新建**）— 共享 prompt 构件：镜头/景别/光/风格词表常量 + `promptRef` zod schema + `identityLockClause` 纯函数。两个 skill 都 import。
- `packages/otto/src/skills/prompt-vocab.test.ts`（**新建**）
- `packages/otto/src/skills/seedream-prompt.helpers.ts`（**新建**）— `seedreamPromptInput` schema + `assembleSeedream` 纯函数。
- `packages/otto/src/skills/seedream-prompt.ts`（**新建**）— `seedreamPromptSkill = defineOttoSkill(...)` + 裸 tool 导出。
- `packages/otto/src/skills/seedream-prompt.test.ts`（**新建**）
- `packages/otto/src/skills/seedance-prompt.helpers.ts`（**新建**）— `seedanceShot`/`seedancePromptInput` + `assembleSeedance`。
- `packages/otto/src/skills/seedance-prompt.ts`（**新建**）+ `.test.ts`（**新建**）
- `packages/otto/src/registry.ts`（**改**）— import + `allSkills` 加 2 项。
- `packages/otto/src/registry.test.ts`（**改**）— 13→15 + 两个新名。
- `packages/otto/src/skills/migration.test.ts`（**改**）— 两个新 skill 的 gate 断言。
- `packages/otto/src/instructions.ts`（**改**）+ `instructions.test.ts`（**改**）— 路由块（按 kind 调对应 skill → 喂进 propose）。
- `packages/otto/src/skills/CATALOG.md`（**生成**）。

**测试命令：** 单文件 `pnpm --filter @fikirtive/otto exec vitest run <相对路径>`；全套 `pnpm --filter @fikirtive/otto exec vitest run`；typecheck `pnpm --filter @fikirtive/otto exec tsc --noEmit`。

---

## Task 1: `prompt-vocab.ts` — 共享词表 + reference 措辞

**Files:**
- Create: `packages/otto/src/skills/prompt-vocab.ts`
- Test: `packages/otto/src/skills/prompt-vocab.test.ts`

**Interfaces:**
- Produces: `promptRef` (z.object)、`PromptRef` (type)、`identityLockClause(refs: PromptRef[]): string`、常量 `CAMERA_MOVES/SHOT_SCALES/CAMERA_ANGLES/LIGHTING/STYLES/PACING`。

- [ ] **Step 1: 写失败测试** — `prompt-vocab.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { identityLockClause, promptRef, CAMERA_MOVES } from "./prompt-vocab.js";

describe("identityLockClause", () => {
  it("empty refs → empty string", () => {
    expect(identityLockClause([])).toBe("");
  });
  it("product lock phrasing names the entity", () => {
    const out = identityLockClause([{ role: "product", name: "the AeroBottle", lock: true }]);
    expect(out).toContain("the AeroBottle");
    expect(out).toContain("same shape, color, and label");
  });
  it("character lock preserves face/hair/build", () => {
    const out = identityLockClause([{ role: "character", name: "Mia", lock: true }]);
    expect(out).toContain("same face, hairstyle, and build");
  });
  it("lock:false switches to stylistic-inspiration phrasing", () => {
    const out = identityLockClause([{ role: "location", name: "the loft", lock: false }]);
    expect(out).toContain("draw stylistic inspiration from the loft");
  });
  it("multiple refs joined with '; '", () => {
    const out = identityLockClause([
      { role: "product", name: "A", lock: true },
      { role: "brandmark", name: "B", lock: true },
    ]);
    expect(out).toContain("; ");
    expect(out).toContain("reproduce the B logo");
  });
});

describe("promptRef schema", () => {
  it("defaults lock to true", () => {
    expect(promptRef.parse({ role: "product", name: "X" }).lock).toBe(true);
  });
  it("rejects an unknown role", () => {
    expect(promptRef.safeParse({ role: "vehicle", name: "X" }).success).toBe(false);
  });
});

describe("vocab constants", () => {
  it("camera moves is a non-empty readonly list", () => {
    expect(CAMERA_MOVES.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/prompt-vocab.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 `prompt-vocab.ts`**

```ts
/**
 * 共享 prompt 构件 —— 词表常量 + reference 身份锁定措辞。
 * 被 seedream-prompt / seedance-prompt 两个 skill 复用。纯数据 + 纯函数，无 DB/网络。
 */
import { z } from "zod";

// 参考列表（给 skill 的 description 引导 Otto 用“画得出来”的词），不做 enum —— 字段保持自由文本。
export const CAMERA_MOVES = [
  "dolly in (推镜头)", "pull out (拉镜头)", "pan (摇镜头)", "tracking (跟拍)",
  "orbit (环绕)", "aerial (航拍)", "handheld follow (手持跟拍)", "crane up/down (升降)",
  "fixed (固定)", "one continuous take (一镜到底)",
] as const; // 规则：每 shot 只用一个
export const SHOT_SCALES = ["extreme wide", "wide", "full", "medium", "medium close-up", "close-up", "extreme close-up"] as const;
export const CAMERA_ANGLES = ["eye-level", "high-angle", "low-angle", "bird's-eye", "POV"] as const;
export const LIGHTING = [
  "golden hour", "dramatic side light", "soft diffused", "moody low-key", "bright high-key",
  "studio soft box (45°)", "backlight / rim", "neon", "volumetric", "natural window light",
] as const; // 规则：给方向 + 色温，别写“漂亮的光”
export const STYLES = [
  "cinematic", "photorealistic", "editorial photography", "product photography", "documentary",
  "film grain", "3D CG render", "ink-wash (水墨)", "cyberpunk neon", "minimalist",
] as const;
export const PACING = ["slow-motion", "hard cut", "fast cut", "timelapse", "one continuous take"] as const;

/** reference：像素不在这里（走 propose 的 entityIds → API 参数）。只承载织入英文措辞所需的 role + name。 */
export const promptRef = z.object({
  role: z.enum(["character", "product", "location", "brandmark"]),
  name: z.string().min(1).max(64),
  lock: z.boolean().default(true), // true=锁一致；false=只借鉴风格
});
export type PromptRef = z.infer<typeof promptRef>;
type Role = PromptRef["role"];

/** 纯：把每个 reference 织成一句英文身份锁定/风格借鉴短语，用 "; " 连接。空 refs → ""。 */
export function identityLockClause(refs: PromptRef[]): string {
  if (refs.length === 0) return "";
  const lock: Record<Role, (n: string) => string> = {
    character: (n) => `keep ${n} identical to the reference, same face, hairstyle, and build`,
    product: (n) => `feature ${n} exactly as in the reference, same shape, color, and label`,
    location: (n) => `match the setting of ${n} to the reference environment`,
    brandmark: (n) => `reproduce the ${n} logo exactly as in the reference, unaltered`,
  };
  const style = (n: string) => `draw stylistic inspiration from ${n}`;
  return refs.map((r) => (r.lock ? lock[r.role] : style)(r.name)).join("; ");
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/prompt-vocab.test.ts`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add packages/otto/src/skills/prompt-vocab.ts packages/otto/src/skills/prompt-vocab.test.ts
git commit -m "feat(otto): prompt-vocab — shared camera/lighting/style vocab + reference identity-lock"
```

---

## Task 2: `seedreamPrompt` skill（图，Seedream 5.0）

**Files:**
- Create: `packages/otto/src/skills/seedream-prompt.helpers.ts`
- Create: `packages/otto/src/skills/seedream-prompt.ts`
- Test: `packages/otto/src/skills/seedream-prompt.test.ts`

**Interfaces:**
- Consumes: `promptRef`/`identityLockClause`（Task 1）；`defineOttoSkill`（`../skill.js`）。
- Produces: `seedreamPromptInput`、`SeedreamPromptInput`、`assembleSeedream(i): string`、`seedreamPromptSkill`（`OttoSkill`）、`seedreamPrompt`（tool）。

- [ ] **Step 1: 写失败测试** — `seedream-prompt.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { assembleSeedream, seedreamPromptInput } from "./seedream-prompt.helpers.js";
import { seedreamPromptSkill } from "./seedream-prompt.js";

describe("assembleSeedream", () => {
  it("t2i joins present fields in order, subject first", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({
      subject: "a matte-black wireless headphone",
      environment: "cream gradient background",
      style: "premium product photography",
      lighting: "soft box from upper-left",
    }));
    expect(out.startsWith("a matte-black wireless headphone")).toBe(true);
    expect(out).toContain("premium product photography");
    // subject before style
    expect(out.indexOf("headphone")).toBeLessThan(out.indexOf("premium"));
  });
  it("forVideo appends the animatable-frame clause", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({ subject: "a shoe", forVideo: true }));
    expect(out).toContain("clean uncluttered composition with headroom for motion");
  });
  it("textContent is quoted and placed last", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({ subject: "a poster", textContent: "50% OFF" }));
    expect(out).toContain('with the text "50% OFF"');
    expect(out.trim().endsWith("placed prominently")).toBe(true);
  });
  it("references weave an identity-lock clause after 'featuring'", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({
      subject: "a hero shot",
      references: [{ role: "product", name: "the AeroBottle" }],
    }));
    expect(out).toContain("featuring feature the AeroBottle exactly as in the reference");
  });
  it("i2i mode builds an edit instruction, not a fresh scene", () => {
    const out = assembleSeedream(seedreamPromptInput.parse({
      mode: "i2i", editVerb: "Replace", editTarget: "the background with a beach sunset",
      preserve: "preserve all foreground elements exactly",
    }));
    expect(out.startsWith("Replace the background with a beach sunset")).toBe(true);
    expect(out).toContain("preserve all foreground elements exactly");
  });
});

describe("seedreamPromptSkill gate", () => {
  it("free/read/internal → not gated, no requires", () => {
    expect(seedreamPromptSkill.cost).toBe("free");
    expect(seedreamPromptSkill.effect).toBe("read");
    expect(seedreamPromptSkill.needsApproval).toBe(false);
    expect(seedreamPromptSkill.requires).toEqual([]);
  });
  it("built tool returns { prompt } from assembly", async () => {
    const invoke = seedreamPromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<unknown> };
    const out = await invoke.invoke({ context: {} }, JSON.stringify({ subject: "a red apple" }));
    expect(out).toEqual({ prompt: "a red apple" });
  });
});
```

> 注：i2i 例子里 `mode:"i2i"` 时 `subject` 仍是 schema 必填 —— 测试的 parse 需带 subject，或在实现里把 subject 设为 t2i-only。**决定：** subject 对两种 mode 都必填（Otto i2i 时给个占位主体即可），parse 里补 `subject`。若嫌别扭，可在 helpers 用 `.superRefine` 让 i2i 免 subject —— 但 YAGNI，先都必填。上面 i2i 测试请加 `subject: "the source image"`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/seedream-prompt.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 `seedream-prompt.helpers.ts`**

```ts
import { z } from "zod";
import { promptRef, identityLockClause } from "./prompt-vocab.js";

export const seedreamPromptInput = z.object({
  mode: z.enum(["t2i", "i2i"]).default("t2i"),
  subject: z.string().min(1),
  actionPose: z.string().optional(),
  environment: z.string().optional(),
  style: z.string().optional(),
  lighting: z.string().optional(),
  colorPalette: z.string().optional(),
  cameraLens: z.string().optional(),
  mood: z.string().optional(),
  detail: z.string().optional(),
  textContent: z.string().max(60).optional(),
  forVideo: z.boolean().default(false),
  references: z.array(promptRef).max(8).default([]),
  editVerb: z.enum(["Add", "Remove", "Replace", "Change"]).optional(),
  editTarget: z.string().optional(),
  preserve: z.string().optional(),
});
export type SeedreamPromptInput = z.infer<typeof seedreamPromptInput>;

/** 纯：结构化意图 → Seedream 偏好的英文 prose prompt（最前 token 权重最高）。 */
export function assembleSeedream(i: SeedreamPromptInput): string {
  const locks = identityLockClause(i.references);
  if (i.mode === "i2i") {
    const parts: (string | false | undefined)[] = [
      `${i.editVerb ?? "Change"} ${i.editTarget ?? ""}`.trim(),
      i.style && `restyle to ${i.style}`,
      i.lighting,
      locks,
      i.preserve ?? "keep everything else unchanged, maintain the same composition and lighting",
    ];
    return parts.filter(Boolean).join(", ");
  }
  const parts: (string | false | undefined)[] = [
    i.subject,
    i.actionPose,
    i.environment,
    i.style,
    i.lighting,
    i.colorPalette,
    i.cameraLens,
    i.mood,
    i.detail,
    i.forVideo && "clean uncluttered composition with headroom for motion, single dominant light direction",
    locks && `featuring ${locks}`,
    i.textContent && `with the text "${i.textContent}" in bold sans-serif, placed prominently`,
  ];
  return parts.filter(Boolean).join(", ");
}
```

- [ ] **Step 4: 实现 `seedream-prompt.ts`**

```ts
/**
 * seedreamPrompt — $0 确定性图像 prompt 装配 skill（free/read/internal → 不审批）。
 * 结构化意图 → Seedream 调优的英文 prompt 字符串；Otto 把它喂进 propose.structuredPrompt。
 */
import { defineOttoSkill } from "../skill.js";
import { seedreamPromptInput, assembleSeedream } from "./seedream-prompt.helpers.js";

export const seedreamPromptSkill = defineOttoSkill({
  name: "seedreamPrompt",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Assemble a model-tuned English IMAGE prompt for Seedream. Call this FIRST whenever you are about " +
    "to propose an image, then pass the returned `prompt` as propose's structuredPrompt. Our users don't " +
    "know photography — YOU supply the craft: always give a concrete subject, and add style, lighting " +
    "(direction + color temperature), camera/lens, and composition even if the user didn't mention them. " +
    "Use mode:'i2i' to edit a source image (fill editVerb + editTarget + what to preserve). Set forVideo:true " +
    "when the image is a video's first frame. List any @-referenced entities in `references` (role + name) so " +
    "their identity is locked; the reference image itself is passed separately via propose's entityIds.",
  parameters: seedreamPromptInput,
  execute: async (i) => ({ prompt: assembleSeedream(i) }),
});

export const seedreamPrompt = seedreamPromptSkill.tool;
```

- [ ] **Step 5: 跑测试确认通过**（先把 Step-1 i2i 测试补上 `subject: "the source image"`）

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/seedream-prompt.test.ts`
Expected: PASS。

- [ ] **Step 6: commit**

```bash
git add packages/otto/src/skills/seedream-prompt.ts packages/otto/src/skills/seedream-prompt.helpers.ts packages/otto/src/skills/seedream-prompt.test.ts
git commit -m "feat(otto): seedreamPrompt — deterministic Seedream image-prompt assembler"
```

---

## Task 3: `seedancePrompt` skill（视频，Seedance 2.0）

**Files:**
- Create: `packages/otto/src/skills/seedance-prompt.helpers.ts`
- Create: `packages/otto/src/skills/seedance-prompt.ts`
- Test: `packages/otto/src/skills/seedance-prompt.test.ts`

**Interfaces:**
- Consumes: `promptRef`/`identityLockClause`（Task 1）；`defineOttoSkill`。
- Produces: `seedanceShot`、`seedancePromptInput`、`SeedancePromptInput`、`assembleSeedance(i): string`、`seedancePromptSkill`、`seedancePrompt`（tool）。

- [ ] **Step 1: 写失败测试** — `seedance-prompt.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { assembleSeedance, seedancePromptInput } from "./seedance-prompt.helpers.js";
import { seedancePromptSkill } from "./seedance-prompt.js";

describe("assembleSeedance", () => {
  const oneShot = (over = {}) => seedancePromptInput.parse({
    shots: [{ subject: "the man in the frame", action: "stops at the door, takes a deep breath", camera: "slow dolly in", ...over }],
  });

  it("i2v single shot opens with the first-frame phrase and has no Shot label", () => {
    const out = assembleSeedance(oneShot());
    expect(out).toContain("starting from the given first frame,");
    expect(out).not.toContain("Shot 1:");
  });
  it("emits NO technical flags", () => {
    const out = assembleSeedance(oneShot());
    expect(out).not.toContain("--resolution");
    expect(out).not.toContain("--duration");
  });
  it("i2v adds a subject-consistency line", () => {
    expect(assembleSeedance(oneShot())).toContain("keep the subject consistent with the source frame");
  });
  it("cleanFootage (default) appends the no-text/watermark/logo line", () => {
    expect(assembleSeedance(oneShot())).toContain("no on-screen text, watermark, or logo");
  });
  it("cleanFootage:false drops the negative line", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      cleanFootage: false, shots: [{ subject: "a logo sting", action: "the logo animates in" }],
    }));
    expect(out).not.toContain("no on-screen text");
  });
  it("audio goes on its own line", () => {
    const out = assembleSeedance(oneShot({ audio: "quiet room tone" }));
    expect(out).toContain("\nAudio: quiet room tone");
  });
  it("multi-shot labels each beat", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [
        { subject: "the car", action: "drifts around the bend" },
        { subject: "the driver", action: "smiles" },
      ],
    }));
    expect(out).toContain("Shot 1:");
    expect(out).toContain("Shot 2:");
  });
  it("continuesFromPrev opens with the handoff phrase", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      continuesFromPrev: true, shots: [{ subject: "the swordsman", action: "raises the blade" }],
    }));
    expect(out).toContain("continuing from the previous frame,");
    expect(out).not.toContain("starting from the given first frame,");
  });
  it("references append an identity-lock clause", () => {
    const out = assembleSeedance(oneShot({}));
    const withRef = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "the mascot", action: "waves" }],
      references: [{ role: "character", name: "Otto the fox" }],
    }));
    expect(withRef).toContain("keep Otto the fox identical to the reference");
    expect(out).not.toContain("Otto the fox");
  });
});

describe("seedancePromptSkill gate", () => {
  it("free/read/internal → not gated, no requires", () => {
    expect(seedancePromptSkill.cost).toBe("free");
    expect(seedancePromptSkill.effect).toBe("read");
    expect(seedancePromptSkill.needsApproval).toBe(false);
    expect(seedancePromptSkill.requires).toEqual([]);
  });
  it("built tool returns { prompt } from assembly", async () => {
    const invoke = seedancePromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<unknown> };
    const out = await invoke.invoke({ context: {} }, JSON.stringify({ shots: [{ subject: "a cat", action: "leaps" }] })) as { prompt: string };
    expect(typeof out.prompt).toBe("string");
    expect(out.prompt).toContain("a cat");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/seedance-prompt.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 `seedance-prompt.helpers.ts`**

```ts
import { z } from "zod";
import { promptRef, identityLockClause } from "./prompt-vocab.js";

export const seedanceShot = z.object({
  subject: z.string().min(1),
  action: z.string().min(1),
  camera: z.string().optional(),
  shotFraming: z.string().optional(),
  sceneLight: z.string().optional(),
  mood: z.string().optional(),
  audio: z.string().optional(),
});

export const seedancePromptInput = z.object({
  mode: z.enum(["i2v", "t2v"]).default("i2v"),
  style: z.string().optional(),
  pacing: z.string().optional(),
  shots: z.array(seedanceShot).min(1).max(4),
  continuesFromPrev: z.boolean().default(false),
  references: z.array(promptRef).max(8).default([]),
  cleanFootage: z.boolean().default(true),
  constraints: z.string().optional(),
});
export type SeedancePromptInput = z.infer<typeof seedancePromptInput>;

/** 纯：结构化意图 → Seedance 创作 prompt（英文，无技术 flag —— provider 追加 --resolution/--duration/--ratio）。 */
export function assembleSeedance(i: SeedancePromptInput): string {
  const lines: string[] = [];
  if (i.style) lines.push(i.style);
  const single = i.shots.length === 1;
  i.shots.forEach((s, idx) => {
    const seg = [
      idx === 0 && i.continuesFromPrev && "continuing from the previous frame,",
      idx === 0 && !i.continuesFromPrev && i.mode === "i2v" && "starting from the given first frame,",
      s.shotFraming,
      s.subject,
      s.action,
      s.camera,
      s.sceneLight,
      s.mood,
    ].filter(Boolean).join(", ");
    lines.push(single ? seg : `Shot ${idx + 1}: ${seg}`);
    if (s.audio) lines.push(`Audio: ${s.audio}`);
  });
  if (i.mode === "i2v") lines.push("keep the subject consistent with the source frame, preserve face and outfit");
  const locks = identityLockClause(i.references);
  if (locks) lines.push(locks);
  if (i.pacing) lines.push(i.pacing);
  if (i.cleanFootage) lines.push("no on-screen text, watermark, or logo");
  if (i.constraints) lines.push(i.constraints);
  return lines.join("\n");
}
```

- [ ] **Step 4: 实现 `seedance-prompt.ts`**

```ts
/**
 * seedancePrompt — $0 确定性视频 prompt 装配 skill（free/read/internal → 不审批）。
 * 只出创作 prompt（英文），技术 flag 由 provider 追加。Otto 提视频前先调它、用返回的 prompt。
 */
import { defineOttoSkill } from "../skill.js";
import { seedancePromptInput, assembleSeedance } from "./seedance-prompt.helpers.js";

export const seedancePromptSkill = defineOttoSkill({
  name: "seedancePrompt",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Assemble a model-tuned English VIDEO prompt for Seedance — the CREATIVE prompt only; never add " +
    "resolution/duration/ratio (the system appends those). Call this FIRST before proposing a video, then use " +
    "the returned `prompt`. Primary mode i2v: describe the MOTION relative to the first frame (what moves, how), " +
    "not the static scene. Our users don't know cinematography — YOU fill it: give each shot a clear action, and " +
    "add exactly ONE camera move, a shot framing, and scene lighting even if unmentioned. One shot = one beat; use " +
    "up to 4 shots for a multi-beat clip. Set continuesFromPrev:true for a shot that follows a prior clip. List " +
    "@-referenced entities in `references` to lock identity. cleanFootage defaults true (bans on-screen " +
    "text/watermark/logo) — set false only when text or a logo should appear in the video.",
  parameters: seedancePromptInput,
  execute: async (i) => ({ prompt: assembleSeedance(i) }),
});

export const seedancePrompt = seedancePromptSkill.tool;
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/skills/seedance-prompt.test.ts`
Expected: PASS。

- [ ] **Step 6: commit**

```bash
git add packages/otto/src/skills/seedance-prompt.ts packages/otto/src/skills/seedance-prompt.helpers.ts packages/otto/src/skills/seedance-prompt.test.ts
git commit -m "feat(otto): seedancePrompt — deterministic Seedance video-prompt assembler"
```

---

## Task 4: 注册 + registry/migration 测试

**Files:**
- Modify: `packages/otto/src/registry.ts`
- Modify: `packages/otto/src/registry.test.ts`
- Modify: `packages/otto/src/skills/migration.test.ts`

**Interfaces:**
- Consumes: `seedreamPromptSkill`（Task 2）、`seedancePromptSkill`（Task 3）。
- Produces: `allSkills` 含两新 skill（共 15）；catalog 自动携带其 meta。

- [ ] **Step 1: 写失败测试** — 改 `registry.test.ts` 的计数断言

将 `registry.test.ts` 第 6-9 行的 "thirteen" 测试替换为：

```ts
  it("collects all fifteen skills", () => {
    const names = allSkills.map((s) => s.name).sort();
    expect(names).toEqual(["describeRefs", "generate", "list-meta-pages", "meta-insights", "meta-list-objects", "propose", "propose-ad-build", "propose-meta-action", "proposePack", "rememberBrandFact", "researchWeb", "seedancePrompt", "seedreamPrompt", "setTitle", "updateBrief"]);
  });
```

在 `migration.test.ts` 末尾追加：

```ts
import { seedreamPromptSkill } from "./seedream-prompt.js";
import { seedancePromptSkill } from "./seedance-prompt.js";

describe("prompt-mastery skills gate", () => {
  it("seedreamPrompt: free/read/internal → not gated", () => {
    expect(seedreamPromptSkill.cost).toBe("free");
    expect(seedreamPromptSkill.effect).toBe("read");
    expect(seedreamPromptSkill.needsApproval).toBe(false);
  });
  it("seedancePrompt: free/read/internal → not gated", () => {
    expect(seedancePromptSkill.effect).toBe("read");
    expect(seedancePromptSkill.needsApproval).toBe(false);
  });
});
```
（`migration.test.ts` 顶部已 import 了几个 skill；把上面两个 import 加到文件顶部的 import 区，`describe` 加到文件末尾。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/registry.test.ts src/skills/migration.test.ts`
Expected: FAIL — registry 仍 13 个 + 两个新 skill 模块未在 registry 注册（migration import 的是新 skill 文件，存在；但 registry 计数会失败因为还没加进 allSkills）。

- [ ] **Step 3: 改 `registry.ts`** — 加 import + array 项

在 import 区末尾（`proposeAdBuildSkill` 之后）加：

```ts
import { seedreamPromptSkill } from "./skills/seedream-prompt.js";
import { seedancePromptSkill } from "./skills/seedance-prompt.js";
```

在 `allSkills` 数组末尾（`proposeAdBuildSkill,` 之后）加：

```ts
  seedreamPromptSkill,
  seedancePromptSkill,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/registry.test.ts src/skills/migration.test.ts`
Expected: PASS（registry 15 个、catalog 携带 requires（两新 skill 的 requires=[]）、gate 断言绿）。

- [ ] **Step 5: commit**

```bash
git add packages/otto/src/registry.ts packages/otto/src/registry.test.ts packages/otto/src/skills/migration.test.ts
git commit -m "feat(otto): register seedreamPrompt + seedancePrompt (registry 13→15)"
```

---

## Task 5: 指令路由块（按 kind 调对应 skill → 喂进 propose）

**Files:**
- Modify: `packages/otto/src/instructions.ts`
- Modify: `packages/otto/src/instructions.test.ts`

- [ ] **Step 1: 写失败测试** — 追加到 `instructions.test.ts`

```ts
describe("ottoInstructions — model prompt routing", () => {
  it("routes image → seedreamPrompt and video → seedancePrompt", () => {
    expect(ottoInstructions).toMatch(/seedreamPrompt/);
    expect(ottoInstructions).toMatch(/seedancePrompt/);
  });
  it("tells Otto to feed the result into propose's structuredPrompt", () => {
    expect(ottoInstructions).toMatch(/structuredPrompt/);
  });
  it("tells Otto to supply the craft (users don't know photography)", () => {
    expect(ottoInstructions).toMatch(/camera|lighting/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/instructions.test.ts`
Expected: FAIL — 无该块。

- [ ] **Step 3: 在 `ottoInstructions` 加路由块**（放在 "When to call `propose`" 之前）

```
## Craft the prompt with the model skill (Seedream / Seedance)

Before you propose a generation, build the prompt with the model-specific skill — do not hand-write raw prompts for these models:
- Image (kind:"image") → call **seedreamPrompt** first, then call propose with structuredPrompt set to the returned prompt.
- Video (kind:"video") → call **seedancePrompt** first (it returns the creative prompt only — the system adds resolution/duration/ratio), then propose the video with that prompt.

Our users don't know prompting or photography — these skills exist so YOU supply the craft (subject, camera move, lighting, composition). Fill those fields yourself from the goal and brand context; never ask the user for camera or lighting choices. For any @-referenced entity, pass it in the skill's `references` (role + name) so identity is locked, and still pass its id via propose's entityIds — that is how the reference image reaches the model.
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/instructions.test.ts`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add packages/otto/src/instructions.ts packages/otto/src/instructions.test.ts
git commit -m "feat(otto): instructions — route image/video prompts through seedream/seedance skills"
```

---

## Task 6: 重生成 CATALOG + 全套回归

**Files:**
- Modify: `packages/otto/src/skills/CATALOG.md`（生成）

- [ ] **Step 1: 重生成 catalog**

Run: `pnpm --filter @fikirtive/otto run catalog`
Expected: `CATALOG.md` 多出 `seedancePrompt`/`seedreamPrompt` 两行（free/read/internal/❌）。

- [ ] **Step 2: 全套 otto 测试**

Run: `pnpm --filter @fikirtive/otto exec vitest run`
Expected: 全绿（新增 prompt-vocab/seedream/seedance 测试 + 既有全部）。

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @fikirtive/otto exec tsc --noEmit`
Expected: 干净。（若推送：`.githooks/pre-push` 跑 `pnpm -r typecheck`，fresh worktree 需先 `pnpm -r --filter './packages/*' build` 才能过 apps/worker 的跨包解析 —— 见 [[fikirtive-monorepo-deploy-gotchas]] 家族坑。）

- [ ] **Step 4: commit**

```bash
git add packages/otto/src/skills/CATALOG.md
git commit -m "chore(otto): regenerate skill catalog (seedream/seedance prompt skills)"
```

---

## Self-Review（对照 spec）

**1. Spec 覆盖：**
- §4 seedreamPrompt（schema/模板/i2i/forVideo/references）→ Task 2 ✓
- §5 seedancePrompt（shots/i2v/continuesFromPrev/cleanFootage/references/无 flag）→ Task 3 ✓
- §6 共享词表 + identityLockClause → Task 1 ✓
- §7 gate（free/read/internal 不审批、无 requires）+ 指令路由 → Task 2/3 gate + Task 5 ✓
- §8 build 顺序 → Task 1→6 ✓
- 决策：英文（全模板英文）✓；无 user requires（两 skill 无 requires）✓；视频默认 cleanFootage ✓；reference=措辞 role/name 不带 entityId ✓
- 明确不在本计划：多参考真喂 provider（`task_dc06ac5a`）、看图 prompt 多模态（`task_21c8587b`）、storyboard 每-shot 调用（block F）

**2. 占位符扫描：** 无 TBD；每步完整代码。invoke-based 门测试沿用 block-1 已验证的 `FunctionTool.invoke(runContext, argsJson)`（@openai/agents-core 0.11.8）。

**3. 类型一致：** `promptRef`/`PromptRef`/`identityLockClause`、`seedreamPromptInput`/`assembleSeedream`、`seedancePromptInput`/`assembleSeedance`、skill 名 `seedreamPrompt`/`seedancePrompt` 全程一致；registry 排序数组含两新名（大小写字序已核）。

**4. 待复审的取舍：** i2i 的 `subject` 仍必填（Otto 填占位主体）——若founder 想 i2i 免 subject，改 helpers 一处 superRefine 即可。
