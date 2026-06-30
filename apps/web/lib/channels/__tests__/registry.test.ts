import { describe, it, expect } from "vitest";
import { listChannels, getChannel } from "../registry";

describe("channelRegistry", () => {
  it("registers instagram and facebook", () => {
    const ids = listChannels().map((c) => c.id).sort();
    expect(ids).toEqual(["facebook", "instagram"]);
  });
  it("instagram declares its capabilities (carousel<=10, rate limit 25)", () => {
    const ig = getChannel("instagram")!;
    expect(ig.capabilities.maxMediaCount).toBe(10);
    expect(ig.capabilities.rateLimitPer24h).toBe(25);
    expect(ig.capabilities.postTypes).toContain("carousel");
    expect(ig.capabilities.supportsFirstComment).toBe(true);
    expect(ig.capabilities.supportsNativeSchedule).toBe(false);
  });
  it("getChannel returns undefined for an unknown id", () => {
    expect(getChannel("tiktok")).toBeUndefined();
  });
  it("facebook declares its capabilities", () => {
    const fb = getChannel("facebook")!;
    expect(fb.capabilities.maxMediaCount).toBe(1);
    expect(fb.capabilities.supportsNativeSchedule).toBe(true);
    expect(fb.capabilities.supportsFirstComment).toBe(false);
  });
});
