import { describe, it, expect } from "vitest";
import { validateScheduleDraft, isScheduleChannel, SCHEDULE_CHANNEL_CAPS } from "./schedule-draft.js";

const BASE = {
  channel: "instagram",
  caption: "Hello world",
  scheduledAt: "2026-07-10T09:00:00Z",
  scheduledTz: "Asia/Kuala_Lumpur",
};

function ok(input: Record<string, unknown>) {
  const r = validateScheduleDraft(input as never);
  if ("error" in r) throw new Error(`expected ok, got error: ${r.error}`);
  return r.value;
}
function err(input: Record<string, unknown>): string {
  const r = validateScheduleDraft(input as never);
  if (!("error" in r)) throw new Error("expected an error");
  return r.error;
}

describe("validateScheduleDraft — channel", () => {
  it("accepts the supported channels; rejects others", () => {
    expect(ok({ ...BASE, channel: "instagram" }).channel).toBe("instagram");
    expect(ok({ ...BASE, channel: "facebook" }).channel).toBe("facebook");
    expect(ok({ ...BASE, channel: "x" }).channel).toBe("x");
    expect(err({ ...BASE, channel: "tiktok" })).toMatch(/channel/i);
    expect(err({ ...BASE, channel: undefined })).toMatch(/channel/i);
    expect(isScheduleChannel("instagram")).toBe(true);
    expect(isScheduleChannel("x")).toBe(true);
    expect(isScheduleChannel("tiktok")).toBe(false);
  });
});

describe("validateScheduleDraft — caption", () => {
  it("requires a non-empty caption within the length cap", () => {
    expect(err({ ...BASE, caption: "   " })).toMatch(/caption/i);
    expect(err({ ...BASE, caption: "x".repeat(2201) })).toMatch(/caption/i);
    expect(ok({ ...BASE, caption: "  trimmed  " }).caption).toBe("trimmed");
  });
});

describe("validateScheduleDraft — datetime (strict ISO instant)", () => {
  it("accepts a UTC Z instant and an explicit offset", () => {
    expect(ok({ ...BASE, scheduledAt: "2026-07-10T09:00:00Z" }).scheduledAt).toEqual(new Date("2026-07-10T09:00:00Z"));
    expect(ok({ ...BASE, scheduledAt: "2026-07-10T17:00:00+08:00" }).scheduledAt).toEqual(new Date("2026-07-10T09:00:00Z"));
  });
  it("rejects a naive/local datetime with no timezone designator", () => {
    expect(err({ ...BASE, scheduledAt: "2026-07-10T09:00:00" })).toMatch(/date and time/i);
    expect(err({ ...BASE, scheduledAt: "2026-07-10 09:00" })).toMatch(/date and time/i);
    expect(err({ ...BASE, scheduledAt: "next tuesday" })).toMatch(/date and time/i);
    expect(err({ ...BASE, scheduledAt: "" })).toMatch(/date and time/i);
  });
});

describe("validateScheduleDraft — timezone", () => {
  it("accepts a valid IANA zone; rejects an unknown one", () => {
    expect(ok({ ...BASE, scheduledTz: "America/New_York" }).scheduledTz).toBe("America/New_York");
    expect(err({ ...BASE, scheduledTz: "Mars/Phobos" })).toMatch(/time zone/i);
    expect(err({ ...BASE, scheduledTz: "" })).toMatch(/time zone/i);
  });
});

describe("validateScheduleDraft — channel capabilities", () => {
  it("enforces per-channel maxMediaCount (Facebook = 1, Instagram = 10)", () => {
    expect(SCHEDULE_CHANNEL_CAPS.facebook.maxMediaCount).toBe(1);
    expect(SCHEDULE_CHANNEL_CAPS.instagram.maxMediaCount).toBe(10);
    expect(SCHEDULE_CHANNEL_CAPS.x.maxMediaCount).toBe(4);
    expect(SCHEDULE_CHANNEL_CAPS.x.supportsFirstComment).toBe(false);
    expect(err({ ...BASE, channel: "facebook", media: ["a", "b"] })).toMatch(/single|carousel/i);
    expect(ok({ ...BASE, channel: "facebook", media: ["a"] }).media).toEqual(["a"]);
    expect(err({ ...BASE, channel: "instagram", media: Array.from({ length: 11 }, (_, i) => `m${i}`) })).toMatch(/at most 10/i);
    expect(ok({ ...BASE, channel: "instagram", media: Array.from({ length: 10 }, (_, i) => `m${i}`) }).media).toHaveLength(10);
  });

  it("rejects a first comment on a channel that doesn't support it (Facebook)", () => {
    expect(err({ ...BASE, channel: "facebook", firstComment: "first!" })).toMatch(/first comment/i);
    expect(ok({ ...BASE, channel: "instagram", firstComment: "first!" }).firstComment).toBe("first!");
    // an empty/whitespace first comment is normalized to null, allowed on any channel
    expect(ok({ ...BASE, channel: "facebook", firstComment: "  " }).firstComment).toBeNull();
  });
});
