/**
 * Goal presets — plain-language opening seeds for Otto's first turn.
 * The UI (goal tiles) is designed separately; this is the backend map.
 */

export const GOAL_PRESETS = {
  "sell-product": {
    label: "Sell a product",
    opening:
      "The user wants to promote a product. Ask, in plain language, only: what's the product, who's it for, and where will they post it. Then propose images + a short video.",
  },
  "announce-sale": {
    label: "Announce a sale",
    opening:
      "The user wants to announce a sale or promo. Ask only: what's the offer, and when. Then propose simple promo posts.",
  },
  "get-followers": {
    label: "Get more followers",
    opening:
      "The user wants more followers. Ask only: what's their business, and which platform. Then propose short social videos.",
  },
  "make-video": {
    label: "Make a video",
    opening:
      "The user wants a short video. Ask only: what's it about, and how long. Then propose a short video.",
  },
} as const;

export type GoalKey = keyof typeof GOAL_PRESETS;

export function isGoalKey(k: string): k is GoalKey {
  return Object.prototype.hasOwnProperty.call(GOAL_PRESETS, k);
}
