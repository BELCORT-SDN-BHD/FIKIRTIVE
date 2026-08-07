/**
 * The closed contract for everything Otto's chat surface is allowed to see about money (#692 r5).
 *
 * Three shapes of this pin have now failed, each the same way: it tried to RECOGNISE money
 * instead of DECLARING where money lives. First by field name (`/spend|cpc|cpm/i`), then by
 * "this string doesn't look like a bare number". Both are guesses over an open set, and a guess
 * over an open set fails open — and this one failed the other way too: a real Meta ad id is a
 * long run of digits, and a "looks like a number" rule kills it for being data that resembles a
 * number. An id looking numeric is a fact about ids, not a leak.
 *
 * So this version stops guessing. Every key path is enumerated, and each path declares the TYPE
 * its value must have:
 *
 *   money.*        string, and one of the three finished forms
 *   metrics.*      the numeric fields — null, a number, or Meta's own numeric string
 *   hasSpend       boolean
 *   everything else (ids, names, currency, moneyBucket, creative.*)   string | null
 *
 * A number cannot get in without violating a declared type (→ red) or arriving under a new key
 * (→ key set → red). Nothing has to be recognised, so nothing can be mis-recognised.
 *
 * Not a *.test.ts file, so vitest does not collect it; the tests that use it import it.
 */
import { expect } from "vitest";

/** Complete key set of a model-visible ACCOUNT object. Nothing else may appear. */
export const ACCOUNT_KEYS = ["accountId", "currency", "metrics", "money", "moneyBucket", "name"] as const;

/** Complete key set of a model-visible AD row. Nothing else may appear. */
export const AD_KEYS = [
  "accountId", "accountName", "adId", "adName", "creative",
  "currency", "hasSpend", "metrics", "money", "moneyBucket",
] as const;

/** Complete key set of the money block — every one of these is finished TEXT. */
export const MONEY_KEYS = ["cpc", "cpm", "spend"] as const;

/**
 * Complete key set of the comparable block — the ONLY paths where a numeric value is legitimate,
 * because a count and a ratio mean the same thing in every currency: a person reached is a person
 * reached, and 2.76% is 2.76% whether the account bills in MYR or SGD.
 */
export const METRIC_KEYS = ["clicks", "ctr", "frequency", "impressions", "purchaseRoas", "reach"] as const;

/** Complete key set of the creative pass-through. Free-form Meta strings — a `videoId` is a long
 *  run of digits and that is fine; it is an id, not an amount. */
export const CREATIVE_KEYS = ["body", "imageUrl", "title", "videoId"] as const;

/** Paths whose value must be a boolean. */
export const BOOLEAN_KEYS: ReadonlySet<string> = new Set(["hasSpend"]);

/** The amount inside a finished money string: plain digits, or correctly grouped thousands.
 *  Rejects "", ",", "1,,2", "1,23", ",123" — a malformed amount is not an amount. */
const AMOUNT = String.raw`(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?`;

/** "MYR 612" / "MYR 1,234.56" — a currency code and its amount, inseparable. */
const MONEY_WITH_CODE = new RegExp(`^[A-Z]{3} -?${AMOUNT}$`);
/** "1240 (currency not reported — Kaia Cafe)" — tied to the one account it belongs to. */
const MONEY_UNREPORTED = new RegExp(`^-?${AMOUNT} \\(currency not reported — .+\\)$`);
/** Meta sent nothing. */
const MONEY_NO_DATA = "—";

/** POSITIVE test: one of exactly three finished forms, or it is not finished money. */
export function isFinishedMoney(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value === MONEY_NO_DATA || MONEY_WITH_CODE.test(value) || MONEY_UNREPORTED.test(value);
}

/** A legitimate metric value: absent, a number, or the numeric string Meta actually sends. This
 *  is a DOMAIN rule for the six enumerated metric paths — not a guess about anything else. */
export function isMetricValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const t = value.trim();
  return t !== "" && Number.isFinite(Number(t.replace(/,/g, "")));
}

/** Ids, names, currency codes, bucket keys, creative text. No numeric-shape check: a purely
 *  numeric ad id is data, not a channel. */
function expectStringOrNull(value: unknown, where: string): void {
  expect(
    value === null || typeof value === "string",
    `${where} must be string | null, got ${typeof value} (${JSON.stringify(value)})`,
  ).toBe(true);
}

function sortedKeys(o: object): string[] {
  return Object.keys(o).sort();
}

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
  for (const [key, value] of Object.entries(m)) {
    expect(isMetricValue(value), `${where}.metrics.${key} = ${JSON.stringify(value)} is not a metric value`).toBe(true);
  }
}

function expectCreativeBlock(creative: unknown, where: string): void {
  if (creative === null || creative === undefined) return;
  expect(typeof creative === "object", `${where}.creative must be an object or null`).toBe(true);
  const c = creative as Record<string, unknown>;
  expect(sortedKeys(c), `${where}.creative key set`).toEqual([...CREATIVE_KEYS]);
  for (const [key, value] of Object.entries(c)) expectStringOrNull(value, `${where}.creative.${key}`);
}

/** Every remaining top-level path: string | null, or boolean where declared. */
function expectPlainFields(rest: Record<string, unknown>, where: string): void {
  for (const [key, value] of Object.entries(rest)) {
    if (BOOLEAN_KEYS.has(key)) {
      expect(typeof value, `${where}.${key} must be a boolean`).toBe("boolean");
      continue;
    }
    expectStringOrNull(value, `${where}.${key}`);
  }
}

/** One model-visible account object, checked against the closed contract. */
export function expectClosedAccountShape(account: unknown, where = "account"): void {
  expect(typeof account === "object" && account !== null, `${where} must be an object`).toBe(true);
  const a = account as Record<string, unknown>;
  expect(sortedKeys(a), `${where} key set`).toEqual([...ACCOUNT_KEYS]);
  expectMoneyBlock(a.money, where);
  expectMetricsBlock(a.metrics, where);
  const { money: _m, metrics: _t, ...rest } = a;
  expectPlainFields(rest, where);
}

/** One model-visible ad row, checked against the SAME contract (one function, both paths). */
export function expectClosedAdShape(ad: unknown, where = "ad"): void {
  expect(typeof ad === "object" && ad !== null, `${where} must be an object`).toBe(true);
  const r = ad as Record<string, unknown>;
  expect(sortedKeys(r), `${where} key set`).toEqual([...AD_KEYS]);
  expectMoneyBlock(r.money, where);
  expectMetricsBlock(r.metrics, where);
  expectCreativeBlock(r.creative, where);
  const { money: _m, metrics: _t, creative: _c, ...rest } = r;
  expectPlainFields(rest, where);
}

/** The whole chat-facing payload for the account path. */
export function expectClosedAccountPayload(accounts: readonly unknown[]): void {
  accounts.forEach((a, i) => expectClosedAccountShape(a, `accounts[${i}]`));
}

/** The whole chat-facing payload for the per-ad path. */
export function expectClosedAdPayload(ads: readonly unknown[]): void {
  ads.forEach((a, i) => expectClosedAdShape(a, `ads[${i}]`));
}
