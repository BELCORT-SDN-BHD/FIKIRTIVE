/**
 * The one sentence that governs money in Otto's Meta answers (#692 r3).
 *
 * It ships as MODEL-VISIBLE TEXT — in each skill's description and again inside the payload —
 * because a rule written only in TypeScript comments never reaches the model. It is the belt;
 * the shape is the braces: the web-side boundary (lib/otto-money-view.ts) hands over money as
 * finished text, so there is no bare amount to add even if this sentence were ignored.
 */
export const MONEY_RULE =
  "Money figures here are already formatted with the currency they are in, or with the ad " +
  "account's name when Meta reported no currency for it. Use them exactly as given: never add, " +
  "rank or compare money across different moneyBucket values. Two accounts Meta reported no " +
  "currency for are NOT in the same currency — each has a bucket of its own and their figures " +
  "may not be pooled or ranked against each other either. Ratio metrics (CTR, ROAS) and counts " +
  "(reach, impressions, clicks) ARE comparable across accounts.";
