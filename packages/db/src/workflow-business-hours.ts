import { canonicalHash } from "./workflow-compiler.js";

export const BUSINESS_HOURS_CONTENT_VERSION = "fikirtive-business-hours-policy/v1" as const;

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type WeeklyWindow = { weekday: IsoWeekday; startMinute: number; endMinute: number };

export type CanonicalBusinessHoursPolicy = {
  timeZone: string;
  weeklyWindowsJson: WeeklyWindow[];
  contentHash: string;
};

export type BusinessHoursCanonicalizationResult =
  | { ok: true; value: CanonicalBusinessHoursPolicy }
  | { ok: false; reason: "INVALID_TIME_ZONE" | "INVALID_SCHEDULE" };

const WEEKDAYS: Record<string, IsoWeekday> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 128 || value.trim() !== value) return null;
  // Node's Intl accepts numeric offsets and fixed Etc/GMT zones; the contract explicitly does not.
  if (/^[+-]\d{2}(?::?\d{2})?$/.test(value) || /^(?:Etc\/GMT|GMT|UTC)[+-]/i.test(value) || /^Etc\/GMT$/i.test(value)) {
    return null;
  }
  if (value !== "UTC" && !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)+$/.test(value)) return null;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
    // Reject aliases: persisted policies must use the canonical name returned by this runtime.
    return resolved === value ? value : null;
  } catch {
    return null;
  }
}

function normalizeWindows(value: unknown): WeeklyWindow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) return null;
  const split: WeeklyWindow[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || Object.keys(raw).sort().join(",") !== "endMinute,startMinute,weekday") return null;
    const { weekday, startMinute, endMinute } = raw;
    if (!Number.isInteger(weekday) || !Number.isInteger(startMinute) || !Number.isInteger(endMinute)) return null;
    if ((weekday as number) < 1 || (weekday as number) > 7 || (startMinute as number) < 0 || (startMinute as number) >= 1440) return null;
    if ((endMinute as number) < 0 || (endMinute as number) > 1440 || startMinute === endMinute) return null;
    const day = weekday as IsoWeekday;
    const start = startMinute as number;
    const end = endMinute as number;
    if (start < end) {
      split.push({ weekday: day, startMinute: start, endMinute: end });
    } else {
      split.push({ weekday: day, startMinute: start, endMinute: 1440 });
      if (end > 0) split.push({ weekday: (day === 7 ? 1 : day + 1) as IsoWeekday, startMinute: 0, endMinute: end });
    }
  }
  split.sort((left, right) => left.weekday - right.weekday || left.startMinute - right.startMinute || left.endMinute - right.endMinute);
  for (let index = 1; index < split.length; index += 1) {
    const prior = split[index - 1]!;
    const current = split[index]!;
    if (prior.weekday === current.weekday && current.startMinute < prior.endMinute) return null;
  }
  return split;
}

export function canonicalizeBusinessHoursPolicy(input: {
  timeZone: unknown;
  weeklyWindows: unknown;
}): BusinessHoursCanonicalizationResult {
  const timeZone = canonicalTimeZone(input.timeZone);
  if (!timeZone) return { ok: false, reason: "INVALID_TIME_ZONE" };
  const weeklyWindowsJson = normalizeWindows(input.weeklyWindows);
  if (!weeklyWindowsJson) return { ok: false, reason: "INVALID_SCHEDULE" };
  return {
    ok: true,
    value: {
      timeZone,
      weeklyWindowsJson,
      contentHash: canonicalHash(BUSINESS_HOURS_CONTENT_VERSION, { timeZone, weeklyWindowsJson }),
    },
  };
}

export type BusinessHoursPolicyPin = {
  ownerId: string;
  id: string;
  revision: number;
  contentHash: string;
};

export type BusinessHoursPolicyRecord = BusinessHoursPolicyPin & {
  timeZone: unknown;
  weeklyWindowsJson: unknown;
};

export type BusinessHoursEvaluationInput = {
  expected: BusinessHoursPolicyPin;
  policy: BusinessHoursPolicyRecord | null | undefined;
};

export type BusinessHoursUnavailableReason =
  | "POLICY_UNAVAILABLE"
  | "TIME_ZONE_UNAVAILABLE"
  | "SCHEDULE_UNAVAILABLE"
  | "POLICY_CONTENT_DRIFT"
  | "CLOCK_UNAVAILABLE";

export type BusinessHoursEvaluation =
  | {
      status: "inside" | "outside";
      evaluatedAt: string;
      timeZone: string;
      localWeekday: IsoWeekday;
      localMinute: number;
    }
  | { status: "unavailable"; reason: BusinessHoursUnavailableReason };

function pinnedPolicyMatches(expected: BusinessHoursPolicyPin, policy: BusinessHoursPolicyRecord): boolean {
  return expected.ownerId === policy.ownerId && expected.id === policy.id && expected.revision === policy.revision
    && expected.contentHash === policy.contentHash;
}

/** Pure fail-closed evaluation. The injected clock is called exactly once. */
export function evaluateBusinessHours(
  input: BusinessHoursEvaluationInput,
  clock: () => Date = () => new Date(),
): BusinessHoursEvaluation {
  const policy = input.policy;
  if (!policy || !pinnedPolicyMatches(input.expected, policy)) return { status: "unavailable", reason: "POLICY_UNAVAILABLE" };
  const timeZone = canonicalTimeZone(policy.timeZone);
  if (!timeZone) return { status: "unavailable", reason: "TIME_ZONE_UNAVAILABLE" };
  const weeklyWindowsJson = normalizeWindows(policy.weeklyWindowsJson);
  if (!weeklyWindowsJson) return { status: "unavailable", reason: "SCHEDULE_UNAVAILABLE" };
  if (canonicalHash(BUSINESS_HOURS_CONTENT_VERSION, { timeZone, weeklyWindowsJson }) !== policy.contentHash) {
    return { status: "unavailable", reason: "POLICY_CONTENT_DRIFT" };
  }

  let instant: Date;
  try {
    instant = clock();
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new TypeError("invalid clock");
  } catch {
    return { status: "unavailable", reason: "CLOCK_UNAVAILABLE" };
  }

  try {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes): string | undefined => parts.find((item) => item.type === type)?.value;
    const localWeekday = WEEKDAYS[part("weekday") ?? ""];
    const hour = Number(part("hour"));
    const minute = Number(part("minute"));
    if (!localWeekday || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      return { status: "unavailable", reason: "CLOCK_UNAVAILABLE" };
    }
    const today = weeklyWindowsJson.filter((window) => window.weekday === localWeekday);
    // An omitted weekday is not an assertion that the business is closed; it is missing policy.
    if (today.length === 0) return { status: "unavailable", reason: "SCHEDULE_UNAVAILABLE" };
    const localMinute = hour * 60 + minute;
    const status = today.some((window) => localMinute >= window.startMinute && localMinute < window.endMinute)
      ? "inside"
      : "outside";
    return { status, evaluatedAt: new Date(instant.getTime()).toISOString(), timeZone, localWeekday, localMinute };
  } catch {
    return { status: "unavailable", reason: "CLOCK_UNAVAILABLE" };
  }
}
