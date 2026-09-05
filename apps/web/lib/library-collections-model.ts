/**
 * 合集卡片上那两行小字的纯函数(规格 `docs/specs/frontend-baseline.md` §7.3②;验收 FRONT-A6)。
 *
 * 设计里的合集卡写的是「12 items · Updated 2 days ago」(`patterns/library/fixtures.ts` 把这
 * 两句**写死**成字符串)。生产里两句都得从真实的列算出来:数量来自 membership 行数,
 * 时间来自 `Collection.updatedAt`。放在 `lib/` 而不是组件里,是为了让这两条规则能在没有
 * DOM 的情况下被直接钉住 —— 与 seg2a 的 `library-view-model.ts` 同一个理由。
 */

/** 「12 items」/「1 item」—— 单复数别写错,那是商家一眼就会看见的小毛病。 */
export function collectionItemCountLabel(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

/**
 * 「Updated just now / 3 hours ago / 2 days ago / on 12 Aug 2026」。
 *
 * 一周以内说相对时间(商家真正关心的是「最近动过没有」),更久就写日期 —— 「412 days ago」
 * 谁也读不出意义。未来时间(时钟偏移)按 just now 处理,不显示负数。
 */
export function collectionUpdatedLabel(updatedAtIso: string, now: Date): string {
  const at = new Date(updatedAtIso);
  if (Number.isNaN(at.getTime())) return "Updated recently";
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days <= 7) return `Updated ${days} ${days === 1 ? "day" : "days"} ago`;
  return `Updated on ${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(at)}`;
}
