import { describe, expect, it } from "vitest";
import { suggestModel } from "./cowork-route.js";
import { GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_OPTIONS, GEN_VIDEO_MODEL_INFO, type GenVideoModel } from "./gen.js";

describe("suggestModel", () => {
  it("image → seedream with count default", () => {
    const r = suggestModel({ kind: "image" });
    expect(r.model).toBe("seedream");
    expect(r.params.count).toBeGreaterThanOrEqual(1);
  });
  it("video honours a 9:16 t2v request with a model that exposes aspect", () => {
    const r = suggestModel({ kind: "video", desiredAspect: "9:16" });
    const o = GEN_VIDEO_MODEL_OPTIONS[r.model as GenVideoModel];
    expect(o.aspectRatios.length === 0 || o.aspectRatios.includes("9:16")).toBe(true);
    if (o.aspectRatios.length) expect(r.params.aspectRatio).toBe("9:16");
  });
  it("empty-aspect (Kling-class) models are NOT disqualified by a desiredAspect", () => {
    const r = suggestModel({ kind: "video", desiredAspect: "9:16", hasSourceImage: true });
    expect(r.model).toBeTruthy();
  });
  it("snaps an unavailable duration to the model's option set and flags downgraded", () => {
    const r = suggestModel({ kind: "video", desiredDuration: 7 });
    const o = GEN_VIDEO_MODEL_OPTIONS[r.model as GenVideoModel];
    expect(o.durations).toContain(r.params.durationSeconds);
    expect(r.downgraded).toBe(true);
  });
  it("always returns audio + count (so videoPriceUsd is truthful)", () => {
    const r = suggestModel({ kind: "video" });
    expect(typeof r.params.audio === "boolean").toBe(true);
    expect(r.params.count).toBe(1);
  });
  it("t2v with a desiredAspect picks a model that actually EXPOSES that aspect (not a cheap empty-aspect model that would silently drop it)", () => {
    const r = suggestModel({ kind: "video", desiredAspect: "9:16" }); // t2v: no source frame
    const o = GEN_VIDEO_MODEL_OPTIONS[r.model as GenVideoModel];
    expect(o.aspectRatios).toContain("9:16");
    expect(r.params.aspectRatio).toBe("9:16");
    expect(r.reason).not.toContain("source");
  });
  it("i2v with a desiredAspect keeps cheap empty-aspect models (aspect comes from the source frame)", () => {
    const r = suggestModel({ kind: "video", desiredAspect: "9:16", hasSourceImage: true });
    const o = GEN_VIDEO_MODEL_OPTIONS[r.model as GenVideoModel];
    if (o.aspectRatios.length === 0) {
      expect(r.params.aspectRatio).toBeUndefined();
      expect(r.reason).toContain("source frame");
    } else {
      expect(r.params.aspectRatio).toBe("9:16");
    }
  });
  it("a tail (end-frame) request routes to a tail-capable model", () => {
    const r = suggestModel({ kind: "video", hasTail: true });
    expect(GEN_VIDEO_MODEL_INFO[r.model as GenVideoModel].tail).toBe(true);
  });
  it("an aspect NO model can honor (t2v) flags downgraded and never fabricates the impossible aspect (fallback path)", () => {
    const r = suggestModel({ kind: "video", desiredAspect: "21:9" }); // no model exposes 21:9 → empty pool → full-list fallback
    expect(r.downgraded).toBe(true);
    expect(r.params.aspectRatio).not.toBe("21:9");
  });
  it("excludes a disabled model from the candidate pool (additive narrowing)", () => {
    // whatever the cheapest t2v pick is, disabling it must force a different model
    const free = suggestModel({ kind: "video" });
    const narrowed = suggestModel({ kind: "video", disabled: new Set([free.model]) });
    expect(narrowed.model).not.toBe(free.model);
    expect((GEN_VIDEO_MODELS as readonly string[]).includes(narrowed.model)).toBe(true);
  });
  it("when the capability filter empties the pool, falls back to an ENABLED model — never a disabled one", () => {
    // 21:9 is exposed by no model → capability filter empties the pool → empty-pool
    // fallback. Disabling that fallback's pick must NOT resurrect it (old code fell
    // back to the FULL menu and would return the disabled model).
    const fallbackPick = suggestModel({ kind: "video", desiredAspect: "21:9" }).model;
    const r = suggestModel({ kind: "video", desiredAspect: "21:9", disabled: new Set([fallbackPick]) });
    expect(r.model).not.toBe(fallbackPick); // a disabled model is never returned…
    expect((GEN_VIDEO_MODELS as readonly string[]).includes(r.model)).toBe(true); // …and it's still a typed model
  });
  it("disabling the natural pick returns a different ENABLED model", () => {
    const natural = suggestModel({ kind: "video" });
    const narrowed = suggestModel({ kind: "video", disabled: new Set([natural.model]) });
    expect(narrowed.model).not.toBe(natural.model);
    expect((GEN_VIDEO_MODELS as readonly string[]).includes(narrowed.model)).toBe(true);
  });
  it("only the degenerate all-disabled case falls back to the full typed menu (returns a value, blocked downstream)", () => {
    const allDisabled = new Set(GEN_VIDEO_MODELS as readonly string[]);
    expect(() => suggestModel({ kind: "video", disabled: allDisabled })).not.toThrow();
    const r = suggestModel({ kind: "video", disabled: allDisabled });
    expect((GEN_VIDEO_MODELS as readonly string[]).includes(r.model)).toBe(true); // still a typed model (spend gate rejects)
  });
});
