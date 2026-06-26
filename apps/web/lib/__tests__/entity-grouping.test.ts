import { describe, it, expect } from "vitest";
import { groupEntitiesByType } from "../entity-grouping";
import type { EntityDTO } from "@/lib/types";

function makeEntity(overrides: Partial<EntityDTO> & Pick<EntityDTO, "id" | "type" | "name">): EntityDTO {
  return {
    aliases: [],
    notes: "",
    negativeConstraints: "",
    refs: [],
    baseAssetId: null,
    variants: [],
    usageCount: 0,
    ...overrides,
  };
}

const PRODUCT_A = makeEntity({ id: "p1", type: "PRODUCT", name: "Widget" });
const PRODUCT_B = makeEntity({ id: "p2", type: "PRODUCT", name: "Gadget" });
const CHAR_A = makeEntity({ id: "c1", type: "CHARACTER", name: "Alice" });
const LOC_A = makeEntity({ id: "l1", type: "LOCATION", name: "New York" });
const BRAND_A = makeEntity({ id: "b1", type: "BRANDMARK", name: "LogoMark" });

describe("groupEntitiesByType", () => {
  it("groups into the fixed order: Products → Characters → Locations → Brand marks", () => {
    const entities = [CHAR_A, BRAND_A, LOC_A, PRODUCT_A];
    const groups = groupEntitiesByType(entities, "");
    expect(groups.map((g) => g.type)).toEqual(["PRODUCT", "CHARACTER", "LOCATION", "BRANDMARK"]);
  });

  it("uses the correct human-readable labels", () => {
    const groups = groupEntitiesByType([PRODUCT_A, CHAR_A, LOC_A, BRAND_A], "");
    const labelMap = Object.fromEntries(groups.map((g) => [g.type, g.label]));
    expect(labelMap["PRODUCT"]).toBe("Products");
    expect(labelMap["CHARACTER"]).toBe("Characters");
    expect(labelMap["LOCATION"]).toBe("Locations");
    expect(labelMap["BRANDMARK"]).toBe("Brand marks");
  });

  it("omits empty groups", () => {
    const entities = [CHAR_A, LOC_A]; // no PRODUCT or BRANDMARK
    const groups = groupEntitiesByType(entities, "");
    expect(groups.map((g) => g.type)).toEqual(["CHARACTER", "LOCATION"]);
  });

  it("returns all entities (grouped) when query is empty string", () => {
    const entities = [PRODUCT_A, PRODUCT_B, CHAR_A];
    const groups = groupEntitiesByType(entities, "");
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(3);
  });

  it("filters by case-insensitive name substring", () => {
    const entities = [PRODUCT_A, PRODUCT_B, CHAR_A]; // Widget, Gadget, Alice
    const groups = groupEntitiesByType(entities, "get");
    // "Widget" contains "get" (wid-GET), "Gadget" contains "get" (gad-GET), "Alice" does not
    expect(groups.map((g) => g.type)).toEqual(["PRODUCT"]);
    expect(groups[0].items.map((e) => e.name)).toEqual(expect.arrayContaining(["Widget", "Gadget"]));
    expect(groups[0].items).toHaveLength(2);
  });

  it("is case-insensitive in both directions", () => {
    const groups = groupEntitiesByType([CHAR_A], "ALICE");
    expect(groups).toHaveLength(1);
    expect(groups[0].items[0].name).toBe("Alice");
  });

  it("returns no groups when no entity matches the query", () => {
    const groups = groupEntitiesByType([PRODUCT_A, CHAR_A], "zzz");
    expect(groups).toHaveLength(0);
  });

  it("places multiple items of the same type in one group", () => {
    const groups = groupEntitiesByType([PRODUCT_A, PRODUCT_B], "");
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });

  it("does not throw and excludes entity with empty-string name when query is non-empty", () => {
    const emptyName = makeEntity({ id: "e1", type: "PRODUCT", name: "" });
    expect(() => groupEntitiesByType([emptyName, PRODUCT_A], "widget")).not.toThrow();
    const groups = groupEntitiesByType([emptyName, PRODUCT_A], "widget");
    // "Widget" matches, empty-name does not
    expect(groups[0].items.map((e) => e.name)).toEqual(["Widget"]);
  });

  it("does not throw when an entity has a null or undefined name", () => {
    const nullName = makeEntity({ id: "n1", type: "PRODUCT", name: null as unknown as string });
    const undefName = makeEntity({ id: "n2", type: "PRODUCT", name: undefined as unknown as string });
    expect(() => groupEntitiesByType([nullName, undefName, PRODUCT_A], "widget")).not.toThrow();
    // null/undefined names should not match "widget"
    const groups = groupEntitiesByType([nullName, undefName, PRODUCT_A], "widget");
    expect(groups[0].items.map((e) => e.name)).toEqual(["Widget"]);
  });
});
