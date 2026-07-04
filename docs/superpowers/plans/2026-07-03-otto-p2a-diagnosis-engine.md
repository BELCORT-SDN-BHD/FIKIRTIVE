# Otto P2a · 表现诊断引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** 建 `diagnosePerformance` —— 一个**纯、确定性、KB-grounded** 的诊断引擎:输入逐条广告真表现 + Meta 专家 KB → 输出每条广告的**赢家/输家判定(账户自身均值相对)+ 有据原因(创意,带 KB 引用)+ 诚实假设(跑太短/budget/target = data-gap,不断言)**。这是 P2 的智核(宪法 10:把专家判断冻进代码,不靠运行时弱模型即兴)。

**Architecture:** 纯函数在 `packages/otto`(和 KB 同包,直接用 `queryMetaKnowledge`)。**零外部基准、零捏造**:赢家/输家由**这批广告在用户自己账户里的均值**定义(100% 站真数据);创意原因挂 KB 真引用;非创意原因(需 P1 没有的 adset start_time/budget/targeting)一律标 `grounded:false` 的 data-gap 假设,绝不断言。ROAS=null 不作判据。运行时 $0(纯逻辑)。

**Tech Stack:** TS(`@fikirtive/otto`,ESM `.js` import)· vitest · 无新依赖 · 复用 P0 的 `MetaExpertiseKB`/`MetaCitation`/`queryMetaKnowledge`。

## Global Constraints

- **反捏造(spec §5,硬):** ①判定 = **账户自身均值相对**(`basis` 明说"compared to your own account average"),无任何外部/行业基准;②创意原因 grounded=true 且**挂 KB 真引用**(citations 非空);③非创意(runtime/budget/targeting)= `kind:"data-gap"`、`grounded:false`、text 明说"我这看不到,建议查",**绝不断言**;④ROAS=null → 不选 ROAS 作 metric、不产 ROAS 判据;⑤comparable 广告 <2 → `note` 说"数据不够比",全 neutral,不硬判。
- **宪法 10:** 判断在确定性代码 + 阈值,不调模型。
- **纯 & client-safe:** 无 prisma/pg/fetch/React;输入是普通结构(不 import apps/web)。
- **$0:** 纯逻辑,运行时零成本。
- **语言:** 引擎产出的 `text` 英文(UI 面向用户);本 plan 华语。
- **构建闸:** `pnpm --filter @fikirtive/otto build` + `pnpm --filter @fikirtive/web build` EXIT 0。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/otto/src/diagnosis/diagnose-performance.ts` | 类型 + `diagnosePerformance(ads, kb, opts?)` 引擎 |
| `packages/otto/src/diagnosis/diagnose-performance.test.ts` | 引擎单测(账户相对判定、KB 引用、data-gap、ROAS-null、少数据) |
| `packages/otto/src/index.ts` | re-export 引擎 + 类型(供 P2b skill) |

---

### Task 1: 诊断引擎类型 + `diagnosePerformance`(TDD)

**Files:**
- Create: `packages/otto/src/diagnosis/diagnose-performance.ts`
- Test: `packages/otto/src/diagnosis/diagnose-performance.test.ts`
- Modify: `packages/otto/src/index.ts`(re-export)

**Interfaces:**
- Consumes: `MetaExpertiseKB`/`MetaCitation`(`../knowledge/meta-expertise.types.js`)、`queryMetaKnowledge`(`../knowledge/meta-expertise.js`)。
- Produces:
  - `type DiagAdInput = { adId: string; adName: string | null; metrics: Record<string, string | null> }`
  - `type DiagReasonKind = "creative" | "runtime" | "budget" | "targeting" | "data-gap"`
  - `type DiagReason = { kind: DiagReasonKind; text: string; grounded: boolean; citations: MetaCitation[] }`
  - `type AdVerdict = { adId: string; name: string; verdict: "winner" | "loser" | "neutral"; metric: string; value: string; reasons: DiagReason[]; suggestRecreate: boolean }`
  - `type PerformanceDiagnosis = { verdicts: AdVerdict[]; metricUsed: string; basis: string; note: string | null }`
  - `function diagnosePerformance(ads: DiagAdInput[], kb: MetaExpertiseKB, opts?: { objective?: string }): PerformanceDiagnosis`

  **逻辑(确定性):**
  1. **选 metric**:`opts.objective` 含 `conversion|sales|purchase` 且 ≥1 广告 `purchaseRoas` 非空 → `metricKey="purchaseRoas"`/`metricUsed="ROAS"`;否则 `metricKey="ctr"`/`metricUsed="CTR"`。
  2. **comparable** = metric 值可解析为有限数的广告。`< 2` → 全 verdict `"neutral"`、reasons `[]`、`note="Not enough ads with <metricUsed> data to compare yet."`、返回。
  3. **mean** = comparable 的 metric 均值(真数据)。`basis="compared to your own account average this period"`。
  4. 每条广告(higher=better,CTR/ROAS 皆是):
     - `value` = 显示串(CTR→`X%`,ROAS→`X×`);null → verdict neutral、reasons `[]`。
     - `>= mean*1.25` → **winner**;`<= mean*0.6` 且 spend 可解析>0 → **loser**;否则 **neutral**。
  5. **reasons**:
     - **winner**:`{kind:"creative", grounded:true, text:"Top performer — <metricUsed> <value> is well above your account average (<meanDisplay>).", citations:[]}`;`suggestRecreate=true`。
     - **loser**:
       - 创意(grounded):`{kind:"creative", grounded:true, text:"<metricUsed> <value> is well below your account average (<meanDisplay>) — the creative is the most controllable lever here.", citations: <KB creative+diagnosis 引用>}`。citations 取 `queryMetaKnowledge(kb,{domain:"creative"})` + `{domain:"diagnosis"}` 前若干条的 citations(去重,≥1)。
       - data-gap(诚实假设):`{kind:"data-gap", grounded:false, text:"Also worth checking what I can't see from here yet: whether it's had time to exit Meta's learning phase, the audience, and the budget.", citations: <KB learning-limited 引用 or []>}`。
       - `suggestRecreate=false`。
     - **neutral**:reasons `[]`、`suggestRecreate=false`。
  6. `verdicts` 保序(输入序)。

- [ ] **Step 1: Write the failing test**

`packages/otto/src/diagnosis/diagnose-performance.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { diagnosePerformance } from "./diagnose-performance.js";
import { META_EXPERTISE_KB } from "../knowledge/meta-expertise.js";

const ad = (adId: string, ctr: string | null, spend = "100", roas: string | null = null) =>
  ({ adId, adName: adId, metrics: { ctr, spend, purchaseRoas: roas, reach: "1000", cpc: "0.5" } as Record<string, string | null> });

describe("diagnosePerformance", () => {
  it("needs >=2 comparable ads, else neutral + note", () => {
    const d = diagnosePerformance([ad("a1", "1.0")], META_EXPERTISE_KB);
    expect(d.verdicts[0]!.verdict).toBe("neutral");
    expect(d.note).toMatch(/not enough/i);
  });

  it("winner = metric well above the account average (grounded, no external benchmark)", () => {
    // mean of [3.0, 0.5, 0.5] ≈ 1.33; a1=3.0 > 1.25*mean → winner
    const d = diagnosePerformance([ad("a1", "3.0"), ad("a2", "0.5"), ad("a3", "0.5")], META_EXPERTISE_KB);
    const v = d.verdicts.find((x) => x.adId === "a1")!;
    expect(v.verdict).toBe("winner");
    expect(v.suggestRecreate).toBe(true);
    expect(d.metricUsed).toBe("CTR");
    expect(d.basis).toMatch(/account average/i);
  });

  it("loser gives a GROUNDED creative reason with real KB citations + a non-asserted data-gap hypothesis", () => {
    const d = diagnosePerformance([ad("a1", "3.0"), ad("a2", "0.1"), ad("a3", "3.0")], META_EXPERTISE_KB);
    const v = d.verdicts.find((x) => x.adId === "a2")!;
    expect(v.verdict).toBe("loser");
    const creative = v.reasons.find((r) => r.kind === "creative")!;
    expect(creative.grounded).toBe(true);
    expect(creative.citations.length).toBeGreaterThanOrEqual(1);
    expect(creative.citations[0]!.url).toMatch(/^https?:\/\//);
    const gap = v.reasons.find((r) => r.kind === "data-gap")!;
    expect(gap.grounded).toBe(false);                 // hypothesis, never asserted
    expect(gap.text).toMatch(/can't see|learning phase|audience|budget/i);
  });

  it("uses ROAS only when objective is conversion AND some ad has non-null ROAS; else falls to CTR", () => {
    const withRoas = [ad("a1", "1.0", "100", "4.0"), ad("a2", "1.0", "100", "1.0")];
    expect(diagnosePerformance(withRoas, META_EXPERTISE_KB, { objective: "conversions" }).metricUsed).toBe("ROAS");
    // all ROAS null → never pick ROAS even if objective says conversions
    const noRoas = [ad("a1", "1.0"), ad("a2", "0.5")];
    expect(diagnosePerformance(noRoas, META_EXPERTISE_KB, { objective: "conversions" }).metricUsed).toBe("CTR");
  });

  it("never fabricates: no verdict/reason cites an external industry benchmark number", () => {
    const d = diagnosePerformance([ad("a1", "3.0"), ad("a2", "0.1"), ad("a3", "3.0")], META_EXPERTISE_KB);
    const allText = d.verdicts.flatMap((v) => v.reasons.map((r) => r.text)).join(" ") + " " + d.basis;
    // grounding is account-relative; must not claim an industry/average-benchmark figure
    expect(allText).not.toMatch(/industry average|benchmark of|typical CTR is|good CTR is/i);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/diagnosis/diagnose-performance.test.ts`

- [ ] **Step 3: Implement `packages/otto/src/diagnosis/diagnose-performance.ts`**

```ts
import type { MetaExpertiseKB, MetaCitation } from "../knowledge/meta-expertise.types.js";
import { queryMetaKnowledge } from "../knowledge/meta-expertise.js";

export type DiagAdInput = { adId: string; adName: string | null; metrics: Record<string, string | null> };
export type DiagReasonKind = "creative" | "runtime" | "budget" | "targeting" | "data-gap";
export type DiagReason = { kind: DiagReasonKind; text: string; grounded: boolean; citations: MetaCitation[] };
export type AdVerdict = {
  adId: string; name: string; verdict: "winner" | "loser" | "neutral";
  metric: string; value: string; reasons: DiagReason[]; suggestRecreate: boolean;
};
export type PerformanceDiagnosis = { verdicts: AdVerdict[]; metricUsed: string; basis: string; note: string | null };

const finite = (s: string | null): number | null => {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const dedupeCitations = (cs: MetaCitation[]): MetaCitation[] => {
  const seen = new Set<string>(); const out: MetaCitation[] = [];
  for (const c of cs) if (!seen.has(c.url)) { seen.add(c.url); out.push(c); }
  return out;
};

/** Deterministic, KB-grounded performance diagnosis. Winners/losers are defined RELATIVE TO the
 *  user's OWN account average (no external benchmark — nothing to fabricate). Creative reasons
 *  carry real KB citations; non-creative causes (runtime/budget/targeting) that this data can't
 *  see are emitted as honest data-gap hypotheses (grounded:false), never asserted. */
export function diagnosePerformance(
  ads: DiagAdInput[], kb: MetaExpertiseKB, opts?: { objective?: string },
): PerformanceDiagnosis {
  const wantRoas = /conversion|sales|purchase/i.test(opts?.objective ?? "");
  const anyRoas = ads.some((a) => finite(a.metrics.purchaseRoas ?? null) != null);
  const useRoas = wantRoas && anyRoas;
  const metricKey = useRoas ? "purchaseRoas" : "ctr";
  const metricUsed = useRoas ? "ROAS" : "CTR";
  const disp = (n: number): string => (useRoas ? `${n}×` : `${n}%`);

  const comparable = ads.map((a) => finite(a.metrics[metricKey] ?? null)).filter((n): n is number => n != null);
  const basis = "compared to your own account average this period";
  if (comparable.length < 2) {
    return {
      verdicts: ads.map((a) => ({ adId: a.adId, name: a.adName || "Untitled ad", verdict: "neutral" as const, metric: metricUsed, value: "—", reasons: [], suggestRecreate: false })),
      metricUsed, basis, note: `Not enough ads with ${metricUsed} data to compare yet.`,
    };
  }
  const mean = comparable.reduce((s, n) => s + n, 0) / comparable.length;
  const meanDisplay = disp(Math.round(mean * 100) / 100);

  // KB grounding (deterministic pick: creative best-practice + a diagnosis principle)
  const creativeCites = dedupeCitations([
    ...queryMetaKnowledge(kb, { domain: "creative" }).flatMap((e) => e.citations),
    ...queryMetaKnowledge(kb, { domain: "diagnosis" }).flatMap((e) => e.citations),
  ]).slice(0, 2);
  const learningCites = dedupeCitations(
    queryMetaKnowledge(kb, { domain: "diagnosis" }).filter((e) => /learning/i.test(e.claim)).flatMap((e) => e.citations),
  ).slice(0, 1);

  const verdicts: AdVerdict[] = ads.map((a) => {
    const n = finite(a.metrics[metricKey] ?? null);
    const spend = finite(a.metrics.spend ?? null) ?? 0;
    const name = a.adName || "Untitled ad";
    if (n == null) return { adId: a.adId, name, verdict: "neutral", metric: metricUsed, value: "—", reasons: [], suggestRecreate: false };
    const value = disp(n);
    if (n >= mean * 1.25) {
      return {
        adId: a.adId, name, verdict: "winner", metric: metricUsed, value, suggestRecreate: true,
        reasons: [{ kind: "creative", grounded: true, citations: [],
          text: `Top performer — ${metricUsed} ${value} is well above your account average (${meanDisplay}).` }],
      };
    }
    if (n <= mean * 0.6 && spend > 0) {
      return {
        adId: a.adId, name, verdict: "loser", metric: metricUsed, value, suggestRecreate: false,
        reasons: [
          { kind: "creative", grounded: true, citations: creativeCites,
            text: `${metricUsed} ${value} is well below your account average (${meanDisplay}) — the creative is the most controllable lever here.` },
          { kind: "data-gap", grounded: false, citations: learningCites,
            text: "Also worth checking what I can't see from here yet: whether it's had time to exit Meta's learning phase, the audience, and the budget." },
        ],
      };
    }
    return { adId: a.adId, name, verdict: "neutral", metric: metricUsed, value, reasons: [], suggestRecreate: false };
  });

  return { verdicts, metricUsed, basis, note: null };
}
```

- [ ] **Step 4: Run tests → PASS**

Run: `pnpm --filter @fikirtive/otto exec vitest run src/diagnosis/diagnose-performance.test.ts`

- [ ] **Step 5: Re-export**

`packages/otto/src/index.ts` 追加:
```ts
export { diagnosePerformance } from "./diagnosis/diagnose-performance.js";
export type { DiagAdInput, DiagReason, DiagReasonKind, AdVerdict, PerformanceDiagnosis } from "./diagnosis/diagnose-performance.js";
```

- [ ] **Step 6: Build 闸**

Run: `pnpm --filter @fikirtive/otto build && pnpm --filter @fikirtive/web build` → 两个 EXIT 0。

- [ ] **Step 7: Commit**

```bash
git add packages/otto/src/diagnosis/diagnose-performance.ts packages/otto/src/diagnosis/diagnose-performance.test.ts packages/otto/src/index.ts
git commit -m "feat(otto): P2a diagnosis engine — account-relative winners/losers + KB-cited creative reason + honest data-gap"
```

---

### Task 2: 整片 P2a 反捏造终审(whole-slice review)

> orchestrator 派 fresh reviewer。**非 TDD,是门槛。**

- [ ] **Step 1:** 判定确定性:winner/loser 全由**账户自身均值**阈值定,无外部基准;`basis` 明说 account-relative。
- [ ] **Step 2:** 创意原因 grounded=true 且 citations 来自真 KB(非空、http);data-gap grounded=false、text 明说"看不到/建议查",**无断言 runtime/budget/target**。
- [ ] **Step 3:** ROAS=null 永不作 metric/判据;comparable<2 → 全 neutral + note;无任何编造数字/基准。
- [ ] **Step 4:** 纯函数、无 prisma/web/React import;otto+web build EXIT 0。
- [ ] **Step 5:** Critical/Important → fix subagent;全清 → P2a done。

---

## Self-Review

**1. Spec coverage:** spec §4 P2「按目标指标分赢家/输家 + 有据原因分级(素材/跑太短/budget/target 存疑)」→ Task 1 引擎(账户相对判定 + 创意 grounded + 非创意 data-gap);宪法 10(判断冻进代码)= 整体;反捏造 §5(指标匹配 objective、ROAS-null 弃权、target 只当假设、基准只 KB 引用)→ Global Constraints + 测试。赢家/输家标 = 引擎产出(P2b 卡渲染);复刻 suggestRecreate(P3 接线)。✅
**2. Placeholder scan:** 无 TBD;阈值 1.25/0.6 = 明确默认(可后调);KB 引用取法确定性。
**3. Type consistency:** `DiagAdInput`(metrics Record 对齐 P1 OwnerAdRow.metrics)→ `AdVerdict`/`PerformanceDiagnosis`;复用 P0 `MetaCitation`/`MetaExpertiseKB`/`queryMetaKnowledge`;`.js` import 贯穿。✅
