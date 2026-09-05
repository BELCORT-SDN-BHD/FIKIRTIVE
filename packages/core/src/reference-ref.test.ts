import { describe, it, expect } from "vitest";
import {
  CONTRACT_REFERENCE_TYPES,
  REFERENCE_TYPES,
  ENTITY_REFERENCE_TYPES,
  dedupeReferenceRefs,
  formatReferenceRef,
  isEntityReferenceType,
  isReferenceType,
  parseReferenceRef,
  parseReferenceRefs,
} from "./reference-ref.js";

describe("FRONT-A10 typed reference ids", () => {
  it("FRONT-A10 carries exactly the seven types the frozen contract names, plus the production-only brandmark", () => {
    // The list the Founder-approved fixture renders
    // (apps/web/design-system/patterns/reference-picker/model.ts). Copied here as a literal on
    // purpose: packages/core must not import from apps/web, so the only way the two can drift is
    // a change that does NOT update this line — which is what makes the assertion worth having.
    expect([...CONTRACT_REFERENCE_TYPES]).toEqual([
      "product",
      "character",
      "official-avatar",
      "location",
      "clothes",
      "generation",
      "upload",
    ]);
    expect([...REFERENCE_TYPES]).toEqual([...CONTRACT_REFERENCE_TYPES, "brandmark"]);
  });

  it("FRONT-A10 separates the entity-backed types from the media ones", () => {
    for (const type of ENTITY_REFERENCE_TYPES) expect(isEntityReferenceType(type)).toBe(true);
    expect(isEntityReferenceType("generation")).toBe(false);
    expect(isEntityReferenceType("upload")).toBe(false);
  });

  it("FRONT-A10 round-trips a typed ref through its wire form", () => {
    const ref = { type: "official-avatar" as const, id: "ent_123" };
    expect(formatReferenceRef(ref)).toBe("official-avatar:ent_123");
    expect(parseReferenceRef("official-avatar:ent_123")).toEqual(ref);
  });

  it("FRONT-A10 refuses anything that is not a well-formed typed ref rather than guessing a type", () => {
    expect(parseReferenceRef("ent_123")).toBeNull();
    expect(parseReferenceRef("nonsense:ent_123")).toBeNull();
    expect(parseReferenceRef("product:")).toBeNull();
    expect(parseReferenceRef(":ent_123")).toBeNull();
    expect(isReferenceType("Product")).toBe(false);
  });

  it("FRONT-A10 parses a whole wire list: malformed entries drop, duplicates collapse, order holds", () => {
    expect(
      parseReferenceRefs([
        "product:a",
        "ent_bare",          // no type — never guessed at
        "product:a",         // the same object picked twice is one reference
        "clothes:c",         // a real type production has no record of: still a well-formed ref
        "nonsense:d",
      ]),
    ).toEqual([
      { type: "product", id: "a" },
      { type: "clothes", id: "c" },
    ]);
  });

  it("FRONT-A10 dedupes on type AND id, so two sources sharing an id stay two references", () => {
    const refs = [
      { type: "product" as const, id: "x" },
      { type: "product" as const, id: "x" },
      { type: "upload" as const, id: "x" },
    ];
    expect(dedupeReferenceRefs(refs)).toEqual([
      { type: "product", id: "x" },
      { type: "upload", id: "x" },
    ]);
  });
});
