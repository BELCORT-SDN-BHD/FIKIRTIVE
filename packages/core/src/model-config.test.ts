import { describe, it, expect } from "vitest";
import { activeImageModel, activeVideoModel, assertSpendableModel } from "./model-config.js";

describe("activeVideoModel", () => {
  it("uses OTTO_DEFAULT_VIDEO_MODEL when it is a known video model", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "kling-2.6" })).toBe("kling-2.6");
  });
  it("falls back to the first known video model when env is unset/invalid", () => {
    expect(activeVideoModel({})).toBe("kling");
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "not-a-model" })).toBe("kling");
  });
});

describe("assertSpendableModel", () => {
  it("accepts the active image model", () => {
    expect(assertSpendableModel("seedream", "image", {})).toEqual({ ok: true });
  });
  it("rejects a non-active video model", () => {
    const r = assertSpendableModel("veo3.1", "video", { OTTO_DEFAULT_VIDEO_MODEL: "kling" });
    expect(r.ok).toBe(false);
  });
  it("rejects an unknown model id", () => {
    expect(assertSpendableModel("totally-fake", "image", {}).ok).toBe(false);
  });
});
