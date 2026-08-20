// Pure view helpers for the Schedule page (UI-first slice, spec §四B). No I/O, no
// spend paths — every function is a total function of its inputs so it can be unit
// tested. Dates are formatted DETERMINISTICALLY off fixed MONTHS/DAYS arrays and the
// post's own scheduledTz — NEVER toLocaleDateString in render (a prior hydration bug
// came from locale-dependent formatting differing between server and client).

import type { ScheduledPostRow } from "./schedule-actions";
import { scheduledPostStatusLabel } from "./social-labels";
// The short month names are shared (lib/short-date-label) — five surfaces had five copies of
// them. Re-exported so this module's own importers are untouched.
import { MONTHS_SHORT } from "./short-date-label";

// Fixed label arrays — the ONLY source of month/day names on this surface.
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
export { MONTHS_SHORT };
export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// --- timezone-aware calendar-part extraction --------------------------------

export type DateParts = {
  year: number;
  month: number; // 0..11
  day: number; // 1..31
  weekday: number; // 0..6 (Sun..Sat)
  hour: number; // 0..23
  minute: number; // 0..59
};

// Cache one Intl.DateTimeFormat per tz — constructing it is the expensive part, and
// the parts it emits (numeric y/m/d/h/min + weekday) are locale-STABLE, so this stays
// deterministic across server/client despite using Intl under the hood.
const partsFmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
      });
    } catch {
      // Unknown tz → fall back to UTC so we never throw in render.
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
      });
    }
    partsFmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Break a UTC instant into calendar parts in the given IANA tz (deterministic). */
export function partsInTz(at: Date, tz: string): DateParts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(at)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  // hour "24" (midnight in hour12:false) → 0
  const hour = Number(map.hour) % 24;
  return {
    year: Number(map.year),
    month: Number(map.month) - 1,
    day: Number(map.day),
    weekday: WEEKDAY_INDEX[map.weekday ?? "Sun"] ?? 0,
    hour,
    minute: Number(map.minute),
  };
}

// --- formatting (deterministic) ---------------------------------------------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "9:05 AM" style, from parts — no locale, no Intl in the hot path. */
export function formatTime(p: DateParts): string {
  const ampm = p.hour < 12 ? "AM" : "PM";
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${pad2(p.minute)} ${ampm}`;
}

/** "Jul 10" — short month + day. */
export function formatDayLabel(p: DateParts): string {
  return `${MONTHS_SHORT[p.month]} ${p.day}`;
}

/** "Wed, Jul 10" — weekday + short date, for queue day-group headers. */
export function formatDayHeading(p: DateParts): string {
  return `${DAYS_SHORT[p.weekday]}, ${MONTHS_SHORT[p.month]} ${p.day}`;
}

/**
 * The same "Jul 10" wording for a CALENDAR DATE that arrives as a bare "YYYY-MM-DD"
 * string — Meta's `date_start`, which names a day in the ad account's own timezone and
 * carries no instant (#696). Reading the parts straight off the string is the point:
 * putting it through `new Date(...)` would invent a timezone, and "2026-06-30" can then
 * come back out as the 29th. Month names come from MONTHS_SHORT like every other date
 * on the product, so this cannot drift into its own dialect.
 *
 * Anything that is not a plain calendar date is returned unchanged: a surface should
 * show the raw value it was given rather than a confident "undefined NaN".
 */
export function formatCalendarDay(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return isoDate;
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return isoDate;
  return `${MONTHS_SHORT[month]} ${day}`;
}

/** "y-mm-dd" stable key for same-day grouping (in the post's own tz). */
export function dayKey(p: DateParts): string {
  return `${p.year}-${pad2(p.month + 1)}-${pad2(p.day)}`;
}

// --- status pills -----------------------------------------------------------

export type StatusTone = "draft" | "scheduled" | "publishing" | "published" | "warn" | "error" | "muted";

/** Map a ScheduledPost.status to a display label + tone (for the pill colours).
 *  The WORDS come from social-labels, which is the one definition every surface reads (#822);
 *  only the tone — a fact about this pill, not about the status — is decided here. */
export function statusPill(status: string): { label: string; tone: StatusTone } {
  const label = scheduledPostStatusLabel(status);
  switch (status) {
    case "DRAFT": return { label, tone: "draft" };
    case "SCHEDULED": return { label, tone: "scheduled" };
    case "PUBLISHING": return { label, tone: "publishing" };
    case "PUBLISHED": return { label, tone: "published" };
    case "NEEDS_ATTENTION": return { label, tone: "warn" };
    case "FAILED": return { label, tone: "error" };
    default: return { label, tone: "muted" };
  }
}

// --- grouping ---------------------------------------------------------------

export type DayGroup = { key: string; heading: string; posts: ScheduledPostRow[] };

/** Group posts by their own-tz calendar day, ascending, preserving each group's
 *  input order (rows arrive scheduledAt-ascending from listScheduledPosts). */
export function groupByDay(posts: ScheduledPostRow[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const post of posts) {
    const p = partsInTz(post.scheduledAt, post.scheduledTz);
    const key = dayKey(p);
    let g = groups.get(key);
    if (!g) {
      g = { key, heading: formatDayHeading(p), posts: [] };
      groups.set(key, g);
    }
    g.posts.push(post);
  }
  // Map preserves insertion order; input is scheduledAt-ascending so groups are too.
  return [...groups.values()];
}

// --- month calendar grid ----------------------------------------------------

export type CalendarCell = {
  key: string;            // y-mm-dd
  day: number;            // 1..31
  inMonth: boolean;       // false = leading/trailing filler day
  posts: ScheduledPostRow[];
};

/** Build a 6-row (42-cell) month grid for the given year/month (0-based), Sunday-first.
 *  Each cell carries the posts whose OWN-tz calendar day lands on it. Pure integer date
 *  math (UTC Date only used as an arithmetic clock, never for display). */
export function buildMonthGrid(
  year: number,
  month: number,
  posts: ScheduledPostRow[],
): { weeks: CalendarCell[][] } {
  // Bucket posts by their own-tz day key once.
  const byDay = new Map<string, ScheduledPostRow[]>();
  for (const post of posts) {
    const k = dayKey(partsInTz(post.scheduledAt, post.scheduledTz));
    const arr = byDay.get(k) ?? [];
    arr.push(post);
    byDay.set(k, arr);
  }

  // First cell = the Sunday on/just-before the 1st. Use UTC math to avoid DST drift.
  const first = new Date(Date.UTC(year, month, 1));
  const firstWeekday = first.getUTCDay(); // 0..6
  const startMs = Date.UTC(year, month, 1 - firstWeekday);

  const weeks: CalendarCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(startMs + (w * 7 + d) * 86400000);
      const cy = cur.getUTCFullYear();
      const cm = cur.getUTCMonth();
      const cd = cur.getUTCDate();
      const key = `${cy}-${pad2(cm + 1)}-${pad2(cd)}`;
      row.push({
        key,
        day: cd,
        inMonth: cm === month && cy === year,
        posts: byDay.get(key) ?? [],
      });
    }
    weeks.push(row);
  }
  return { weeks };
}

/** Shift a (year, month) by ±1, wrapping the year. */
export function shiftMonth(year: number, month: number, dir: -1 | 1): { year: number; month: number } {
  const m = month + dir;
  if (m < 0) return { year: year - 1, month: 11 };
  if (m > 11) return { year: year + 1, month: 0 };
  return { year, month: m };
}
