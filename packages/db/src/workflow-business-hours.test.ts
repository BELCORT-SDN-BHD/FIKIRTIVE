import { describe, expect, it } from "vitest";
import {
  canonicalizeBusinessHoursPolicy,
  evaluateBusinessHours,
  type BusinessHoursEvaluationInput,
  type BusinessHoursPolicyRecord,
  type WeeklyWindow,
} from "./workflow-business-hours.js";

function policyInput(timeZone: string, weeklyWindows: WeeklyWindow[]): BusinessHoursEvaluationInput {
  const canonical = canonicalizeBusinessHoursPolicy({ timeZone, weeklyWindows });
  if (!canonical.ok) throw new Error(`invalid fixture: ${canonical.reason}`);
  const pin = { ownerId: "org_a", id: "bhp_1", revision: 3, contentHash: canonical.value.contentHash };
  return {
    expected: pin,
    policy: { ...pin, timeZone: canonical.value.timeZone, weeklyWindowsJson: canonical.value.weeklyWindowsJson },
  };
}

const at = (iso: string) => () => new Date(iso);

describe("business-hours canonicalization", () => {
  it("sorts windows and deterministically hashes equivalent input", () => {
    const one = canonicalizeBusinessHoursPolicy({
      timeZone: "Asia/Kuala_Lumpur",
      weeklyWindows: [
        { weekday: 2, startMinute: 540, endMinute: 1020 },
        { weekday: 1, startMinute: 540, endMinute: 720 },
      ],
    });
    const two = canonicalizeBusinessHoursPolicy({
      timeZone: "Asia/Kuala_Lumpur",
      weeklyWindows: [
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 2, startMinute: 540, endMinute: 1020 },
      ],
    });
    expect(one.ok && two.ok).toBe(true);
    if (one.ok && two.ok) {
      expect(one.value.weeklyWindowsJson).toEqual(two.value.weeklyWindowsJson);
      expect(one.value.contentHash).toBe(two.value.contentHash);
      expect(one.value.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("splits overnight windows, including Sunday wrap to Monday", () => {
    const result = canonicalizeBusinessHoursPolicy({
      timeZone: "UTC",
      weeklyWindows: [
        { weekday: 7, startMinute: 1320, endMinute: 120 },
        { weekday: 2, startMinute: 1320, endMinute: 0 },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        weeklyWindowsJson: [
          { weekday: 1, startMinute: 0, endMinute: 120 },
          { weekday: 2, startMinute: 1320, endMinute: 1440 },
          { weekday: 7, startMinute: 1320, endMinute: 1440 },
        ],
      },
    });
  });

  it.each(["+08:00", "Etc/GMT+8", "Etc/UTC", "US/Eastern", "Not/AZone", ""])(
    "rejects fixed, aliased, or invalid timezone %s",
    (timeZone) => {
      expect(canonicalizeBusinessHoursPolicy({
        timeZone,
        weeklyWindows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
      })).toEqual({ ok: false, reason: "INVALID_TIME_ZONE" });
    },
  );

  it("rejects empty, malformed, out-of-range, zero-length, and overlapping schedules", () => {
    const invalid: unknown[] = [
      [],
      [{ weekday: 0, startMinute: 0, endMinute: 60 }],
      [{ weekday: 1, startMinute: 1440, endMinute: 60 }],
      [{ weekday: 1, startMinute: 60, endMinute: 60 }],
      [{ weekday: 1, startMinute: 0, endMinute: 60, extra: true }],
      [
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 600, endMinute: 900 },
      ],
      [
        { weekday: 1, startMinute: 1320, endMinute: 120 },
        { weekday: 2, startMinute: 60, endMinute: 180 },
      ],
    ];
    for (const weeklyWindows of invalid) {
      expect(canonicalizeBusinessHoursPolicy({ timeZone: "UTC", weeklyWindows })).toEqual({
        ok: false,
        reason: "INVALID_SCHEDULE",
      });
    }
  });
});

describe("business-hours evaluation", () => {
  it("uses start-inclusive and end-exclusive boundaries", () => {
    const input = policyInput("Asia/Kuala_Lumpur", [{ weekday: 1, startMinute: 540, endMinute: 1020 }]);
    expect(evaluateBusinessHours(input, at("2026-07-20T00:59:00.000Z"))).toMatchObject({ status: "outside", localMinute: 539 });
    expect(evaluateBusinessHours(input, at("2026-07-20T01:00:00.000Z"))).toMatchObject({ status: "inside", localMinute: 540 });
    expect(evaluateBusinessHours(input, at("2026-07-20T08:59:00.000Z"))).toMatchObject({ status: "inside", localMinute: 1019 });
    expect(evaluateBusinessHours(input, at("2026-07-20T09:00:00.000Z"))).toMatchObject({ status: "outside", localMinute: 1020 });
  });

  it("evaluates the canonical split across a weekday boundary", () => {
    const input = policyInput("UTC", [{ weekday: 1, startMinute: 1320, endMinute: 120 }]);
    expect(evaluateBusinessHours(input, at("2026-07-20T21:59:00.000Z"))).toMatchObject({ status: "outside", localWeekday: 1 });
    expect(evaluateBusinessHours(input, at("2026-07-20T22:00:00.000Z"))).toMatchObject({ status: "inside", localWeekday: 1 });
    expect(evaluateBusinessHours(input, at("2026-07-21T01:59:00.000Z"))).toMatchObject({ status: "inside", localWeekday: 2 });
    expect(evaluateBusinessHours(input, at("2026-07-21T02:00:00.000Z"))).toMatchObject({ status: "outside", localWeekday: 2 });
  });

  it("lets IANA rules handle DST spring-forward and repeated fall-back local time", () => {
    const input = policyInput("America/New_York", [{ weekday: 7, startMinute: 60, endMinute: 120 }]);
    expect(evaluateBusinessHours(input, at("2026-03-08T06:59:00.000Z"))).toMatchObject({ status: "inside", localMinute: 119 });
    // 02:00-02:59 does not exist on this local date; 07:00Z maps directly to 03:00.
    expect(evaluateBusinessHours(input, at("2026-03-08T07:00:00.000Z"))).toMatchObject({ status: "outside", localMinute: 180 });
    // Both instants map to the repeated local 01:30 and must receive the same decision.
    expect(evaluateBusinessHours(input, at("2026-11-01T05:30:00.000Z"))).toMatchObject({ status: "inside", localMinute: 90 });
    expect(evaluateBusinessHours(input, at("2026-11-01T06:30:00.000Z"))).toMatchObject({ status: "inside", localMinute: 90 });
  });

  it("treats a missing weekday schedule as unavailable, never outside", () => {
    const input = policyInput("UTC", [{ weekday: 1, startMinute: 540, endMinute: 1020 }]);
    expect(evaluateBusinessHours(input, at("2026-07-21T10:00:00.000Z"))).toEqual({
      status: "unavailable",
      reason: "SCHEDULE_UNAVAILABLE",
    });
  });

  it("fails closed for missing or mismatched exact policy pins", () => {
    const input = policyInput("UTC", [{ weekday: 1, startMinute: 540, endMinute: 1020 }]);
    expect(evaluateBusinessHours({ ...input, policy: null }, at("2026-07-20T10:00:00.000Z"))).toEqual({
      status: "unavailable",
      reason: "POLICY_UNAVAILABLE",
    });
    for (const mismatch of [
      { ownerId: "org_b" },
      { id: "bhp_other" },
      { revision: 4 },
      { contentHash: "different" },
    ]) {
      expect(evaluateBusinessHours({ ...input, policy: { ...input.policy!, ...mismatch } }, at("2026-07-20T10:00:00.000Z")))
        .toEqual({ status: "unavailable", reason: "POLICY_UNAVAILABLE" });
    }
  });

  it("fails closed for invalid timezone/schedule, content drift, and bad clocks", () => {
    const input = policyInput("UTC", [{ weekday: 1, startMinute: 540, endMinute: 1020 }]);
    const row = input.policy!;
    const matching = (overrides: Partial<BusinessHoursPolicyRecord>): BusinessHoursEvaluationInput => {
      const policy = { ...row, ...overrides };
      return { expected: { ownerId: policy.ownerId, id: policy.id, revision: policy.revision, contentHash: policy.contentHash }, policy };
    };
    expect(evaluateBusinessHours(matching({ timeZone: "+08:00" }), at("2026-07-20T10:00:00.000Z")))
      .toEqual({ status: "unavailable", reason: "TIME_ZONE_UNAVAILABLE" });
    expect(evaluateBusinessHours(matching({ weeklyWindowsJson: [] }), at("2026-07-20T10:00:00.000Z")))
      .toEqual({ status: "unavailable", reason: "SCHEDULE_UNAVAILABLE" });
    expect(evaluateBusinessHours(matching({ weeklyWindowsJson: [{ weekday: 1, startMinute: 600, endMinute: 1020 }] }), at("2026-07-20T10:00:00.000Z")))
      .toEqual({ status: "unavailable", reason: "POLICY_CONTENT_DRIFT" });
    expect(evaluateBusinessHours(input, () => { throw new Error("clock failed"); }))
      .toEqual({ status: "unavailable", reason: "CLOCK_UNAVAILABLE" });
    expect(evaluateBusinessHours(input, () => new Date(Number.NaN)))
      .toEqual({ status: "unavailable", reason: "CLOCK_UNAVAILABLE" });
  });
});
