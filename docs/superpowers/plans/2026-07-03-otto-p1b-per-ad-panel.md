# Otto P1b · 逐条广告表现人工面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** 在 Analytics 屏加一个 **additive「Per-ad performance」面板**(人工可见逐条广告表现:素材缩略 + 花费/reach/CTR/CPC/ROAS + 来源戳 + 有界诚实),完成宪法第 7 条**双模读对等**——Otto 能读的逐条数据,人也看得到。$0 只读。

**Architecture:** 纯 formatter 在 lib(TDD,`analytics-view.ts` 范式)+ 一个自取数的 client 组件(复用 `getAdPerformance` action,镜像 OttoAnalytics 的 `getAnalytics` + useTransition 姿势)+ 一行插入 OttoAnalytics 的 `isReady` 块(additive,不重写账户级 KPI/图组件)。设计忠于 founder 已批 mockup(`~/Desktop/fikirtive-p1b-per-ad-mockup.png`)。**本块 = 纯读表**:赢家/输家标 → P2 专家诊断卡;复刻按钮 → P3;organic 不重复(现有 "Top posts" 面板已是 organic-pending 占位)。

**Tech Stack:** Next(apps/web,见 apps/web/AGENTS.md 破坏性变更)· React client 组件 · vitest(仅 formatter,无组件测试基建)· `.gb`+shadcn 设计系统 · 无新依赖。

## Global Constraints

- **$0 只读**:面板只读 `getAdPerformance`(P1a,已 requireOwner + owner-scoped);无 spend path,money-path 文件零 diff。
- **反捏造(spec §5)**:来源戳 `Meta · <range 标签> · fetched <日期>` 常显;`truncated` → "Showing your top N ads by spend";ROAS=null → 显 "—"(不填 0);不造任何数字。
- **双模/宪法 7**:人工面读 `getAdPerformance`(与 Otto `metaAdPerformance` skill 同一 `fetchOwnerAdPerformance`)——读对等。
- **宪法 11 UIUX**:忠于已批 mockup + Analytics 屏 gold standard;单一 `.gb` 系统;coral 只属 Otto;**过设计审 + runtime QA**(非只 build)。
- **不撞车(spec §9)**:新组件文件 + 一行插入;**不编辑** OttoAnalytics 的 KPI/insight/chart 组件;不碰 `analytics-view.ts` 账户级 builder。
- **货币诚实**:P1a 未取 account 货币 → spend/cpc/cpm 显**纯数字(千分位)不硬编 `$`**(MYR 等账户显 `$` 会错);ROAS 显 `×`;比率显 `%`。
- **语言**:UI 文案英文 sentence case;本 plan 华语。
- **构建闸**:`pnpm --filter @fikirtive/web build` EXIT 0。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `apps/web/lib/per-ad-view.ts` | 纯 formatter:`buildPerAdView(perf)` → `{ rows, stamp, truncatedNote }` | 建 |
| `apps/web/lib/per-ad-view.test.ts` | formatter 单测(含 ROAS-null→"—"、truncated 文案、来源戳) | 建 |
| `apps/web/components/otto/PerAdPerformance.tsx` | client 面板:自取 `getAdPerformance`,渲染 loading/ready/empty/notConnected;用 `buildPerAdView` | 建 |
| `apps/web/components/otto/OttoAnalytics.tsx` | `isReady` 块 reach 图后插入 `<PerAdPerformance datePreset={data.range} />`(一行) | 改(additive) |

---

### Task 1: `buildPerAdView` 纯 formatter(TDD)

**Files:**
- Create: `apps/web/lib/per-ad-view.ts`
- Test: `apps/web/lib/per-ad-view.test.ts`

**Interfaces:**
- Consumes: `OwnerAdPerformance`(`apps/web/lib/meta-performance.ts`,P1a);range 标签取 `RANGES`(`analytics-view.ts`)。
- Produces:
  - `type PerAdMetric = { label: string; value: string }`
  - `type PerAdDisplayRow = { adId: string; name: string; creative: { imageUrl: string | null; isVideo: boolean }; metrics: PerAdMetric[] }`
  - `type PerAdView = { rows: PerAdDisplayRow[]; stamp: string; truncatedNote: string | null }`
  - `function buildPerAdView(perf: OwnerAdPerformance): PerAdView` —— 每条广告 5 指标(Spend/Reach/CTR/CPC/ROAS);`spend/cpc` 纯数字千分位、`ctr` 加 `%`、`roas` 加 `×`(null→`—`);`reach` 千分位整数;`name` 取 `creative.title || adName || "Untitled ad"`;`isVideo = !!creative.videoId`;`stamp = "Meta · " + rangeLabel(perf.datePreset) + " · fetched " + fmtDate(perf.fetchedAt)`;`truncatedNote = perf.truncated ? "Showing your top " + perf.ads.length + " ads by spend." : null`。

- [ ] **Step 1: Write the failing test**

`apps/web/lib/per-ad-view.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildPerAdView } from "./per-ad-view";
import type { OwnerAdPerformance } from "./meta-performance";

const base: OwnerAdPerformance = {
  ads: [
    { adId: "a1", adName: "Ad One", accountId: "act_1",
      metrics: { spend: "612", reach: "41200", ctr: "2.1", cpc: "0.28", cpm: null, frequency: null, clicks: null, impressions: null, purchaseRoas: "3.4" },
      creative: { imageUrl: "http://i", body: "b", title: "Raya Reel", videoId: null } },
    { adId: "a2", adName: "Ad Two", accountId: "act_1",
      metrics: { spend: "388", reach: "33100", ctr: "0.4", cpc: "1.12", cpm: null, frequency: null, clicks: null, impressions: null, purchaseRoas: null },
      creative: { imageUrl: null, body: null, title: null, videoId: "v9" } },
  ],
  truncated: true, organic: { status: "pending_permission" }, datePreset: "last_30d", fetchedAt: "2026-07-03T10:00:00.000Z",
};

describe("buildPerAdView", () => {
  it("formats metrics: spend thousands, ctr %, roas ×, null roas → —", () => {
    const v = buildPerAdView(base);
    const m = Object.fromEntries(v.rows[0]!.metrics.map((x) => [x.label, x.value]));
    expect(m.Spend).toBe("612");
    expect(m.Reach).toBe("41,200");
    expect(m.CTR).toBe("2.1%");
    expect(m.CPC).toBe("0.28");
    expect(m.ROAS).toBe("3.4×");
    const m2 = Object.fromEntries(v.rows[1]!.metrics.map((x) => [x.label, x.value]));
    expect(m2.ROAS).toBe("—"); // null ROAS honest
  });

  it("names from creative.title, falls back to adName then Untitled; flags video", () => {
    const v = buildPerAdView(base);
    expect(v.rows[0]!.name).toBe("Raya Reel");
    expect(v.rows[1]!.name).toBe("Ad Two");     // no title → adName
    expect(v.rows[1]!.creative.isVideo).toBe(true);
    expect(v.rows[0]!.creative.isVideo).toBe(false);
  });

  it("source stamp carries platform + range + fetched date; truncated note honest", () => {
    const v = buildPerAdView(base);
    expect(v.stamp).toMatch(/^Meta ·/);
    expect(v.stamp).toMatch(/30 days/);
    expect(v.stamp).toMatch(/fetched/);
    expect(v.truncatedNote).toBe("Showing your top 2 ads by spend.");
  });

  it("no truncated note when not truncated", () => {
    expect(buildPerAdView({ ...base, truncated: false }).truncatedNote).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/per-ad-view.test.ts`

- [ ] **Step 3: Implement `apps/web/lib/per-ad-view.ts`**

```ts
import { RANGES } from "./analytics-view";
import type { OwnerAdPerformance } from "./meta-performance";

export type PerAdMetric = { label: string; value: string };
export type PerAdDisplayRow = {
  adId: string; name: string;
  creative: { imageUrl: string | null; isVideo: boolean };
  metrics: PerAdMetric[];
};
export type PerAdView = { rows: PerAdDisplayRow[]; stamp: string; truncatedNote: string | null };

const num = (s: string | null): string => (s == null || s === "" ? "—" : Number(s).toLocaleString("en-US"));
const dec = (s: string | null): string => (s == null || s === "" ? "—" : String(Number(s))); // trims trailing zeros, no currency symbol
const pct = (s: string | null): string => (s == null || s === "" ? "—" : `${Number(s)}%`);
const roas = (s: string | null): string => (s == null || s === "" ? "—" : `${Number(s)}×`);

function rangeLabel(preset: string): string {
  // getAdPerformance's datePreset is the Meta preset form ("last_30d"); RANGES.preset matches it
  // (RANGES.key is the short "30d" form — do NOT match on key here).
  return RANGES.find((r) => r.preset === preset)?.label ?? preset;
}
function fmtDate(iso: string): string {
  // iso date only — avoid locale/timezone surprises: "2026-07-03" → "Jul 3"
  const [y, m, d] = iso.slice(0, 10).split("-");
  const mon = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m)];
  return `${mon} ${Number(d)}`;
}

/** Shape the owner's per-ad performance into a display model. Pure — no fetch, no I/O.
 *  Every number stays as Meta returned it (no invented values); null → "—". */
export function buildPerAdView(perf: OwnerAdPerformance): PerAdView {
  const rows: PerAdDisplayRow[] = perf.ads.map((a) => ({
    adId: a.adId,
    name: a.creative?.title || a.adName || "Untitled ad",
    creative: { imageUrl: a.creative?.imageUrl ?? null, isVideo: !!a.creative?.videoId },
    metrics: [
      { label: "Spend", value: dec(a.metrics.spend ?? null) },
      { label: "Reach", value: num(a.metrics.reach ?? null) },
      { label: "CTR", value: pct(a.metrics.ctr ?? null) },
      { label: "CPC", value: dec(a.metrics.cpc ?? null) },
      { label: "ROAS", value: roas(a.metrics.purchaseRoas ?? null) },
    ],
  }));
  return {
    rows,
    stamp: `Meta · ${rangeLabel(perf.datePreset)} · fetched ${fmtDate(perf.fetchedAt)}`,
    truncatedNote: perf.truncated ? `Showing your top ${perf.ads.length} ads by spend.` : null,
  };
}
```
> 注(已核实):`RANGES` 每项 = `{ key:"30d", label:"Last 30 days", preset:"last_30d" }`。**`key`(短)≠ `preset`(Meta 用)**。`buildPerAdView` 收的是 `getAdPerformance` 的 datePreset = **preset 形**(`last_30d`),故 rangeLabel 按 `r.preset` 查。`getAdPerformance` 只对 last_7d/30d/90d 稳(skill enum);Analytics 的 `365d→last_year`/`all→maximum` 由组件映射后交 Meta,`maximum` 有效、`last_year` 若 Meta 拒则优雅降级(面板隐藏)——可接受。

- [ ] **Step 4: Run tests → PASS**

Run: `pnpm --filter @fikirtive/web exec vitest run lib/per-ad-view.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/per-ad-view.ts apps/web/lib/per-ad-view.test.ts
git commit -m "feat(analytics): buildPerAdView — per-ad display formatter (roas-null honest, source stamp, truncation)"
```

---

### Task 2: `PerAdPerformance` 组件 + 插入 OttoAnalytics

**Files:**
- Create: `apps/web/components/otto/PerAdPerformance.tsx`
- Modify: `apps/web/components/otto/OttoAnalytics.tsx`(一行插入)
- (无组件单测基建 → 靠 build + Task 3 runtime QA)

**Interfaces:**
- Consumes: `getAdPerformance`(`apps/web/lib/meta-performance-actions.ts`,P1a);`buildPerAdView`(Task 1);`RangeKey`。
- Produces: `PerAdPerformance({ range }: { range: RangeKey })` client 组件(内部 `RANGES.find(key===range).preset` 映射为 Meta preset 后调 `getAdPerformance`)。

- [ ] **Step 1: 实现组件**(镜像 OttoAnalytics 的 useTransition 自取 + `.gb` 面板样式,忠于已批 mockup)

`apps/web/components/otto/PerAdPerformance.tsx`:
```tsx
"use client";
import React, { useEffect, useState, useTransition } from "react";
import { getAdPerformance } from "@/lib/meta-performance-actions";
import { buildPerAdView, type PerAdView } from "@/lib/per-ad-view";
import { RANGES, type RangeKey } from "@/lib/analytics-view";

/** Additive per-ad performance panel (宪法7 read parity). $0 read-only: self-fetches
 *  getAdPerformance (same fetchOwnerAdPerformance the Otto skill uses). Renders each ad's
 *  real creative + metrics with a source stamp; ROAS "—" when Meta has none; honest truncation.
 *  Winner/loser judgment = P2 (expert card); recreate = P3. */
export function PerAdPerformance({ range }: { range: RangeKey }) {
  const [view, setView] = useState<PerAdView | null>(null);
  const [gone, setGone] = useState(false); // notConnected/needsReconnect → render nothing (Analytics body already shows the wall)
  const [pending, start] = useTransition();

  useEffect(() => {
    // Analytics range key ("30d") → Meta preset ("last_30d") that getAdPerformance expects.
    const preset = RANGES.find((r) => r.key === range)?.preset ?? "last_30d";
    start(async () => {
      const res = await getAdPerformance(preset);
      if (!res || "error" in res || "notConnected" in res || "needsReconnect" in res) { setGone(true); return; }
      setGone(false);
      setView(buildPerAdView(res));
    });
  }, [range]);

  if (gone) return null;

  return (
    <div className="rounded-[16px] border border-border bg-card p-[18px] mt-[14px]">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-[14px] font-semibold">Per-ad performance</div>
          <div className="text-[12px] text-[#86867F]">Which specific ads &amp; creatives are winning</div>
        </div>
        {view && (
          <span className="text-[11.5px] text-[#86867F] bg-muted rounded-[7px] px-2 py-[3px] font-medium whitespace-nowrap">
            {view.stamp}
          </span>
        )}
      </div>

      {view?.truncatedNote && <div className="text-[12px] text-muted-foreground mt-2">{view.truncatedNote}</div>}

      {pending && !view && <div className="text-[13px] text-muted-foreground mt-3">Loading your ads…</div>}

      {view && view.rows.length === 0 && (
        <div className="text-[13px] text-muted-foreground mt-3">No ads ran in this period yet.</div>
      )}

      <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {view?.rows.map((r) => (
          <div key={r.adId} className="flex gap-[14px] items-center py-[14px] border-t border-border first:border-t-[1px] mt-0">
            {/* creative thumbnail (video shows a play glyph) */}
            <div className="w-[56px] h-[56px] rounded-[10px] shrink-0 relative overflow-hidden border border-border bg-muted">
              {r.creative.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.creative.imageUrl} alt="" className="w-full h-full object-cover" />
              )}
              {r.creative.isVideo && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.5))" }}><path d="M8 5v14l11-7z" /></svg>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold truncate">{r.name}</div>
              <div className="flex gap-[22px] mt-[9px]">
                {r.metrics.map((m) => (
                  <div key={m.label}>
                    <div className="text-[10.5px] text-[#86867F] font-medium uppercase tracking-[0.03em]">{m.label}</div>
                    <div className={"text-[14px] mt-[2px] " + (m.value === "—" ? "text-[#86867F] font-medium" : "font-semibold")}>{m.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PerAdPerformance;
```

- [ ] **Step 2: 插入 OttoAnalytics**(一行,additive;reach 图 panel 之后)

`apps/web/components/otto/OttoAnalytics.tsx`:顶部 `import { PerAdPerformance } from "./PerAdPerformance";`;在 reach chart 那个 `</div>`(:210)之后、`{/* Top posts panel ... */}` 之前插入:
```tsx
          {/* Per-ad performance (additive, 宪法7 read parity) */}
          <PerAdPerformance range={data.range} />
```

- [ ] **Step 3: Build 闸**

Run: `pnpm --filter @fikirtive/web build`
Expected: EXIT 0(client 组件不把 server-only 拖进 bundle;`getAdPerformance` 是 `"use server"` action,client 只 import 其类型/调用面 —— 若 build 因 server-only import 报错,改为 `import type` 或确认 action 走 server 边界)。

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/otto/PerAdPerformance.tsx apps/web/components/otto/OttoAnalytics.tsx
git commit -m "feat(analytics): additive Per-ad performance panel (read parity, source-stamped, \$0)"
```

---

### Task 3: Runtime QA + 整片 P1b 终审(设计审 + $0 + 读对等)

> orchestrator 主导;UI 无单测 → runtime + review 是真门槛(宪法 11)。

- [ ] **Step 1: Runtime QA**:起 dev(或 Preview),Analytics 屏在 notConnected 态确认面板**不渲染**(`gone` → null,墙已在 body);再喂 mock/或真连接确认 ready 态面板忠于已批 mockup(截图存证 → ~/Desktop)。console 无报错;range 切换重取。
- [ ] **Step 2: 设计审**:逐条比对已批 mockup(卡片圆角/边框/字号/来源戳/指标排布/thumbnail),`.gb` token 一致,coral 未误用,Analytics 屏 gold standard 对齐。
- [ ] **Step 3: $0 / 反捏造复核**:面板只读 `getAdPerformance`,无 spend;来源戳/truncated/ROAS-"—" 都在;无任何编造数字;organic 未在本面板重复(交给现有 Top posts)。
- [ ] **Step 4: 双模读对等**:人工面读的 = Otto skill 读的同一 `fetchOwnerAdPerformance`;`web build` EXIT 0。
- [ ] **Step 5:** Critical/Important → fix subagent;全清 → P1b done。

---

## Self-Review

**1. Spec coverage:** spec §4 P1「人工逐条明细面(additive,不改账户级组件)」→ Task 1(formatter)+ Task 2(组件+一行插入)+ Task 3(QA+设计审);宪法 7 读对等(读 getAdPerformance = Otto 同源)+ 宪法 11 设计审 → Task 2/3;反捏造(来源戳/truncated/null)→ Task 1/3。赢家标→P2、复刻→P3、organic 不重复 = 明示排除。✅
**2. Placeholder scan:** RANGES key 匹配 = 实现时 grep 确认(已注明);无 TBD;组件无单测是仓库现状(UI 靠 runtime QA),非偷懒。
**3. Type consistency:** `OwnerAdPerformance`(P1a)→ `buildPerAdView`→`PerAdView`(Task1)→ 组件消费(Task2);`RangeKey`/`datePreset` 贯穿;`getAdPerformance` 返回联合(error/notConnected/needsReconnect/OwnerAdPerformance)在组件里全处理。✅
