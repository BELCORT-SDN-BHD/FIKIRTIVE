import { describe, it, expect } from "vitest";
import { toOttoInsightAccounts, toOttoAdRows } from "../otto-money-view";
import {
  expectClosedAccountShape,
  expectClosedAdShape,
  isFinishedMoney,
  looksNumeric,
  ACCOUNT_KEYS,
  AD_KEYS,
  MONEY_KEYS,
  METRIC_KEYS,
} from "./otto-money-contract";
import type { AccountInsights } from "../meta-insights";
import type { OwnerAdRow } from "../meta-performance";

// --- helpers ----------------------------------------------------------------

const metrics = (over: Record<string, string | null> = {}) => ({
  spend: "612", impressions: "9120", reach: "6400", frequency: "1.43",
  clicks: "286", ctr: "3.14", cpc: "0.11", cpm: "3.42", purchaseRoas: "3.8",
  ...over,
});

const account = (
  accountId: string,
  name: string,
  currency: string | null,
  over: Record<string, string | null> = {},
): AccountInsights => ({ accountId, name, currency, metrics: metrics(over) as AccountInsights["metrics"] });

const ad = (
  adId: string,
  accountId: string,
  accountName: string | null,
  currency: string | null,
  over: Record<string, string | null> = {},
): OwnerAdRow => ({
  adId, adName: adId, accountId, accountName, currency,
  metrics: metrics(over), creative: null,
});

// ---------------------------------------------------------------------------
// #692 r3 [P1] — the load-bearing pin. Three rounds of telling the model "don't add
// these" failed. What reaches the model must not BE addable: every money figure crosses
// this boundary as finished text, so there is no bare amount to sum across accounts.
describe("Otto money boundary — no summable amount reaches the model (#692 r3)", () => {
  const twoCurrencies = [
    account("act_1", "Kaia Cafe", "MYR", { spend: "48.75", cpc: "0.12", cpm: "2.66" }),
    account("act_2", "Night Market", "SGD", { spend: "33.10", cpc: "0.20", cpm: "3.00" }),
  ];

  // #692 r4: a CLOSED key set, not a name match. "Does this field look like money?" fails open
  // on the next field nobody imagined; an enumerated contract fails closed and drags whoever
  // adds a field into this list, where a reviewer sees it.
  it("every account object matches the closed contract exactly — key sets, value classes, money format", () => {
    for (const a of toOttoInsightAccounts(twoCurrencies)) expectClosedAccountShape(a);
  });

  it("the enumerated key sets are the ones this payload actually has", () => {
    const out = toOttoInsightAccounts(twoCurrencies);
    expect(Object.keys(out[0]!).sort()).toEqual([...ACCOUNT_KEYS]);
    expect(Object.keys(out[0]!.money).sort()).toEqual([...MONEY_KEYS]);
    expect(Object.keys(out[0]!.metrics).sort()).toEqual([...METRIC_KEYS]);
  });

  it("known currencies arrive as finished text carrying their code", () => {
    const out = toOttoInsightAccounts(twoCurrencies);
    expect(out[0]!.money.spend).toBe("MYR 48.75");
    expect(out[0]!.money.cpc).toBe("MYR 0.12");
    expect(out[1]!.money.spend).toBe("SGD 33.10");
    expect(out[0]!.moneyBucket).toBe("MYR");
    expect(out[1]!.moneyBucket).toBe("SGD");
  });

  it("counts and ratios stay numeric — those ARE comparable across accounts", () => {
    const out = toOttoInsightAccounts(twoCurrencies);
    expect(out[0]!.metrics.reach).toBe("6400");
    expect(out[0]!.metrics.ctr).toBe("3.14");
    expect(out[0]!.metrics.purchaseRoas).toBe("3.8");
    expect(out[0]!.metrics.clicks).toBe("286");
  });

  it("a money value Meta never sent renders — , not an empty currency code", () => {
    const out = toOttoInsightAccounts([account("act_1", "Kaia Cafe", "MYR", { spend: null, cpc: "n/a" })]);
    expect(out[0]!.money.spend).toBe("—");
    expect(out[0]!.money.cpc).toBe("—");
  });
});

// #692 r3 pin ② — two accounts Meta reported no currency for.
describe("Otto money boundary — accounts with no reported currency (#692 r3)", () => {
  const twoUnknown = [
    account("act_1", "Kaia Cafe", null, { spend: "1240" }),
    account("act_2", "Night Market", null, { spend: "990" }),
  ];

  it("each unlabelled figure names its own account, and the two never share a bucket", () => {
    const out = toOttoInsightAccounts(twoUnknown);
    expect(out[0]!.money.spend).toBe("1240 (currency not reported — Kaia Cafe)");
    expect(out[1]!.money.spend).toBe("990 (currency not reported — Night Market)");
    expect(out[0]!.moneyBucket).not.toBe(out[1]!.moneyBucket);
  });

  it("their figures are finished text, and the pooled total appears nowhere", () => {
    const out = toOttoInsightAccounts(twoUnknown);
    for (const a of out) expectClosedAccountShape(a);
    expect(isFinishedMoney(out[0]!.money.spend)).toBe(true);
    expect(looksNumeric(out[0]!.money.spend)).toBe(false);
    expect(JSON.stringify(out)).not.toContain("2230"); // 1240 + 990
  });

  it("an account with a blank name falls back to its id so the figure is still placed", () => {
    const out = toOttoInsightAccounts([account("act_77", "  ", null, { spend: "5" })]);
    expect(out[0]!.money.spend).toBe("5 (currency not reported — act_77)");
  });
});

// ---------------------------------------------------------------------------
describe("Otto money boundary — per-ad rows (#692 r3)", () => {
  it("per-ad rows match the SAME closed contract — one validator, both paths", () => {
    const out = toOttoAdRows([ad("a1", "act_1", "Kaia Cafe", "MYR", { spend: "31.20", cpc: "0.11" })]);
    expectClosedAdShape(out[0]);
    expect(out[0]!.money.spend).toBe("MYR 31.20");
    expect(out[0]!.money.cpc).toBe("MYR 0.11");
    expect(Object.keys(out[0]!).sort()).toEqual([...AD_KEYS]);
  });

  it("carries hasSpend so the diagnosis can still tell a live ad from a dormant one", () => {
    const spent = toOttoAdRows([ad("a1", "act_1", "Kaia Cafe", "MYR", { spend: "31.20" })]);
    const dormant = toOttoAdRows([ad("a2", "act_1", "Kaia Cafe", "MYR", { spend: "0" })]);
    const missing = toOttoAdRows([ad("a3", "act_1", "Kaia Cafe", "MYR", { spend: null })]);
    expect(spent[0]!.hasSpend).toBe(true);
    expect(dormant[0]!.hasSpend).toBe(false);
    expect(missing[0]!.hasSpend).toBe(false);
  });

  it("two unlabelled ad accounts get separate buckets and self-naming figures", () => {
    const out = toOttoAdRows([
      ad("a1", "act_1", "Kaia Cafe", null, { spend: "20" }),
      ad("b1", "act_2", "Night Market", null, { spend: "30" }),
    ]);
    expect(out[0]!.money.spend).toBe("20 (currency not reported — Kaia Cafe)");
    expect(out[1]!.money.spend).toBe("30 (currency not reported — Night Market)");
    expect(out[0]!.moneyBucket).not.toBe(out[1]!.moneyBucket);
  });

  it("ratios and the creative ride through untouched", () => {
    const out = toOttoAdRows([ad("a1", "act_1", "Kaia Cafe", "MYR")]);
    expect(out[0]!.metrics.ctr).toBe("3.14");
    expect(out[0]!.metrics.purchaseRoas).toBe("3.8");
    expect(out[0]!.creative).toBeNull();
  });

  it("a real creative object still satisfies the contract", () => {
    const withCreative: OwnerAdRow = {
      ...ad("a1", "act_1", "Kaia Cafe", "MYR"),
      // a genuine Meta video id is all digits — the contract must not mistake it for money
      creative: { imageUrl: "https://img/1.png", body: "Try it", title: "Iced Latte", videoId: "1234567890" },
    };
    expectClosedAdShape(toOttoAdRows([withCreative])[0]);
  });
});

// ---------------------------------------------------------------------------
// #692 r4: the contract's own predicates, so the pin cannot pass by being lax. These are the
// exact strings a lax matcher waves through — the previous "doesn't look like a bare number"
// rule accepted every one of them.
describe("the money format predicate (#692 r4)", () => {
  it("accepts only the three finished forms", () => {
    expect(isFinishedMoney("MYR 612")).toBe(true);
    expect(isFinishedMoney("MYR 1,234.56")).toBe(true);
    expect(isFinishedMoney("1240 (currency not reported — Kaia Cafe)")).toBe(true);
    expect(isFinishedMoney("—")).toBe(true);
  });

  it("rejects everything a merchant could read as a plain amount", () => {
    for (const bad of ["+48.75", "48.75", "1e3", " 48.75", "48.75 ", "1,240", "-12", "myr 612", "MYR", "612 MYR", ""]) {
      expect(isFinishedMoney(bad), `${JSON.stringify(bad)} must not pass as finished money`).toBe(false);
    }
  });

  it("rejects non-strings outright — a number is never finished money", () => {
    for (const bad of [48.75, 0, null, undefined, {}, ["MYR 1"]]) {
      expect(isFinishedMoney(bad)).toBe(false);
    }
  });

  it("looksNumeric catches the forms a naive regex misses", () => {
    for (const n of ["+48.75", "1e3", " 48.75 ", "1,240", "0", "-12"]) {
      expect(looksNumeric(n), `${JSON.stringify(n)} is usable as a number`).toBe(true);
    }
    for (const t of ["MYR 612", "—", "", "  ", "Kaia Cafe"]) {
      expect(looksNumeric(t), `${JSON.stringify(t)} is not a number`).toBe(false);
    }
  });
});
