import { describe, it, expect } from "vitest";
import { clampVisionInts, createTransportFromConfig, mergeVisionConfig } from "./runtime-config.js";
import { runtimeConfigInput } from "./cowork.js";

describe("clampVisionInts", () => {
  it("clamps finite ints to [1,max], else default", () => {
    expect(clampVisionInts({ maxImages: 5, maxBytes: 1_000_000 })).toEqual({ maxImages: 5, maxBytes: 1_000_000 });
    expect(clampVisionInts({ maxImages: 99, maxBytes: 99_000_000 })).toEqual({ maxImages: 8, maxBytes: 16_000_000 });
    expect(clampVisionInts({ maxImages: 0, maxBytes: -1 })).toEqual({ maxImages: 3, maxBytes: 4_000_000 });
    expect(clampVisionInts({ maxImages: Infinity, maxBytes: NaN })).toEqual({ maxImages: 3, maxBytes: 4_000_000 });
  });
});

describe("createTransportFromConfig", () => {
  it("defaults to mock for unset/unknown provider", () => {
    expect(createTransportFromConfig({ provider: undefined }).name).toBe("mock");
    expect(createTransportFromConfig({ provider: "weird" }).name).toBe("mock");
  });
  it("builds fal transport when provider=fal + key present", () => {
    expect(createTransportFromConfig({ provider: "fal", falKey: "k" }).name).toBe("fal:llm");
  });
  it("THROWS for a set provider with a missing credential (loud, never silent-mock)", () => {
    expect(() => createTransportFromConfig({ provider: "fal" })).toThrow(/FAL_KEY/);
    expect(() => createTransportFromConfig({ provider: "modal", modalEndpoint: "x" })).toThrow(/MODAL_LLM/);
  });
});

const ENV_ON = { enabled: true, policy: "C", maxImages: 3, maxBytes: 4_000_000 } as const;
const ENV_OFF = { enabled: false, policy: "C", maxImages: 3, maxBytes: 4_000_000 } as const;

describe("mergeVisionConfig", () => {
  it("empty DB row → env default (DEFAULT-ON preserved)", () => {
    expect(mergeVisionConfig(ENV_ON, null)).toEqual(ENV_ON);
  });
  it("DB caps override env, clamped", () => {
    expect(mergeVisionConfig(ENV_ON, { maxImages: 6 }).maxImages).toBe(6);
    expect(mergeVisionConfig(ENV_ON, { maxImages: 9999 }).maxImages).toBe(8); // clamp ceiling
  });
  it("env kill-switch is a HARD override the DB cannot flip back on", () => {
    expect(mergeVisionConfig(ENV_OFF, { enabled: true }).enabled).toBe(false);
  });
  it("DB can disable even when env is on", () => {
    expect(mergeVisionConfig(ENV_ON, { enabled: false }).enabled).toBe(false);
  });
});

describe("runtimeConfigInput", () => {
  it("accepts a valid vision value", () => {
    expect(runtimeConfigInput.safeParse({ key: "vision", value: { maxImages: 5 } }).success).toBe(true);
  });
  it("accepts cowork_provider=fal", () => {
    expect(runtimeConfigInput.safeParse({ key: "cowork_provider", value: { provider: "fal" } }).success).toBe(true);
  });
  it("accepts cowork_provider=modal (P1b unlocks modal — super-admin-gated in saveRuntimeConfig)", () => {
    expect(runtimeConfigInput.safeParse({ key: "cowork_provider", value: { provider: "modal" } }).success).toBe(true);
  });
  it("REJECTS vision maxImages above the ceiling (>8)", () => {
    expect(runtimeConfigInput.safeParse({ key: "vision", value: { maxImages: 99 } }).success).toBe(false);
  });
});
