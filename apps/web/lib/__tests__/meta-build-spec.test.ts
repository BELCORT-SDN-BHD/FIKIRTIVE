import { describe, it, expect } from "vitest";
import {
  isSupportedObjective,
  shapeTargeting,
  isValidHttpUrl,
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
