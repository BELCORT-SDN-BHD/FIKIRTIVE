import { describe, it, expect } from "vitest";
import {
  ANALYTICS_PLATFORMS,
  platformById,
  type AnalyticsPlatform,
} from "@/lib/analytics-platforms";

describe("ANALYTICS_PLATFORMS", () => {
  it("lists exactly the five platforms in order", () => {
    expect(ANALYTICS_PLATFORMS.map((p) => p.id)).toEqual([
      "meta",
      "tiktok",
      "shopee",
      "google",
      "whatsapp",
    ]);
  });

  it("has the pinned labels", () => {
    expect(ANALYTICS_PLATFORMS.map((p) => p.label)).toEqual([
      "Meta (IG + FB)",
      "TikTok",
      "Shopee",
      "Google",
      "WhatsApp",
    ]);
  });

  it("marks exactly one platform live, and it is Meta", () => {
    const live = ANALYTICS_PLATFORMS.filter((p) => p.status === "live");
    expect(live).toHaveLength(1);
    expect(live[0]!.id).toBe("meta");
  });

  it("marks every non-Meta platform as soon", () => {
    for (const p of ANALYTICS_PLATFORMS) {
      expect(p.status).toBe(p.id === "meta" ? "live" : "soon");
    }
  });
});

describe("platformById", () => {
  it("returns the matching platform", () => {
    const meta = platformById("meta");
    expect(meta).toEqual<AnalyticsPlatform>({
      id: "meta",
      label: "Meta (IG + FB)",
      status: "live",
    });
    expect(platformById("tiktok")?.status).toBe("soon");
  });

  it("returns undefined for an unknown id", () => {
    expect(platformById("nope")).toBeUndefined();
  });
});
