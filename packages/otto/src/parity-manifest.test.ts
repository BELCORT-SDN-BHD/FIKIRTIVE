import { describe, it, expect } from "vitest";
import { PARITY_MANIFEST, type ParityEntry } from "./parity-manifest.js";
import { allSkills } from "./registry.js";

// The 9th seam's core invariant (harmony-02 §二.2): every skill a manifest entry points at must
// really exist in the registry, and every exemption must use one of the four closed classes. This
// is the load-bearing subset of the future check-parity.sh — kept as a unit test until that lands.
// `as const` narrows the literal, so widen back to the ParityEntry union to exercise both branches.
const entries = Object.entries(PARITY_MANIFEST) as [string, ParityEntry][];

describe("parity manifest", () => {
  const skillNames = new Set(allSkills.map((s) => s.name));

  it("every paired action references a real registered skill", () => {
    for (const [action, entry] of entries) {
      if ("skill" in entry) {
        expect(skillNames.has(entry.skill), `${action} → unknown skill "${entry.skill}"`).toBe(true);
      }
    }
  });

  it("every exemption uses one of the four closed classes with a non-empty reason", () => {
    const CLASSES = new Set(["ADMIN", "VISUAL", "MONEY_IN", "ACCOUNT_SECURITY"]);
    for (const [action, entry] of entries) {
      if ("exempt" in entry) {
        expect(CLASSES.has(entry.exempt), `${action} → invalid exempt class "${entry.exempt}"`).toBe(true);
        expect(entry.reason.trim().length, `${action} → exemption needs a reason`).toBeGreaterThan(0);
      }
    }
  });
});
