import { describe, expect, it } from "vitest";
import { MY_DATE_FORMAT, MY_DATE_TIME_FORMAT, MY_TIME_FORMAT } from "@/lib/my-date-format";

// #952 item 12 — this is the ONE place `new Intl.DateTimeFormat("en-MY", …)` is declared now.
// Fixed sample instant so the assertions don't drift with "today". 2026-08-16T07:05:09Z is
// 2026-08-16 15:05:09 in Asia/Kuala_Lumpur (UTC+8, no DST).
const SAMPLE = new Date("2026-08-16T07:05:09.000Z");

describe("MY_DATE_FORMAT / MY_DATE_TIME_FORMAT / MY_TIME_FORMAT (#952 item 12)", () => {
  it("MY_DATE_FORMAT reads the day/month/year the merchant sees, pinned to Asia/Kuala_Lumpur", () => {
    expect(MY_DATE_FORMAT.format(SAMPLE)).toBe("16 Aug 2026");
  });

  it("MY_DATE_TIME_FORMAT adds the time, still pinned to Asia/Kuala_Lumpur", () => {
    expect(MY_DATE_TIME_FORMAT.format(SAMPLE)).toBe("16 Aug 2026, 3:05 pm");
  });

  it("MY_TIME_FORMAT is time-only, seconds included, still pinned to Asia/Kuala_Lumpur", () => {
    expect(MY_TIME_FORMAT.format(SAMPLE)).toBe("3:05:09 pm");
  });

  // The whole point of consolidating: nobody can construct a fresh "en-MY" formatter here and
  // forget the timeZone pin, because there is no fresh construction left to forget it on.
  it("every export carries the Asia/Kuala_Lumpur pin in resolvedOptions", () => {
    for (const fmt of [MY_DATE_FORMAT, MY_DATE_TIME_FORMAT, MY_TIME_FORMAT]) {
      expect(fmt.resolvedOptions().timeZone).toBe("Asia/Kuala_Lumpur");
    }
  });
});
