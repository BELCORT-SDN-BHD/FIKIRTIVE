import { describe, it, expect, afterEach } from "vitest";
import { createGenerationProvider } from "./index.js";

describe("createGenerationProvider factory", () => {
  afterEach(() => {
    delete process.env.GENERATION_PROVIDER;
    delete process.env.BYTEPLUS_API_KEY;
  });

  it("GENERATION_PROVIDER=byteplus → BytePlusProvider", () => {
    process.env.GENERATION_PROVIDER = "byteplus";
    process.env.BYTEPLUS_API_KEY = "ark-x";
    expect(createGenerationProvider().name).toBe("byteplus");
  });

  it("byteplus without a key throws", () => {
    process.env.GENERATION_PROVIDER = "byteplus";
    delete process.env.BYTEPLUS_API_KEY;
    expect(() => createGenerationProvider()).toThrow(/BYTEPLUS_API_KEY/);
  });

  it("unset → mock", () => {
    expect(createGenerationProvider().name).toBe("mock");
  });
});
