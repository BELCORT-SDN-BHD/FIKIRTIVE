import { describe, it, expect } from "vitest";
import { renderCatalog } from "./catalog.js";
import { skillCatalog } from "./registry.js";

describe("renderCatalog", () => {
  it("emits one table row per skill, sorted by name, with a gate column", () => {
    const md = renderCatalog(skillCatalog);
    expect(md).toContain("| generate | spend | write | internal | ✅ |");
    expect(md).toContain("| setTitle | free | write | internal | ❌ |");
    // rows are sorted: describeRefs before setTitle
    expect(md.indexOf("| describeRefs |")).toBeLessThan(md.indexOf("| setTitle |"));
  });
});
