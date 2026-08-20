/**
 * short-date-label — the ONE place a "Jul 3" label is built from fixed month names.
 *
 * The sibling of my-date-format, for the opposite reason. That module owns every
 * `Intl.DateTimeFormat("en-MY", …)`; this one owns the deliberately NON-Intl path — the labels
 * that must come out byte-identical on the server and in the browser, so a hydration mismatch
 * cannot happen and no locale can reorder them. Five call sites each carried their own twelve
 * month names to get it (schedule-view, per-ad-view, performance-card, and the Offers and
 * Products memory panels), two pairs of them character for character.
 *
 * Pure: no I/O, no locale, no timezone. A caller that needs a timezone converts to calendar
 * parts first (see schedule-view's partsInTz) and formats from those.
 */

/** The only short month names in the app. Index 0 = January, matching `Date#getMonth()`. */
export const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "Jul 3" for a Date, read in the LOCAL zone (`getMonth`/`getDate`), as every caller did. */
export function shortDayLabel(date: Date): string {
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** "2026-07-03" → "Jul 3". Takes the date part of an ISO string and never parses it into a
 *  Date — a `new Date("2026-07-03")` is UTC midnight, which is the 2nd of July for a merchant
 *  in Kuala Lumpur. */
export function shortIsoDayLabel(iso: string): string {
  const [, month, day] = iso.slice(0, 10).split("-");
  return `${MONTHS_SHORT[Number(month) - 1]} ${Number(day)}`;
}
