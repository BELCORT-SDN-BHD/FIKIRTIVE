/** Pure helpers for pack credit math. */

export interface PayloadWithPrice {
  estimatedCredits?: number;
  estimatedPriceUsd?: number;
}

/**
 * Calculate total credits for a pack (sum of all card costs).
 * Each card converts estimatedPriceUsd → credits at 1 credit = $0.10.
 * Mirrors the inline logic from PackCard.tsx line 32 and line 63.
 */
export function packTotalCredits(cards: { payload: unknown }[]): number {
  return cards.reduce((sum, c) => {
    const p = (c.payload ?? {}) as PayloadWithPrice;
    // Match payloadCredits logic: use estimatedCredits if present, else convert USD
    const cardCredits =
      typeof p.estimatedCredits === "number"
        ? p.estimatedCredits
        : Math.max(1, Math.ceil((typeof p.estimatedPriceUsd === "number" ? p.estimatedPriceUsd : 0) / 0.1));
    return sum + cardCredits;
  }, 0);
}

/**
 * Check if a user can afford a pack.
 * balanceUsd is converted to credits at 1 credit = $0.10.
 * Mirrors the inline affordability logic from PackCard.tsx line 67.
 */
export function canAffordPack(totalCredits: number, balanceUsd: number): boolean {
  // Recover exact integer credits before dividing: balanceUsd/0.1 is IEEE-754
  // imprecise (0.3/0.1 === 2.9999999999999996), so a naive Math.floor under-counts
  // and blocks affordable packs. Round cents first, then divide by the 10-cent rate.
  const balanceCredits = Math.floor(Math.round(balanceUsd * 100) / 10);
  return totalCredits <= balanceCredits;
}
