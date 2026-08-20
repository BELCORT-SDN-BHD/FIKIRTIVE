/**
 * Goal presets — plain-language opening seeds for Otto's first turn.
 *
 * 一处作者:`label` 是商家点一下**发出去的那句话**本身,`opening` 是那一轮给 Otto 的开场
 * 交代。两个读者都从这里取 —— 前门四个目标格子(`FRONT_DOOR_GOAL_LABELS`)与面板底部的
 * 页面快捷 chips 都不自己写标签,`coworkTurnRequest.goalKey` 的枚举也从这里的键生成。
 * 抄第二份,守卫认得的与界面发出的就会先后漂移(#979 的病根)。
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
  // 下面两条是 W2-8(#995)面板底部的页面快捷 chips 要用的目标 —— 规格书 §3.4 点名的
  // 「Home 给 Plan a campaign,Schedule 给 Fill next week」。它们走的是与上面四条**同一个**
  // 机制(点一下把 label 当这一轮的话发出去,goalKey 随行去 seed 开场),不是第二套 chips。
  // 前门仍然只画上面四格 —— `OttoFrontDoor` 的 GOAL_TILES 是一份显式清单,不按这里的长度画。
  "plan-campaign": {
    label: "Plan a campaign",
    opening:
      "The user wants to plan a campaign. Ask only: what's the occasion, and how long it runs. Then propose a campaign plan for them to approve.",
  },
  "fill-week": {
    label: "Fill next week",
    opening:
      "The user wants next week's schedule filled. Ask only: how many posts, and where they go out. Then propose posts with dates and times for them to approve.",
  },
} as const;

export type GoalKey = keyof typeof GOAL_PRESETS;

/** 枚举用:`coworkTurnRequest.goalKey` 与围栏都拿这一份,不在别处手抄一遍键名。 */
export const GOAL_KEYS = Object.keys(GOAL_PRESETS) as [GoalKey, ...GoalKey[]];

export function isGoalKey(k: string): k is GoalKey {
  return Object.prototype.hasOwnProperty.call(GOAL_PRESETS, k);
}
