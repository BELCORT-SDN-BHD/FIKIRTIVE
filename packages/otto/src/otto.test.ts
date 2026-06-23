import { describe, it, expect } from "vitest";
import { otto, ottoInstructions } from "./otto.js";

describe("otto agent", () => {
  it("is defined", () => {
    expect(otto).toBeDefined();
  });

  it("has name Otto", () => {
    expect(otto.name).toBe("Otto");
  });

  it("instructions contain identity text", () => {
    expect(ottoInstructions).toMatch(/You are Otto/);
  });
});
