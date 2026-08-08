import { describe, it, expect } from "vitest";
import {
  partsInTz,
  formatTime,
  formatDayLabel,
  formatDayHeading,
  formatCalendarDay,
  dayKey,
  statusPill,
  groupByDay,
  buildMonthGrid,
  shiftMonth,
} from "../schedule-view";
import type { ScheduledPostRow } from "../schedule-actions";

function row(over: Partial<ScheduledPostRow> & { scheduledAt: Date; scheduledTz: string }): ScheduledPostRow {
  return {
    id: over.id ?? "p1",
    channel: over.channel ?? "instagram",
    caption: over.caption ?? "hi",
    firstComment: over.firstComment ?? null,
    scheduledAt: over.scheduledAt,
    scheduledTz: over.scheduledTz,
    status: over.status ?? "DRAFT",
    publishMode: over.publishMode ?? "AUTO",
    source: over.source ?? "owner",
    metaTargetId: over.metaTargetId ?? null,
    approvedAt: over.approvedAt ?? null,
    lastError: over.lastError ?? null,
    media: over.media ?? [],
    updatedAt: over.updatedAt ?? new Date("2026-07-01T00:00:00Z"),
  };
}

describe("partsInTz", () => {
  it("converts a UTC instant into KL-local parts (UTC+8, no DST)", () => {
    // 2026-07-10 01:30 UTC → 09:30 in Asia/Kuala_Lumpur, still Jul 10, a Friday.
    const p = partsInTz(new Date("2026-07-10T01:30:00Z"), "Asia/Kuala_Lumpur");
    expect(p).toMatchObject({ year: 2026, month: 6, day: 10, hour: 9, minute: 30, weekday: 5 });
  });

  it("rolls the calendar day across the tz boundary", () => {
    // 2026-07-09 20:00 UTC → 04:00 next day in KL → Jul 10.
    const p = partsInTz(new Date("2026-07-09T20:00:00Z"), "Asia/Kuala_Lumpur");
    expect(p).toMatchObject({ day: 10, hour: 4 });
  });

  it("falls back to UTC (never throws) on a bad tz", () => {
    const p = partsInTz(new Date("2026-07-10T01:30:00Z"), "Not/AZone");
    expect(p).toMatchObject({ day: 10, hour: 1, minute: 30 });
  });

  it("maps midnight to hour 0, not 24", () => {
    const p = partsInTz(new Date("2026-07-10T00:00:00Z"), "UTC");
    expect(p.hour).toBe(0);
  });
});

describe("formatters are deterministic (no locale)", () => {
  const p = partsInTz(new Date("2026-07-10T01:30:00Z"), "Asia/Kuala_Lumpur");
  it("formatTime → 12h am/pm", () => expect(formatTime(p)).toBe("9:30 AM"));
  it("noon/midnight edge", () => {
    expect(formatTime({ ...p, hour: 0, minute: 0 })).toBe("12:00 AM");
    expect(formatTime({ ...p, hour: 12, minute: 5 })).toBe("12:05 PM");
    expect(formatTime({ ...p, hour: 23, minute: 9 })).toBe("11:09 PM");
  });
  it("formatDayLabel + heading + key", () => {
    expect(formatDayLabel(p)).toBe("Jul 10");
    expect(formatDayHeading(p)).toBe("Fri, Jul 10");
    expect(dayKey(p)).toBe("2026-07-10");
  });
});

// #696 — the same wording for a bare calendar date (Meta's `date_start`), which has no
// instant and no timezone attached.
describe("formatCalendarDay", () => {
  it("writes a YYYY-MM-DD day exactly like formatDayLabel does", () => {
    expect(formatCalendarDay("2026-06-30")).toBe("Jun 30");
    expect(formatCalendarDay("2026-01-01")).toBe("Jan 1");
    expect(formatCalendarDay("2026-12-09")).toBe("Dec 9");
  });

  it("never shifts the day — no Date, so no timezone to shift it by", () => {
    // The bug this guards: `new Date("2026-06-30")` is midnight UTC, which west of
    // Greenwich reads back as the 29th.
    expect(formatCalendarDay("2026-06-30")).toBe("Jun 30");
    expect(formatCalendarDay("2026-03-01")).toBe("Mar 1");
  });

  it("hands back anything that isn't a plain calendar date, unchanged", () => {
    expect(formatCalendarDay("last week")).toBe("last week");
    expect(formatCalendarDay("")).toBe("");
    expect(formatCalendarDay("2026-13-01")).toBe("2026-13-01");
    expect(formatCalendarDay("2026-06-00")).toBe("2026-06-00");
    expect(formatCalendarDay("2026-06-30T00:00:00Z")).toBe("2026-06-30T00:00:00Z");
  });
});

describe("statusPill", () => {
  it("maps every status to a tone", () => {
    expect(statusPill("DRAFT")).toEqual({ label: "Draft", tone: "draft" });
    expect(statusPill("SCHEDULED").tone).toBe("scheduled");
    expect(statusPill("NEEDS_ATTENTION")).toEqual({ label: "Needs attention", tone: "warn" });
    expect(statusPill("CANCELLED").tone).toBe("muted");
    expect(statusPill("WEIRD")).toEqual({ label: "WEIRD", tone: "muted" });
  });
});

describe("groupByDay", () => {
  it("buckets posts by own-tz day, preserving ascending order", () => {
    const posts = [
      row({ id: "a", scheduledAt: new Date("2026-07-10T01:00:00Z"), scheduledTz: "Asia/Kuala_Lumpur" }),
      row({ id: "b", scheduledAt: new Date("2026-07-10T03:00:00Z"), scheduledTz: "Asia/Kuala_Lumpur" }),
      row({ id: "c", scheduledAt: new Date("2026-07-11T02:00:00Z"), scheduledTz: "Asia/Kuala_Lumpur" }),
    ];
    const groups = groupByDay(posts);
    expect(groups.map((g) => g.key)).toEqual(["2026-07-10", "2026-07-11"]);
    expect(groups[0]!.posts.map((p) => p.id)).toEqual(["a", "b"]);
    expect(groups[0]!.heading).toBe("Fri, Jul 10");
  });
});

describe("buildMonthGrid", () => {
  it("is exactly 6 weeks of 7 days", () => {
    const { weeks } = buildMonthGrid(2026, 6, []); // July 2026
    expect(weeks.length).toBe(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("places July 1 2026 (a Wednesday) in the first row, col 3, with leading filler from June", () => {
    const { weeks } = buildMonthGrid(2026, 6, []);
    const firstRow = weeks[0]!;
    expect(firstRow[3]).toMatchObject({ day: 1, inMonth: true });
    // Sun..Tue before it are June filler (out of month).
    expect(firstRow.slice(0, 3).every((c) => !c.inMonth)).toBe(true);
    expect(firstRow[0]!.day).toBe(28); // June 28
  });

  it("drops a post onto its own-tz calendar cell", () => {
    const posts = [row({ id: "x", scheduledAt: new Date("2026-07-10T01:00:00Z"), scheduledTz: "Asia/Kuala_Lumpur" })];
    const { weeks } = buildMonthGrid(2026, 6, posts);
    const cell = weeks.flat().find((c) => c.key === "2026-07-10")!;
    expect(cell.posts.map((p) => p.id)).toEqual(["x"]);
  });
});

describe("shiftMonth", () => {
  it("wraps December → next January and January → prev December", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 6, 1)).toEqual({ year: 2026, month: 7 });
  });
});
