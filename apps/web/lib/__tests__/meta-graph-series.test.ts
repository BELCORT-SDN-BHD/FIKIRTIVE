import { describe, it, expect } from "vitest";
import { parseDailyRows } from "../meta-graph";

describe("parseDailyRows", () => {
  it("maps Meta daily rows to numbers with date_start as the day", () => {
    const rows = [
      { date_start: "2026-06-01", date_stop: "2026-06-01", spend: "12.5", reach: "800", impressions: "1200", clicks: "30" },
      { date_start: "2026-06-02", date_stop: "2026-06-02", spend: null, reach: undefined, impressions: "0", clicks: "0" },
    ];
    expect(parseDailyRows(rows)).toEqual([
      { date: "2026-06-01", spend: 12.5, reach: 800, impressions: 1200, clicks: 30 },
      { date: "2026-06-02", spend: 0, reach: 0, impressions: 0, clicks: 0 },
    ]);
  });
  it("drops rows without date_start and non-objects", () => {
    expect(parseDailyRows([{ spend: "1" }, null, "x"])).toEqual([]);
  });
});
