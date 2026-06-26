export type PackKey = "10" | "25" | "50";

export interface CreditPack {
  key: PackKey;
  usd: number;
  displayCredits: number;
  internalCredits: number;
}

/** $1 = 10 displayed credits = 100 internal credits. */
export const CREDIT_PACKS: Record<PackKey, CreditPack> = {
  "10": { key: "10", usd: 10, displayCredits: 100, internalCredits: 1000 },
  "25": { key: "25", usd: 25, displayCredits: 250, internalCredits: 2500 },
  "50": { key: "50", usd: 50, displayCredits: 500, internalCredits: 5000 },
};

export function packFor(key: string): CreditPack | null {
  return (CREDIT_PACKS as Record<string, CreditPack>)[key] ?? null;
}
