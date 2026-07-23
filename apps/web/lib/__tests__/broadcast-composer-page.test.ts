import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve(__dirname, "../../components/crm/broadcasts/broadcast-composer-page.tsx"),
  "utf8",
);

describe("broadcast composer template-derived purpose", () => {
  it("has no editable or submitted client purpose", () => {
    expect(source).not.toContain("const PURPOSES");
    expect(source).not.toContain("setPurpose");
    const createInput = source.match(/await createBroadcastRun\(\{([\s\S]*?)\n\s*\}\);/)?.[1];
    expect(createInput).toBeDefined();
    expect(createInput).not.toMatch(/\bpurpose\s*:/);
  });

  it("requires a selected mapped template and displays its server-derived purpose read-only", () => {
    expect(source).toContain("selectedTemplate?.broadcastPurpose");
    expect(source).toContain("segmentId && selectedPurpose");
    expect(source).toContain("Purpose comes from the template");
    expect(source).not.toContain("No template");
    expect(source).not.toMatch(/<select[^>]*value=\{purpose\}/);
  });
});
