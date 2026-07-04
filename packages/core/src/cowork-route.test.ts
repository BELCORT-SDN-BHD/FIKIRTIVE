import { describe, expect, it } from "vitest";
import { suggestModel } from "./cowork-route.js";
import { GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_OPTIONS, GEN_VIDEO_MODEL_INFO, type GenVideoModel } from "./gen.js";
import { activeVideoModel } from "./model-config.js";

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
  it("always returns the active video model regardless of hasTail (locked model; tail capability is an accepted tradeoff)", () => {
    // Before: suggestModel would pick a tail-capable model when hasTail=true.
    // Now: model selection is locked to activeVideoModel() (seedance-2-fast by default;
    // 2026-07-04: only flat margin-floored models are honored) by product decision — the
    // spend gate only allows the active model. hasTail is accepted but does not reroute
    // to a different model; params are still clamped to the active model's options.
    const r = suggestModel({ kind: "video", hasTail: true });
    expect(r.model).toBe(activeVideoModel());
    expect((GEN_VIDEO_MODELS as readonly string[]).includes(r.model)).toBe(true);
  });
  it("an aspect NO model can honor (t2v) flags downgraded and never fabricates the impossible aspect (fallback path)", () => {
    const r = suggestModel({ kind: "video", desiredAspect: "21:9" }); // no model exposes 21:9 → empty pool → full-list fallback
    expect(r.downgraded).toBe(true);
    expect(r.params.aspectRatio).not.toBe("21:9");
  });
  it("disabled set does not change the model (locked to activeVideoModel; disabled is a no-op for selection)", () => {
    // Before: disabled narrowed the candidate pool and forced a different pick.
    // Now: model selection is locked to activeVideoModel() regardless. The disabled
    // param is accepted on the interface (kept for future/upstream callers) but has
    // no effect on which model is proposed — the spend gate enforces the single model.
    const free = suggestModel({ kind: "video" });
    const withDisabled = suggestModel({ kind: "video", disabled: new Set([free.model]) });
    expect(free.model).toBe(activeVideoModel());
    expect(withDisabled.model).toBe(activeVideoModel()); // still the active model
    expect((GEN_VIDEO_MODELS as readonly string[]).includes(withDisabled.model)).toBe(true);
  });
  it("impossible aspect (21:9) still returns activeVideoModel (locked) and is a valid typed model", () => {
    // Before: 21:9 → empty pool → fallback logic; disabled narrowed the fallback further.
    // Now: model is always activeVideoModel() regardless of aspect/disabled. The impossible
    // aspect is still flagged as downgraded (params snapping below), but the model id is stable.
    const r = suggestModel({ kind: "video", desiredAspect: "21:9", disabled: new Set([activeVideoModel()]) });
    expect(r.model).toBe(activeVideoModel()); // locked regardless of disabled
    expect((GEN_VIDEO_MODELS as readonly string[]).includes(r.model)).toBe(true);
    expect(r.downgraded).toBe(true); // 21:9 is not in veo3.1-lite's aspectRatios → snapped
  });
  it("disabling the natural pick still returns it (locked model; disabled is inert for selection)", () => {
    // Before: disabling the natural pick forced a different model.
    // Now: model is always activeVideoModel(). This test documents that the disabled
    // param is intentionally a no-op — enforced at the spend gate, not here.
    const natural = suggestModel({ kind: "video" });
    const narrowed = suggestModel({ kind: "video", disabled: new Set([natural.model]) });
    expect(natural.model).toBe(activeVideoModel());
    expect(narrowed.model).toBe(activeVideoModel()); // same model despite disabled
    expect((GEN_VIDEO_MODELS as readonly string[]).includes(narrowed.model)).toBe(true);
  });
  it("only the degenerate all-disabled case falls back to the full typed menu (returns a value, blocked downstream)", () => {
    const allDisabled = new Set(GEN_VIDEO_MODELS as readonly string[]);
    expect(() => suggestModel({ kind: "video", disabled: allDisabled })).not.toThrow();
    const r = suggestModel({ kind: "video", disabled: allDisabled });
    expect((GEN_VIDEO_MODELS as readonly string[]).includes(r.model)).toBe(true); // still a typed model (spend gate rejects)
  });
});
