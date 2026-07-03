# Otto P0 · Meta 专家知识库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一份**带引用、结构化、深研自 Meta Blueprint 官方认证课纲**的 Meta 广告专业知识模块(`packages/otto/src/knowledge/meta-expertise.*`),作为 metaExpert 诊断(P2)的"大脑",也是将来打广告 skill 的地基。

**Architecture:** 三层纯代码文件(types / data / api)+ 一次编排式深度研究(Workflow 产出带引用的知识语料)。知识**冻进确定性数据 + schema 校验**(宪法第 10 条:技能为弱模型设计),质量来自结构不来自模型天赋。运行时 $0(build-time 一次性研究,产物是静态 `.ts`)。无 prisma/pg 依赖 —— 纯数据 + 纯函数,client-safe。

**Tech Stack:** TypeScript(`packages/otto`,ESM,`.js` 扩展名 import)· vitest · 无新依赖。研究经 Workflow(WebSearch/WebFetch,free-first)。

## Global Constraints

- **铁律(反捏造,verbatim from spec §5/§7):** 每条知识 entry **必须挂 ≥1 条 `{url,title,retrievedAt}` 引用**;**不逐字复制** Meta 材料(版权 + 反漂移),蒸馏成带引用的事实/原则;只用**公开**官方资料(exam study guide / skill domains / Meta Business Help Center / 官方 best-practice),门控课程正文拿不到就不收,知识库注明覆盖边界。
- **宪法第 10 条:** 专家判断冻进 data/schema,不靠运行时模型即兴。
- **$0 运行时:** 产物是静态 `.ts` 数据;**真实付费深研先问 founder**(free-first:WebSearch/WebFetch 与 Tavily/Brave 免费档;见 [[efficiency-conscience-meaning]])。
- **语言:** 本 plan + 源清单 doc 华语;知识 `claim`/`detail` 随源(英文为主);代码/标识符英文。
- **时效:** 每条引用带 `retrievedAt`(ISO 日期,由执行时传入,不用 `Date.now()`)。
- **KB `version`:** 字符串 `"2026-07-03"`(执行时的日期,硬编码进数据文件,不运行时取时钟)。
- **构建闸:** 结束跑 `pnpm --filter @fikirtive/otto build` 与 `pnpm --filter @fikirtive/web build`,均须 EXIT 0(KB 纯数据 client-safe,但守 web-build 闸 #105)。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/otto/src/knowledge/meta-expertise.types.ts` | 类型:`MetaKnowledgeDomain` / `MetaCitation` / `MetaBenchmark` / `MetaKnowledgeEntry` / `MetaExpertiseKB` |
| `packages/otto/src/knowledge/meta-expertise.data.ts` | `META_EXPERTISE_KB: MetaExpertiseKB` 常量(深研蒸馏的真实带引用数据 —— Task 3/4 产物) |
| `packages/otto/src/knowledge/meta-expertise.ts` | 公共 API:`validateKnowledgeBase` + `queryMetaKnowledge` + `getBenchmark` + re-export types + 导出 `META_EXPERTISE_KB` |
| `packages/otto/src/knowledge/meta-expertise.test.ts` | 校验器 / 查询器单测 + 真实 KB 的完整性&覆盖断言 |
| `docs/research/2026-07-03-meta-blueprint-expertise-sources.md` | 源清单 + 覆盖边界说明(华语)+ 研究方法留痕 |

`packages/otto/src/index.ts` 追加 re-export(供 P2 import)。

---

### Task 1: 类型 + 校验器(validateKnowledgeBase)

**Files:**
- Create: `packages/otto/src/knowledge/meta-expertise.types.ts`
- Create: `packages/otto/src/knowledge/meta-expertise.ts`
- Test: `packages/otto/src/knowledge/meta-expertise.test.ts`

**Interfaces:**
- Produces:
  - `type MetaKnowledgeDomain = "objectives" | "bidding" | "targeting" | "creative" | "measurement" | "algorithm" | "diagnosis"`
  - `type MetaCitation = { url: string; title: string; retrievedAt: string }`
  - `type MetaBenchmark = { metric: string; objective?: string; industry?: string; range: string; note?: string }`
  - `type MetaKnowledgeEntry = { id: string; domain: MetaKnowledgeDomain; claim: string; detail?: string; benchmark?: MetaBenchmark; appliesWhen?: string; sourceCert?: string; citations: MetaCitation[] }`
  - `type MetaExpertiseKB = { version: string; entries: MetaKnowledgeEntry[]; sources: MetaCitation[] }`
  - `function validateKnowledgeBase(kb: MetaExpertiseKB): string[]` — 返回错误串数组,**空 = 合法**。检查:claim 非空、`citations.length >= 1`(无引用 = 捏造风险)、id 唯一、每条 citation.url 是 http(s)、domain 合法。

- [ ] **Step 1: Write the failing test**

`packages/otto/src/knowledge/meta-expertise.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/knowledge/meta-expertise.test.ts`
Expected: FAIL(`validateKnowledgeBase` / types 未定义)。

- [ ] **Step 3: Write the types**

`packages/otto/src/knowledge/meta-expertise.types.ts`:
```ts
export type MetaKnowledgeDomain =
  | "objectives"   // campaign objectives & when to use each
  | "bidding"      // bid strategies, budget, learning
  | "targeting"    // audiences, targeting
  | "creative"     // creative & copy best practices
  | "measurement"  // metrics meaning, attribution, ROAS, benchmarks
  | "algorithm"    // delivery / learning-phase mechanics
  | "diagnosis";   // symptom → likely cause → expert action

export type MetaCitation = { url: string; title: string; retrievedAt: string };

export type MetaBenchmark = {
  metric: string;      // "CTR" | "CPC" | "ROAS" | "frequency" | ...
  objective?: string;  // "traffic" | "conversions" | "awareness" | ...
  industry?: string;   // "ecommerce" | "retail" | ... (optional)
  range: string;       // human-readable, e.g. "0.9%–1.6% (median ~1.2%)"
  note?: string;
};

export type MetaKnowledgeEntry = {
  id: string;                  // stable kebab id, unique
  domain: MetaKnowledgeDomain;
  claim: string;               // distilled expert principle/fact (NOT copied verbatim)
  detail?: string;
  benchmark?: MetaBenchmark;
  appliesWhen?: string;        // condition under which the claim applies
  sourceCert?: string;         // which Blueprint cert/domain it came from
  citations: MetaCitation[];   // MUST be non-empty
};

export type MetaExpertiseKB = {
  version: string;             // build date, e.g. "2026-07-03"
  entries: MetaKnowledgeEntry[];
  sources: MetaCitation[];     // master source list
};
```

- [ ] **Step 4: Write the validator**

`packages/otto/src/knowledge/meta-expertise.ts`:
```ts
import type { MetaExpertiseKB, MetaKnowledgeDomain } from "./meta-expertise.types.js";

const DOMAINS: ReadonlySet<MetaKnowledgeDomain> = new Set([
  "objectives", "bidding", "targeting", "creative", "measurement", "algorithm", "diagnosis",
]);

/** Returns a list of problems; empty array = valid. The citation check is the
 *  anti-fabrication floor: every knowledge entry must trace to a real source. */
export function validateKnowledgeBase(kb: MetaExpertiseKB): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of kb.entries) {
    if (!e.claim || !e.claim.trim()) errors.push(`entry ${e.id}: empty claim`);
    if (!DOMAINS.has(e.domain)) errors.push(`entry ${e.id}: invalid domain ${e.domain}`);
    if (e.citations.length === 0) errors.push(`entry ${e.id}: no citation (fabrication risk)`);
    if (seen.has(e.id)) errors.push(`duplicate entry id ${e.id}`);
    seen.add(e.id);
    for (const c of e.citations) {
      if (!/^https?:\/\//.test(c.url)) errors.push(`entry ${e.id}: citation url not http(s): ${c.url}`);
    }
  }
  return errors;
}

export type { MetaExpertiseKB, MetaKnowledgeDomain, MetaCitation, MetaBenchmark, MetaKnowledgeEntry } from "./meta-expertise.types.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/knowledge/meta-expertise.test.ts`
Expected: PASS(5 个)。

- [ ] **Step 6: Commit**

```bash
git add packages/otto/src/knowledge/meta-expertise.types.ts packages/otto/src/knowledge/meta-expertise.ts packages/otto/src/knowledge/meta-expertise.test.ts
git commit -m "feat(otto): P0 Meta expertise KB types + validateKnowledgeBase (citation-floor)"
```

---

### Task 2: 查询器(queryMetaKnowledge + getBenchmark)

**Files:**
- Modify: `packages/otto/src/knowledge/meta-expertise.ts`(追加两个查询函数)
- Test: `packages/otto/src/knowledge/meta-expertise.test.ts`(追加 describe 块)

**Interfaces:**
- Consumes: Task 1 的类型 + `validateKnowledgeBase`。
- Produces:
  - `function queryMetaKnowledge(kb: MetaExpertiseKB, filter: { domain?: MetaKnowledgeDomain; metric?: string; objective?: string }): MetaKnowledgeEntry[]` — AND 语义;`metric`/`objective` 匹配 `entry.benchmark` 的对应字段(大小写不敏感);无 filter → 全部。
  - `function getBenchmark(kb: MetaExpertiseKB, q: { metric: string; objective?: string; industry?: string }): MetaKnowledgeEntry | null` — 返回最匹配的 benchmark entry(优先 objective+industry 都命中 > 仅 objective > 仅 metric),无则 `null`。P2 用它把用户真指标 ⟂ 引用基准。

- [ ] **Step 1: Write the failing test**

追加到 `meta-expertise.test.ts`:
```ts
import { queryMetaKnowledge, getBenchmark } from "./meta-expertise.js";

const KBX = {
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
} as const;

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/knowledge/meta-expertise.test.ts`
Expected: FAIL(`queryMetaKnowledge`/`getBenchmark` 未定义)。

- [ ] **Step 3: Write the query functions**

追加到 `packages/otto/src/knowledge/meta-expertise.ts`:
```ts
import type { MetaKnowledgeEntry } from "./meta-expertise.types.js";

const eq = (a: string | undefined, b: string | undefined) =>
  (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

export function queryMetaKnowledge(
  kb: MetaExpertiseKB,
  filter: { domain?: MetaKnowledgeDomain; metric?: string; objective?: string },
): MetaKnowledgeEntry[] {
  return kb.entries.filter((e) => {
    if (filter.domain && e.domain !== filter.domain) return false;
    if (filter.metric && !eq(e.benchmark?.metric, filter.metric)) return false;
    if (filter.objective && !eq(e.benchmark?.objective, filter.objective)) return false;
    return true;
  });
}

/** Best-match benchmark: objective+industry > objective-only > metric-only. null if no metric match. */
export function getBenchmark(
  kb: MetaExpertiseKB,
  q: { metric: string; objective?: string; industry?: string },
): MetaKnowledgeEntry | null {
  const byMetric = kb.entries.filter((e) => e.benchmark && eq(e.benchmark.metric, q.metric));
  if (byMetric.length === 0) return null;
  const score = (e: MetaKnowledgeEntry) => {
    let s = 0;
    if (q.objective && eq(e.benchmark?.objective, q.objective)) s += 2;
    if (q.industry && eq(e.benchmark?.industry, q.industry)) s += 1;
    return s;
  };
  return byMetric.slice().sort((a, b) => score(b) - score(a))[0] ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/knowledge/meta-expertise.test.ts`
Expected: PASS(全部,含 Task 1 的 5 个)。

- [ ] **Step 5: Commit**

```bash
git add packages/otto/src/knowledge/meta-expertise.ts packages/otto/src/knowledge/meta-expertise.test.ts
git commit -m "feat(otto): P0 KB query — queryMetaKnowledge + getBenchmark (best-match)"
```

---

### Task 3: 深度研究 —— 产出带引用的 Meta Blueprint 知识语料(编排式 · Workflow)

> **执行方式说明:** 本任务由**编排者(orchestrator)用 Workflow 执行**,不是单个 implementer subagent 的 TDD 任务 —— 它是 fan-out 研究 + 对抗核实。产物 = 一份结构化 JSON 语料(供 Task 4 编码)。**这是整块最吃"有根据"铁律的一步。**

**Files:**
- Create: `docs/research/2026-07-03-meta-blueprint-expertise-sources.md`(源清单 + 覆盖边界,华语)
- Produce(交给 Task 4 的中间产物,存 scratchpad): 结构化语料 `meta-expertise.corpus.json`(entries 数组,字段对齐 `MetaKnowledgeEntry`)

**方法(Workflow 形状):**
1. **枚举认证**:研究 Meta Blueprint **有哪些认证**(如 Media Buying Professional / Media Planning Professional / Marketing Science Professional / Creative Strategy Professional / Digital Marketing Associate 等)+ 各自**公开的技能域 / exam study guide**。产出认证 × 技能域清单(每项带 `{url,title}`)。
2. **逐域深研**(每个域一个 agent,fan-out):从**公开官方资料**(Meta Business Help Center、Meta for Business best-practice、exam guide、官方 blog)提取该域的**专家事实/原则/基准**,蒸馏成 `MetaKnowledgeEntry` 候选(claim + 可选 benchmark + `sourceCert` + `citations`)。**只收能挂到真实 URL 的**;基准区间必须来自读到的源,不得脑补。
3. **对抗核实**(每条候选一个 verifier agent):打开引用 URL,核对 claim/benchmark **确实由该源支持**、**非逐字复制**(版权)、非过期/非误读。不过关 → 丢弃或降级。
4. **去重 + 归并**:同一原则多源 → 合并 citations;跨域重复 → 去重。
5. **覆盖体检**:每个 `MetaKnowledgeDomain` 至少有实质条目;常见指标(CTR/CPC/ROAS/frequency)× 常见 objective(traffic/conversions/awareness)尽量有 benchmark;**缺的就如实标"无公开基准",不硬造**。

**验收(本任务"done"的判据,不是 TDD):**
- [ ] **Step 1:** 跑研究 Workflow(free-first:WebSearch/WebFetch;**若要动付费源先问 founder**),产出 `meta-expertise.corpus.json`。
- [ ] **Step 2:** 语料每条 entry **均有 ≥1 条 `{url,title,retrievedAt}`**;`retrievedAt` = 执行当天 ISO 日期。
- [ ] **Step 3:** 每条经对抗核实(源支持 + 非逐字 + 未过期);记录淘汰数。
- [ ] **Step 4:** 覆盖体检结果写进 `docs/research/2026-07-03-meta-blueprint-expertise-sources.md`(华语):认证清单、每域条数、缺基准清单(如实)、覆盖边界(门控内容拿不到的说明)、版权说明(只蒸馏)。
- [ ] **Step 5: Commit**(仅 doc + scratchpad 语料不入库;语料在 Task 4 编码入库)

```bash
git add docs/research/2026-07-03-meta-blueprint-expertise-sources.md
git commit -m "docs(otto): P0 Meta Blueprint expertise — deep-research sources + coverage manifest"
```

---

### Task 4: 编码 KB 数据 + 真实完整性/覆盖断言

**Files:**
- Create: `packages/otto/src/knowledge/meta-expertise.data.ts`(把 Task 3 语料编码成 `META_EXPERTISE_KB` 常量)
- Modify: `packages/otto/src/knowledge/meta-expertise.ts`(re-export `META_EXPERTISE_KB`)
- Modify: `packages/otto/src/index.ts`(re-export KB 公共 API 供 P2)
- Test: `packages/otto/src/knowledge/meta-expertise.test.ts`(追加"真实 KB"断言块)

**Interfaces:**
- Consumes: Task 1 类型 + `validateKnowledgeBase`;Task 3 语料。
- Produces: `export const META_EXPERTISE_KB: MetaExpertiseKB`(真实数据);经 `packages/otto/src/index.ts` 导出 `META_EXPERTISE_KB` / `validateKnowledgeBase` / `queryMetaKnowledge` / `getBenchmark` / 类型。

- [ ] **Step 1: Write the failing test**(真实 KB 完整性 + 覆盖)

追加到 `meta-expertise.test.ts`:
```ts
import { META_EXPERTISE_KB } from "./meta-expertise.js";
import type { MetaKnowledgeDomain } from "./meta-expertise.types.js";

describe("META_EXPERTISE_KB (real, researched)", () => {
  it("validates clean — every entry cited, no dup, valid domains", () => {
    expect(validateKnowledgeBase(META_EXPERTISE_KB)).toEqual([]);
  });

  it("covers every knowledge domain", () => {
    const present = new Set(META_EXPERTISE_KB.entries.map((e) => e.domain));
    const required: MetaKnowledgeDomain[] =
      ["objectives", "bidding", "targeting", "creative", "measurement", "algorithm", "diagnosis"];
    for (const d of required) expect(present.has(d), `missing domain ${d}`).toBe(true);
  });

  it("has a non-empty master source list and a build version", () => {
    expect(META_EXPERTISE_KB.sources.length).toBeGreaterThan(0);
    expect(META_EXPERTISE_KB.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has at least one benchmark for CTR and for ROAS (headline diagnosis metrics)", () => {
    expect(getBenchmark(META_EXPERTISE_KB, { metric: "CTR" })).not.toBeNull();
    expect(getBenchmark(META_EXPERTISE_KB, { metric: "ROAS" })).not.toBeNull();
  });

  it("every benchmark entry states a range (no empty ranges)", () => {
    for (const e of META_EXPERTISE_KB.entries) {
      if (e.benchmark) expect(e.benchmark.range.trim().length, `empty range on ${e.id}`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/knowledge/meta-expertise.test.ts`
Expected: FAIL(`META_EXPERTISE_KB` 未定义)。

- [ ] **Step 3: Write the data module**(把 Task 3 语料编码;下面是**形状示例**,真实条目来自语料 —— 编码时逐条落 `claim` + `citations`,**不得新增无引用条目**)

`packages/otto/src/knowledge/meta-expertise.data.ts`:
```ts
import type { MetaExpertiseKB } from "./meta-expertise.types.js";

// Distilled from public Meta Blueprint / Meta for Business materials (see
// docs/research/2026-07-03-meta-blueprint-expertise-sources.md). Facts only,
//每条挂真实来源;NOT a verbatim copy of Meta's materials.
export const META_EXPERTISE_KB: MetaExpertiseKB = {
  version: "2026-07-03",
  sources: [
    // master list — populated from the corpus
  ],
  entries: [
    // …真实研究条目(每条 domain/claim/citations,基准条附 benchmark)…
    // 示例结构(实际 claim/url 来自 Task 3 语料,不是这里编):
    // { id: "learning-phase-50-events", domain: "algorithm",
    //   claim: "Ad sets exit the learning phase after ~50 optimization events per week.",
    //   appliesWhen: "diagnosing unstable early performance",
    //   sourceCert: "Media Buying Professional",
    //   citations: [{ url: "https://www.facebook.com/business/help/…", title: "About learning phase", retrievedAt: "2026-07-03" }] },
  ],
};
```

- [ ] **Step 4: Re-export**

`packages/otto/src/knowledge/meta-expertise.ts` 末尾:
```ts
export { META_EXPERTISE_KB } from "./meta-expertise.data.js";
```

`packages/otto/src/index.ts` 追加:
```ts
export {
  META_EXPERTISE_KB, validateKnowledgeBase, queryMetaKnowledge, getBenchmark,
} from "./knowledge/meta-expertise.js";
export type {
  MetaExpertiseKB, MetaKnowledgeDomain, MetaCitation, MetaBenchmark, MetaKnowledgeEntry,
} from "./knowledge/meta-expertise.types.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/knowledge/meta-expertise.test.ts`
Expected: PASS(全部)。若 `validateKnowledgeBase` 报错 → 修数据(补引用/去重),**绝不改断言放水**。

- [ ] **Step 6: Build gates**

Run: `pnpm --filter @fikirtive/otto build && pnpm --filter @fikirtive/web build`
Expected: 两个 EXIT 0。

- [ ] **Step 7: Commit**

```bash
git add packages/otto/src/knowledge/meta-expertise.data.ts packages/otto/src/knowledge/meta-expertise.ts packages/otto/src/index.ts packages/otto/src/knowledge/meta-expertise.test.ts
git commit -m "feat(otto): P0 Meta expertise KB data — cited, validated, domain-complete"
```

---

### Task 5: 整块 P0 反捏造/版权终审(whole-slice review)

> 由 orchestrator 派一个 fresh reviewer,对整支 P0 diff 做终审。**非 TDD,是门槛。**

- [ ] **Step 1:** 抽查每条 entry:`claim`/`benchmark` **确由 citation URL 支持**(打开核对),**非逐字复制**(版权),`retrievedAt` 真实。
- [ ] **Step 2:** `validateKnowledgeBase(META_EXPERTISE_KB) === []` 复核;覆盖体检对齐源清单 doc。
- [ ] **Step 3:** 确认**无任何无引用条目**、无占位、无"看起来专业但没源"的话术(铁律核心)。
- [ ] **Step 4:** 确认纯数据/纯函数、无 prisma/pg import;`packages/otto` + `web` build EXIT 0。
- [ ] **Step 5:** 发现 Critical/Important → 派 fix subagent 修;修完复核。全清 → P0 done,报告等 founder。

---

## Self-Review(plan 对 spec 核对)

**1. Spec coverage:** spec §4 P0 全部落到 Task 1-5(类型/校验/查询/深研语料/编码/终审);铁律 §5.6(反漂移)+ §7(版权/门控/时效)落到 Global Constraints + Task 3/4/5;宪法第 10 条(弱模型=冻进 data)= 整体架构。✅
**2. Placeholder scan:** Task 3 是研究任务(方法+验收明确,非占位);Task 4 数据"形状示例"明确标注真实条目来自语料、不得新增无引用条目 —— 非 TBD。✅
**3. Type consistency:** `MetaKnowledgeEntry`/`MetaBenchmark`/`MetaExpertiseKB`/`validateKnowledgeBase`/`queryMetaKnowledge`/`getBenchmark` 跨 Task 1-4 一致;`.js` 扩展名 import 贯穿。✅
