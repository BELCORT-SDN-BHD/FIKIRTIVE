/**
 * The closed contract for everything Otto's chat surface is allowed to see about money (#692 r4).
 *
 * The previous pin asked "does this look like money?" by matching field NAMES and rejecting
 * strings that looked like bare numbers. That is a heuristic, and a heuristic on an open set
 * fails open: add `costPerResult: 12.3` and nothing objects. This file inverts it. Every shape is
 * an ENUMERATED key set and every value class is a WHITELIST, so an unknown field is a failure by
 * construction — whoever adds one must come here and change the list, which puts it in the diff
 * where a reviewer sees it.
 *
 * Not a *.test.ts file, so vitest does not collect it; it is imported by the tests that use it.
 */
import { expect } from "vitest";

/** Complete key set of a model-visible ACCOUNT object. Nothing else may appear. */
export const ACCOUNT_KEYS = ["accountId", "currency", "metrics", "money", "moneyBucket", "name"] as const;

/** Complete key set of a model-visible AD row. Nothing else may appear. */
export const AD_KEYS = [
  "accountId", "accountName", "adId", "adName", "creative",
  "currency", "hasSpend", "metrics", "money", "moneyBucket",
] as const;

/** Complete key set of the money block — and every one of these is finished TEXT. */
export const MONEY_KEYS = ["cpc", "cpm", "spend"] as const;

/**
 * Complete key set of the comparable block. These are the ONLY fields allowed to be numeric,
 * because a count and a ratio mean the same thing in every currency: a person reached is a
 * person reached, and 2.76% is 2.76% whether the account bills in MYR or SGD.
 */
export const METRIC_KEYS = ["clicks", "ctr", "frequency", "impressions", "purchaseRoas", "reach"] as const;

/** Complete key set of the creative pass-through (free-form Meta strings; never money). */
export const CREATIVE_KEYS = ["body", "imageUrl", "title", "videoId"] as const;

/** Fields permitted to carry a number, or a string that parses as one. */
export const NUMERIC_ALLOWED: ReadonlySet<string> = new Set(METRIC_KEYS);

/** Fields permitted to carry a boolean. `hasSpend` is a fact about whether an ad ran — it cannot
 *  be added to anything, so it is not money and is not caught by the money rules. */
export const BOOLEAN_ALLOWED: ReadonlySet<string> = new Set(["hasSpend"]);

/** "MYR 612" — a currency code and its amount, inseparable. */
const MONEY_WITH_CODE = /^[A-Z]{3} -?[\d,]+(?:\.\d+)?$/;
/** "1240 (currency not reported — Kaia Cafe)" — tied to the one account it belongs to. */
const MONEY_UNREPORTED = /^-?[\d,]+(?:\.\d+)? \(currency not reported — .+\)$/;
/** Meta sent nothing. */
const MONEY_NO_DATA = "—";

/** POSITIVE test: is this one of the three finished forms? Anything else — "+48.75", "1e3",
 *  " 48.75", "48.75", "MYR" alone — is not, without having to imagine it in advance. */
export function isFinishedMoney(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value === MONEY_NO_DATA || MONEY_WITH_CODE.test(value) || MONEY_UNREPORTED.test(value);
}

/** Would this string be usable as a number? Catches "+48.75", "1e3", "1,240", " 48.75 ". */
export function looksNumeric(value: string): boolean {
  const t = value.trim();
  if (t === "") return false;
  return Number.isFinite(Number(t.replace(/,/g, "")));
}

function sortedKeys(o: object): string[] {
  return Object.keys(o).sort();
}

/** Every value under `block` obeys the whitelists: numbers/numeric strings only where allowed,
 *  booleans only where allowed. */
function expectValueClasses(block: Record<string, unknown>, where: string): void {
  for (const [key, value] of Object.entries(block)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "number") {
      expect(NUMERIC_ALLOWED.has(key), `${where}.${key} is a number but is not on the numeric whitelist`).toBe(true);
      continue;
    }
    if (typeof value === "boolean") {
      expect(BOOLEAN_ALLOWED.has(key), `${where}.${key} is a boolean but is not on the boolean whitelist`).toBe(true);
      continue;
    }
    if (typeof value === "string" && looksNumeric(value)) {
      expect(NUMERIC_ALLOWED.has(key), `${where}.${key} is a usable number ("${value}") but is not on the numeric whitelist`).toBe(true);
    }
  }
}

/** The money block: exactly three keys, every one of them finished text. */
function expectMoneyBlock(money: unknown, where: string): void {
  expect(typeof money === "object" && money !== null, `${where}.money must be an object`).toBe(true);
  const m = money as Record<string, unknown>;
  expect(sortedKeys(m), `${where}.money key set`).toEqual([...MONEY_KEYS]);
  for (const [key, value] of Object.entries(m)) {
    expect(isFinishedMoney(value), `${where}.money.${key} = ${JSON.stringify(value)} is not finished money`).toBe(true);
  }
}

function expectMetricsBlock(metrics: unknown, where: string): void {
  expect(typeof metrics === "object" && metrics !== null, `${where}.metrics must be an object`).toBe(true);
  const m = metrics as Record<string, unknown>;
  expect(sortedKeys(m), `${where}.metrics key set`).toEqual([...METRIC_KEYS]);
  expectValueClasses(m, `${where}.metrics`);
}

/** One model-visible account object, checked against the closed contract. */
export function expectClosedAccountShape(account: unknown, where = "account"): void {
  expect(typeof account === "object" && account !== null, `${where} must be an object`).toBe(true);
  const a = account as Record<string, unknown>;
  expect(sortedKeys(a), `${where} key set`).toEqual([...ACCOUNT_KEYS]);
  expectMoneyBlock(a.money, where);
  expectMetricsBlock(a.metrics, where);
  const { money: _m, metrics: _t, ...rest } = a;
  expectValueClasses(rest, where);
}

/** One model-visible ad row, checked against the SAME contract (one function, both paths). */
export function expectClosedAdShape(ad: unknown, where = "ad"): void {
  expect(typeof ad === "object" && ad !== null, `${where} must be an object`).toBe(true);
  const r = ad as Record<string, unknown>;
  expect(sortedKeys(r), `${where} key set`).toEqual([...AD_KEYS]);
  expectMoneyBlock(r.money, where);
  expectMetricsBlock(r.metrics, where);
  if (r.creative !== null && r.creative !== undefined) {
    expect(sortedKeys(r.creative as object), `${where}.creative key set`).toEqual([...CREATIVE_KEYS]);
  }
  const { money: _m, metrics: _t, creative: _c, ...rest } = r;
  expectValueClasses(rest, where);
}

/** The whole chat-facing payload for the account path. */
export function expectClosedAccountPayload(accounts: readonly unknown[]): void {
  accounts.forEach((a, i) => expectClosedAccountShape(a, `accounts[${i}]`));
}

/** The whole chat-facing payload for the per-ad path. */
export function expectClosedAdPayload(ads: readonly unknown[]): void {
  ads.forEach((a, i) => expectClosedAdShape(a, `ads[${i}]`));
}
