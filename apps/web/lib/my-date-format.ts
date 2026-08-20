/**
 * my-date-format — the ONE place `new Intl.DateTimeFormat("en-MY", …)` gets declared.
 *
 * #952 item 12 (audit evidence, judge caught the risk on PR #950 r1 P1 — NorthstarHomeEntry.tsx
 * was the 8th site to hand-roll this and almost shipped without the `timeZone` pin): ten call
 * sites across CRM and Campaign each declared their own `new Intl.DateTimeFormat("en-MY", {...,
 * timeZone: "Asia/Kuala_Lumpur"})`. A copy repeated this many times is a copy someone eventually
 * forgets the pin on — and without it, the format reads in the SERVER's zone (production
 * containers commonly run UTC), so a Malaysian merchant (UTC+8) sees "yesterday" for the first
 * 8 hours of every day.
 *
 * Three shapes cover every call site today. Each export is a ready-made `Intl.DateTimeFormat`
 * instance (not a factory) so existing call sites swap in with no behavior change — every
 * caller's own null/invalid-date guard and fallback text (`"Not recorded"`, `"Unknown"`, …) stays
 * exactly where it was; only the duplicated construction moves here.
 */
/** 商家所在的时区 —— 这个文件存在的理由就是它,所以它也从这里出口。
 *
 *  出口给的是**读时钟**的调用点(Home 的 `Good morning / afternoon / evening` 要知道现在
 *  是商家的几点,见 `components/home/home-data.ts`),它们要的不是一种格式而是这个时区本身。
 *  没有它,那种调用点只会在别处再打一遍 `"Asia/Kuala_Lumpur"` —— 正是这个文件收掉的那种
 *  重复:生产容器多半跑 UTC,漏掉这个 pin 的地方会在马来西亚的每天头 8 小时说错话。 */
export const MY_TIME_ZONE = "Asia/Kuala_Lumpur";

/** "12 Aug 2026" — every list/detail page's plain "created"/"updated"/"sent" column. */
export const MY_DATE_FORMAT = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: MY_TIME_ZONE,
});

/** "12 Aug 2026, 3:45 pm" — every inbox/report/broadcast/workflow/contact timestamp. */
export const MY_DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: MY_TIME_ZONE,
});

/** "3:45:12 pm" — Inbox's own-message time-only stamp. */
export const MY_TIME_FORMAT = new Intl.DateTimeFormat("en-MY", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: MY_TIME_ZONE,
});
