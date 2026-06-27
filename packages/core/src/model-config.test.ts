import { describe, it, expect, afterEach } from "vitest";
import { activeImageModel, activeVideoModel, assertSpendableModel } from "./model-config.js";

describe("activeVideoModel", () => {
  it("uses OTTO_DEFAULT_VIDEO_MODEL when it is a known video model", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "kling-2.6" })).toBe("kling-2.6");
  });
  it("falls back to veo3.1-lite when env is unset/invalid", () => {
    expect(activeVideoModel({})).toBe("veo3.1-lite");
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "not-a-model" })).toBe("veo3.1-lite");
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

describe("activeVideoModel default", () => {
  const prev = process.env.OTTO_DEFAULT_VIDEO_MODEL;
  afterEach(() => { if (prev === undefined) delete process.env.OTTO_DEFAULT_VIDEO_MODEL; else process.env.OTTO_DEFAULT_VIDEO_MODEL = prev; });
  it("defaults to veo3.1-lite when no env override", () => {
    delete process.env.OTTO_DEFAULT_VIDEO_MODEL;
    expect(activeVideoModel()).toBe("veo3.1-lite");
  });
  it("honors a valid env override", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "veo3.1" })).toBe("veo3.1");
  });
  it("ignores an unknown env value (falls back to veo3.1-lite)", () => {
    expect(activeVideoModel({ OTTO_DEFAULT_VIDEO_MODEL: "not-a-model" })).toBe("veo3.1-lite");
  });
});
