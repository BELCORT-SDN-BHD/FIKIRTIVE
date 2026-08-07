import { describe, it, expect } from "vitest";
import {
  RANGES,
  buildKpis,
  buildChart,
  buildInsightText,
  type RangeKey,
  type Kpi,
  type AccountTotals,
} from "../analytics-view";
import type { DailyMetric, AccountMetrics } from "../meta-graph";

// --- test helpers -----------------------------------------------------------
const day = (date: string, reach: number, clicks = 0, spend = 0): DailyMetric => ({
  date,
  spend,
  reach,
  impressions: 0,
  clicks,
});

const emptyTotals = (over: Partial<AccountMetrics> = {}): AccountMetrics => ({
  spend: null,
  impressions: null,
  reach: null,
  frequency: null,
  clicks: null,
  ctr: null,
  cpc: null,
  cpm: null,
  purchaseRoas: null,
  ...over,
});

// One ad account's totals plus the currency they are denominated in (#692).
const acct = (currency: string | null, over: Partial<AccountMetrics> = {}): AccountTotals => ({
  currency,
  metrics: emptyTotals(over),
});

// build a series of `n` days with constant reach/clicks, dates ascending from 2026-06-01
const seriesOf = (values: number[]): DailyMetric[] =>
  values.map((v, i) => day(`2026-06-${String(i + 1).padStart(2, "0")}`, v, v));

// ---------------------------------------------------------------------------
describe("RANGES", () => {
  it("has the 5 documented ranges mapping key → preset", () => {
    expect(RANGES.map((r) => [r.key, r.preset])).toEqual([
      ["7d", "last_7d"],
      ["30d", "last_30d"],
      ["90d", "last_90d"],
      ["365d", "last_year"],
      ["all", "maximum"],
    ]);
  });
  it("keys are usable as RangeKey", () => {
    const k: RangeKey = "30d";
    expect(RANGES.some((r) => r.key === k)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("buildKpis — cards, order, formatting", () => {
  it("returns exactly 4 cards in order Reach, Engagement, Spend, Sales (est.)", () => {
    const kpis = buildKpis([], []);
    expect(kpis.map((k) => k.label)).toEqual(["Reach", "Engagement", "Spend", "Sales (est.)"]);
  });

  it("Reach = sum of series.reach, Engagement = sum of series.clicks", () => {
    const series = [day("2026-06-01", 500, 40), day("2026-06-02", 700, 60)];
    const kpis = buildKpis(series, []);
    const reach = kpis[0] as Kpi;
    const eng = kpis[1] as Kpi;
    expect(reach.values).toEqual(["1,200"]); // 1200 → thousands separator
    expect(eng.values).toEqual(["100"]); // 100 < 1000 → raw
  });

  it("compact formatting: 48200 → 48.2K, 3140 → 3,140, 950 → 950", () => {
    // 48200 reach
    expect((buildKpis([day("d", 48200, 0)], [])[0] as Kpi).values).toEqual(["48.2K"]);
    // 3140 reach
    expect((buildKpis([day("d", 3140, 0)], [])[0] as Kpi).values).toEqual(["3,140"]);
    // 950 reach (< 1000 → raw)
    expect((buildKpis([day("d", 950, 0)], [])[0] as Kpi).values).toEqual(["950"]);
    // exactly 1000 → thousands separator, not K
    expect((buildKpis([day("d", 1000, 0)], [])[0] as Kpi).values).toEqual(["1,000"]);
    // exactly 10000 → K format
    expect((buildKpis([day("d", 10000, 0)], [])[0] as Kpi).values).toEqual(["10.0K"]);
  });

  it("Spend = sum of the accounts' spend, 2dp, prefixed with their currency code", () => {
    const accounts = [acct("MYR", { spend: "120.5" }), acct("MYR", { spend: "299.5" })];
    const spend = buildKpis([], accounts)[2] as Kpi;
    expect(spend.values).toEqual(["MYR 420.00"]);
  });

  it("Spend groups thousands: MYR 1,234.56", () => {
    const spend = buildKpis([], [acct("MYR", { spend: "1234.56" })])[2] as Kpi;
    expect(spend.values).toEqual(["MYR 1,234.56"]);
  });

  it("Spend = — when every account's spend is null", () => {
    const accounts = [acct("MYR"), acct("MYR")];
    expect((buildKpis([], accounts)[2] as Kpi).values).toEqual(["—"]);
  });

  it("Spend with no accounts at all = —", () => {
    expect((buildKpis([], [])[2] as Kpi).values).toEqual(["—"]);
  });

  it("Sales (est.) = Σ (spend × roas) per account, rounded int with separators + currency", () => {
    const accounts = [
      acct("MYR", { spend: "100", purchaseRoas: "2" }), // 200
      acct("MYR", { spend: "50", purchaseRoas: "3" }), // 150
    ];
    // 100*2 + 50*3 = 350, all in MYR
    expect((buildKpis([], accounts)[3] as Kpi).values).toEqual(["MYR 350"]);
  });

  it("Sales (est.) skips an account missing either spend or roas", () => {
    const accounts = [
      acct("MYR", { spend: "1000", purchaseRoas: "2" }), // 2000
      acct("MYR", { spend: "500", purchaseRoas: null }), // skipped (no roas)
      acct("MYR", { spend: null, purchaseRoas: "4" }), // skipped (no spend)
    ];
    // only the first account counts → 2000, formatted with separator
    expect((buildKpis([], accounts)[3] as Kpi).values).toEqual(["MYR 2,000"]);
  });

  it("Sales (est.) = — when no account has both spend & roas", () => {
    const accounts = [acct("MYR", { spend: "100" }), acct("MYR", { purchaseRoas: "3" })];
    expect((buildKpis([], accounts)[3] as Kpi).values).toEqual(["—"]);
  });

  it("Sales (est.) = — when there are no accounts", () => {
    expect((buildKpis([], [])[3] as Kpi).values).toEqual(["—"]);
  });
});

// ---------------------------------------------------------------------------
// #692: money must never be shown without its currency, and two ad accounts in
// DIFFERENT currencies must never be added into one number — there is no honest
// exchange rate here, so each currency gets its own subtotal.
describe("buildKpis — currency (#692)", () => {
  it("Spend: two currencies produce one subtotal each, never a single sum", () => {
    const accounts = [acct("MYR", { spend: "100" }), acct("SGD", { spend: "50" })];
    const spend = buildKpis([], accounts)[2] as Kpi;
    expect(spend.values).toEqual(["MYR 100.00", "SGD 50.00"]);
    // the cross-currency sum (150) must appear nowhere
    expect(spend.values.join(" ")).not.toContain("150");
  });

  it("Sales (est.): two currencies produce one subtotal each, never a single sum", () => {
    const accounts = [
      acct("MYR", { spend: "100", purchaseRoas: "2" }), // MYR 200
      acct("SGD", { spend: "50", purchaseRoas: "3" }), // SGD 150
    ];
    const sales = buildKpis([], accounts)[3] as Kpi;
    expect(sales.values).toEqual(["MYR 200", "SGD 150"]);
    expect(sales.values.join(" ")).not.toContain("350");
  });

  it("three currencies → three subtotals, ordered deterministically by code", () => {
    const accounts = [
      acct("SGD", { spend: "5" }),
      acct("USD", { spend: "7" }),
      acct("MYR", { spend: "9" }),
      acct("SGD", { spend: "1" }),
    ];
    const spend = buildKpis([], accounts)[2] as Kpi;
    expect(spend.values).toEqual(["MYR 9.00", "SGD 6.00", "USD 7.00"]);
  });

  it("an account whose currency Meta did not report shows a bare number and is kept apart", () => {
    const accounts = [acct(null, { spend: "10" }), acct("MYR", { spend: "5" })];
    const spend = buildKpis([], accounts)[2] as Kpi;
    expect(spend.values).toHaveLength(2);
    expect(spend.values).toContain("MYR 5.00");
    expect(spend.values).toContain("10.00");
    expect(spend.values.join(" ")).not.toContain("15.00");
  });

  it("a blank currency string is treated as unknown, not as a currency code", () => {
    const spend = buildKpis([], [acct("", { spend: "10" })])[2] as Kpi;
    expect(spend.values).toEqual(["10.00"]);
  });

  it("Reach and Engagement stay single-line — they are counts, not money", () => {
    const accounts = [acct("MYR", { spend: "100" }), acct("SGD", { spend: "50" })];
    const kpis = buildKpis([day("2026-06-01", 500, 40)], accounts);
    expect(kpis[0]!.values).toHaveLength(1);
    expect(kpis[1]!.values).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// #692 判官 r1 [P2]: a bare number needs saying-so on its OWN line. Keying the
// explanation off "more than one line" left a single unknown bucket — one bare
// number, no caveat anywhere — reading exactly like a normal total.
describe("buildKpis — naming the unknown-currency line (#692 r1)", () => {
  it("names the bare line when the ONLY account has no currency", () => {
    const spend = buildKpis([], [acct(null, { spend: "10" })])[2] as Kpi;
    expect(spend.values).toEqual(["10.00"]);
    expect(spend.unknownCurrencyValue).toBe("10.00");
  });

  it("names the bare line when it sits beside a known-currency subtotal", () => {
    const spend = buildKpis([], [acct(null, { spend: "10" }), acct("MYR", { spend: "5" })])[2] as Kpi;
    expect(spend.unknownCurrencyValue).toBe("10.00");
    expect(spend.values).toContain(spend.unknownCurrencyValue!);
  });

  it("names it on Sales (est.) too, not just Spend", () => {
    const sales = buildKpis([], [acct(null, { spend: "10", purchaseRoas: "2" })])[3] as Kpi;
    expect(sales.values).toEqual(["20"]);
    expect(sales.unknownCurrencyValue).toBe("20");
  });

  it("is null when every account's currency is known", () => {
    const kpis = buildKpis([], [acct("MYR", { spend: "10" }), acct("SGD", { spend: "5" })]);
    expect(kpis[2]!.unknownCurrencyValue).toBeNull();
    expect(kpis[3]!.unknownCurrencyValue).toBeNull();
  });

  it("is null for counts, and null when there is no money data at all", () => {
    const kpis = buildKpis([day("2026-06-01", 500, 40)], []);
    expect(kpis[0]!.unknownCurrencyValue).toBeNull(); // Reach
    expect(kpis[1]!.unknownCurrencyValue).toBeNull(); // Engagement
    // "—" means no data, NOT an unknown currency
    expect(kpis[2]!.values).toEqual(["—"]);
    expect(kpis[2]!.unknownCurrencyValue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("buildKpis — deltas via series halving", () => {
  it("delta null for Reach & Engagement when series has < 14 points", () => {
    const kpis = buildKpis(seriesOf(new Array(13).fill(100)), []);
    expect(kpis[0]!.delta).toBeNull();
    expect(kpis[1]!.delta).toBeNull();
  });

  it("delta up (▲) when recent half sums higher than older half by >1%", () => {
    // 14 points: first 7 = 100 each (older = 700), last 7 = 200 each (recent = 1400)
    const values = [...new Array(7).fill(100), ...new Array(7).fill(200)];
    const kpis = buildKpis(seriesOf(values), []);
    // pct = (1400 - 700) / 700 = 1.0 → 100%
    expect(kpis[0]!.delta).toEqual({ dir: "up", text: "▲ 100%" });
  });

  it("delta down (▼) when recent half lower than older half by >1%", () => {
    // older = 1000/day*7 = 7000, recent = 940/day*7 = 6580 → pct = -6%
    const values = [...new Array(7).fill(1000), ...new Array(7).fill(940)];
    const kpis = buildKpis(seriesOf(values), []);
    expect(kpis[0]!.delta).toEqual({ dir: "down", text: "▼ 6%" });
  });

  it("delta flat when within ±1%", () => {
    // older = 7000, recent = 7035 → pct = 0.5% → flat
    const values = [...new Array(7).fill(1000), 1005, 1005, 1005, 1005, 1005, 1005, 1005];
    const kpis = buildKpis(seriesOf(values), []);
    expect(kpis[0]!.delta).toEqual({ dir: "flat", text: "flat" });
  });

  it("delta null when older half sums to 0 (avoid divide-by-zero)", () => {
    // first 7 = 0 (older sum 0), last 7 = 100
    const values = [...new Array(7).fill(0), ...new Array(7).fill(100)];
    const kpis = buildKpis(seriesOf(values), []);
    expect(kpis[0]!.delta).toBeNull();
  });

  it("Spend and Sales (est.) deltas are always null in Phase A", () => {
    const accounts = [acct("MYR", { spend: "100.0", purchaseRoas: "3.0" })];
    // even with 14 points of series, spend/sales deltas stay null
    const kpis = buildKpis(seriesOf(new Array(14).fill(100)), accounts);
    expect(kpis[2]!.delta).toBeNull(); // Spend
    expect(kpis[3]!.delta).toBeNull(); // Sales (est.)
  });

  it("odd-length series (>=14) halves cleanly by flooring the midpoint", () => {
    // 15 points; midpoint floor = 7 → older = first 7 (7000), recent = last 8
    const values = [...new Array(7).fill(1000), ...new Array(8).fill(2000)];
    const kpis = buildKpis(seriesOf(values), []);
    // recent = 16000, older = 7000 → pct = (16000-7000)/7000 ≈ 1.2857 → 129%
    expect(kpis[0]!.delta).toEqual({ dir: "up", text: "▲ 129%" });
  });
});

// ---------------------------------------------------------------------------
describe("buildChart", () => {
  it("empty series → empty paths and no points", () => {
    expect(buildChart([], 300, 100)).toEqual({ linePath: "", areaPath: "", points: [] });
  });

  it("evenly spaces x across width; single point at x=0", () => {
    const one = buildChart([day("d1", 100)], 300, 100);
    expect(one.points).toHaveLength(1);
    expect(one.points[0]!.x).toBe(0);
  });

  it("spaces x from 0 to width across N points", () => {
    const c = buildChart([day("a", 10), day("b", 20), day("c", 30)], 300, 100);
    expect(c.points.map((p) => p.x)).toEqual([0, 150, 300]);
  });

  it("y is inverted: max reach → y=0 (top), and normalized by series max", () => {
    const c = buildChart([day("a", 50), day("b", 100)], 300, 100);
    // max = 100 → y = 100 - (100/100)*100 = 0
    expect(c.points[1]!.y).toBe(0);
    // 50 → y = 100 - (50/100)*100 = 50
    expect(c.points[0]!.y).toBe(50);
  });

  it("zero-max series does not divide by zero — all y = height", () => {
    const c = buildChart([day("a", 0), day("b", 0)], 300, 100);
    expect(c.points.map((p) => p.y)).toEqual([100, 100]);
    expect(c.linePath).not.toContain("NaN");
  });

  it("linePath is an M/L polyline through the points", () => {
    const c = buildChart([day("a", 50), day("b", 100)], 300, 100);
    // M 0 50 L 300 0
    expect(c.linePath).toBe("M 0 50 L 300 0");
  });

  it("areaPath closes the polyline down to the baseline and back", () => {
    const c = buildChart([day("a", 50), day("b", 100)], 300, 100);
    expect(c.areaPath).toBe("M 0 50 L 300 0 L 300 100 L 0 100 Z");
  });

  it("marks the top-3 reach values as peak", () => {
    const c = buildChart(
      [day("a", 10), day("b", 90), day("c", 30), day("d", 70), day("e", 50)],
      500,
      100,
    );
    const peaks = c.points.filter((p) => p.peak).map((p) => p.value).sort((x, y) => y - x);
    expect(peaks).toEqual([90, 70, 50]); // top 3
    // the bottom two are not peaks
    expect(c.points.filter((p) => !p.peak).map((p) => p.value).sort((x, y) => y - x)).toEqual([30, 10]);
  });

  it("carries the date and value through to each point", () => {
    const c = buildChart([day("2026-06-01", 42)], 300, 100);
    expect(c.points[0]!.date).toBe("2026-06-01");
    expect(c.points[0]!.value).toBe(42);
  });
});

// ---------------------------------------------------------------------------
describe("buildInsightText", () => {
  it("returns null for an empty series", () => {
    expect(buildInsightText([])).toBeNull();
  });

  it("returns null when every reach is 0", () => {
    expect(buildInsightText([day("a", 0), day("b", 0)])).toBeNull();
  });

  it("names the best day and the multiplier vs the average of the rest", () => {
    // best = 2026-06-03 @ 900; rest avg = (100+200)/2 = 150 → 900/150 = 6.0x
    const series = [day("2026-06-01", 100), day("2026-06-02", 200), day("2026-06-03", 900)];
    const out = buildInsightText(series)!;
    expect(out).not.toBeNull();
    expect(out.text).toContain("2026-06-03");
    expect(out.text).toContain("6.0×");
    expect(out.text).toContain("your typical post");
    expect(out.prefill).toContain("2026-06-03");
    expect(out.prefill).toContain("900"); // reached 900 people
  });

  it("single-day series: multiplier guards against divide-by-zero (rest avg → min 1)", () => {
    const out = buildInsightText([day("2026-06-01", 500)])!;
    expect(out).not.toBeNull();
    // no crash, produces a finite multiplier and names the day
    expect(out.text).toContain("2026-06-01");
    expect(out.text).not.toContain("NaN");
    expect(out.text).not.toContain("Infinity");
  });
});
