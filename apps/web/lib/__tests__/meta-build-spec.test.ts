import { describe, it, expect } from "vitest";
import {
  isSupportedObjective,
  shapeTargeting,
  isValidHttpUrl,
  buildAdBuildCard,
  type AdBuildInput,
} from "../meta-build-spec";

describe("isSupportedObjective", () => {
  it("returns true for the 4 supported objectives", () => {
    expect(isSupportedObjective("OUTCOME_TRAFFIC")).toBe(true);
    expect(isSupportedObjective("OUTCOME_ENGAGEMENT")).toBe(true);
    expect(isSupportedObjective("OUTCOME_LEADS")).toBe(true);
    expect(isSupportedObjective("OUTCOME_SALES")).toBe(true);
  });
  it("returns false for unsupported objectives", () => {
    expect(isSupportedObjective("OUTCOME_AWARENESS")).toBe(false);
    expect(isSupportedObjective("junk")).toBe(false);
    expect(isSupportedObjective("")).toBe(false);
  });
});

describe("shapeTargeting", () => {
  it("maps countries, ageMin, ageMax to valid Meta spec", () => {
    expect(
      shapeTargeting({ countries: ["MY"], ageMin: 25, ageMax: 44 })
    ).toEqual({
      geo_locations: { countries: ["MY"] },
      age_min: 25,
      age_max: 44,
    });
  });
  it("undefined hint → broad MY default", () => {
    expect(shapeTargeting(undefined)).toEqual({
      geo_locations: { countries: ["MY"] },
    });
  });
  it("empty hint → broad MY default", () => {
    expect(shapeTargeting({})).toEqual({
      geo_locations: { countries: ["MY"] },
    });
  });
  it("interests → flexible_spec", () => {
    const result = shapeTargeting({ interests: ["photography"] });
    expect(result).toMatchObject({
      geo_locations: { countries: ["MY"] },
      flexible_spec: [{ interests: ["photography"] }],
    });
  });
  it("cities → geo_locations.cities + default country MY when no countries given", () => {
    const result = shapeTargeting({ cities: ["KL"] });
    expect(result).toMatchObject({
      geo_locations: { countries: ["MY"], cities: ["KL"] },
    });
  });
  it("cities + explicit country", () => {
    const result = shapeTargeting({ countries: ["SG"], cities: ["SG City"] });
    expect(result).toMatchObject({
      geo_locations: { countries: ["SG"], cities: ["SG City"] },
    });
  });
});

describe("isValidHttpUrl", () => {
  it("returns true for https:// URLs", () => {
    expect(isValidHttpUrl("https://kaia.com/x")).toBe(true);
    expect(isValidHttpUrl("https://example.com")).toBe(true);
  });
  it("returns true for http:// URLs", () => {
    expect(isValidHttpUrl("http://example.com/path?q=1")).toBe(true);
  });
  it("returns false for non-URLs", () => {
    expect(isValidHttpUrl("")).toBe(false);
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("ftp://example.com")).toBe(false);
    expect(isValidHttpUrl("not-a-url")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildAdBuildCard
// ---------------------------------------------------------------------------

const VALID_INPUT: AdBuildInput = {
  goal: "Drive traffic to landing page",
  reasoning: "Audience is active on Instagram",
  mode: "create",
  objective: "OUTCOME_TRAFFIC",
  pageId: "page-123",
  targetingHint: { countries: ["MY"], ageMin: 25, ageMax: 44 },
  dailyBudgetMinor: 5000,
  creative: {
    assetId: "asset-abc",
    kind: "image",
    message: "Check out our new product",
    headline: "New Product Launch",
    cta: "LEARN_MORE",
    link: "https://example.com/landing",
  },
};

const VALID_CTX = {
  accountId: "act_999",
  assetExists: true,
  assetKind: "image" as const,
  pageValid: true,
  adsetValid: false,
};

const NOW_ISO = "2026-06-29T10:00:00.000Z";
const ACTOR = "user:test@example.com";

describe("buildAdBuildCard", () => {
  it("valid create input → correct payload shape", () => {
    const payload = buildAdBuildCard(VALID_INPUT, VALID_CTX, ACTOR, NOW_ISO);

    expect(payload.mode).toBe("create");
    expect(payload.goal).toBe(VALID_INPUT.goal);
    expect(payload.reasoning).toBe(VALID_INPUT.reasoning);
    expect(payload.objective).toBe("OUTCOME_TRAFFIC");
    expect(payload.accountId).toBe("act_999");
    expect(payload.pageId).toBe("page-123");
    expect(payload.dailyBudgetMinor).toBe(5000);
    expect(payload.creative.assetId).toBe("asset-abc");
    expect(payload.creative.kind).toBe("image");
    expect(payload.creative.link).toBe("https://example.com/landing");
    expect(payload.buildOutcome).toBeUndefined();
  });

  it("targeting is server-shaped (not raw hint)", () => {
    const payload = buildAdBuildCard(VALID_INPUT, VALID_CTX, ACTOR, NOW_ISO);
    expect(payload.targeting).toEqual({
      geo_locations: { countries: ["MY"] },
      age_min: 25,
      age_max: 44,
    });
  });

  it("approval.paramHash is truthy", () => {
    const payload = buildAdBuildCard(VALID_INPUT, VALID_CTX, ACTOR, NOW_ISO);
    expect(payload.approval.paramHash).toBeTruthy();
    expect(typeof payload.approval.paramHash).toBe("string");
    expect(payload.approval.paramHash.length).toBeGreaterThan(0);
  });

  it("approval is bound to actor and expires 10 min after nowIso", () => {
    const payload = buildAdBuildCard(VALID_INPUT, VALID_CTX, ACTOR, NOW_ISO);
    expect(payload.approval.boundActor).toBe(ACTOR);
    const expectedExpiry = new Date(Date.parse(NOW_ISO) + 10 * 60 * 1000).toISOString();
    expect(payload.approval.expiresAt).toBe(expectedExpiry);
  });

  it("throws on unsupported objective", () => {
    const input = { ...VALID_INPUT, objective: "OUTCOME_AWARENESS" };
    expect(() => buildAdBuildCard(input, VALID_CTX, ACTOR, NOW_ISO)).toThrow(
      /unsupported objective/i
    );
  });

  it("throws on invalid link (not http/https)", () => {
    const input = {
      ...VALID_INPUT,
      creative: { ...VALID_INPUT.creative, link: "ftp://example.com" },
    };
    expect(() => buildAdBuildCard(input, VALID_CTX, ACTOR, NOW_ISO)).toThrow(
      /invalid link/i
    );
  });

  it("throws when dailyBudgetMinor is 0", () => {
    const input = { ...VALID_INPUT, dailyBudgetMinor: 0 };
    expect(() => buildAdBuildCard(input, VALID_CTX, ACTOR, NOW_ISO)).toThrow(
      /invalid budget/i
    );
  });

  it("throws when dailyBudgetMinor is negative", () => {
    const input = { ...VALID_INPUT, dailyBudgetMinor: -100 };
    expect(() => buildAdBuildCard(input, VALID_CTX, ACTOR, NOW_ISO)).toThrow(
      /invalid budget/i
    );
  });

  it("throws when asset does not exist", () => {
    const ctx = { ...VALID_CTX, assetExists: false };
    expect(() => buildAdBuildCard(VALID_INPUT, ctx, ACTOR, NOW_ISO)).toThrow(
      /unknown asset/i
    );
  });

  it("throws on asset kind mismatch", () => {
    const ctx = { ...VALID_CTX, assetKind: "video" as const };
    expect(() => buildAdBuildCard(VALID_INPUT, ctx, ACTOR, NOW_ISO)).toThrow(
      /asset kind mismatch/i
    );
  });

  it("throws when page is invalid", () => {
    const ctx = { ...VALID_CTX, pageValid: false };
    expect(() => buildAdBuildCard(VALID_INPUT, ctx, ACTOR, NOW_ISO)).toThrow(
      /invalid page/i
    );
  });

  it("into_existing with adsetValid:false → throws", () => {
    const input: AdBuildInput = {
      ...VALID_INPUT,
      mode: "into_existing",
      intoExisting: { adsetId: "adset-xyz" },
    };
    const ctx = { ...VALID_CTX, adsetValid: false };
    expect(() => buildAdBuildCard(input, ctx, ACTOR, NOW_ISO)).toThrow(
      /invalid ad set/i
    );
  });

  it("into_existing with adsetValid:true → payload includes intoExisting", () => {
    const input: AdBuildInput = {
      ...VALID_INPUT,
      mode: "into_existing",
      intoExisting: { adsetId: "adset-xyz" },
    };
    const ctx = { ...VALID_CTX, adsetValid: true };
    const payload = buildAdBuildCard(input, ctx, ACTOR, NOW_ISO);
    expect(payload.mode).toBe("into_existing");
    expect(payload.intoExisting?.adsetId).toBe("adset-xyz");
  });

  it("into_existing without intoExisting.adsetId throws, regardless of adsetValid", () => {
    const input: AdBuildInput = {
      ...VALID_INPUT,
      mode: "into_existing",
      intoExisting: {},
    };
    const ctx = { ...VALID_CTX, adsetValid: true };
    expect(() => buildAdBuildCard(input, ctx, ACTOR, NOW_ISO)).toThrow(
      /into_existing requires intoExisting\.adsetId/i
    );
  });

  it("into_existing without intoExisting object throws", () => {
    const input: AdBuildInput = {
      ...VALID_INPUT,
      mode: "into_existing",
    };
    const ctx = { ...VALID_CTX, adsetValid: true };
    expect(() => buildAdBuildCard(input, ctx, ACTOR, NOW_ISO)).toThrow(
      /into_existing requires intoExisting\.adsetId/i
    );
  });
});
