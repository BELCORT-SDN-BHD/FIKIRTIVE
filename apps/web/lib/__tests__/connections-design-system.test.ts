import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  new URL("../../components/otto/OttoConnections.tsx", import.meta.url),
  "utf8",
);
const loading = readFileSync(
  new URL("../../app/settings/connections/loading.tsx", import.meta.url),
  "utf8",
);

describe("Connections design-system composition", () => {
  it("uses shadcn primitives for hierarchy, status, data and confirmation", () => {
    for (const primitive of [
      "Alert",
      "AlertDialog",
      "Badge",
      "Button",
      "Card",
      "Separator",
      "Skeleton",
      "Spinner",
      "Table",
      "ToggleGroup",
    ]) {
      expect(component, `${primitive} is missing`).toContain(primitive);
    }
    expect(component).toContain("<AlertDialogTitle>Disconnect Meta?</AlertDialogTitle>");
  });

  it("keeps human connection actions neutral and reserves coral for Otto identity", () => {
    expect(component).not.toContain('variant="otto"');
    expect(component).toContain('variant="otto-soft"');
    expect(component).toContain("Otto control");
  });

  it("uses the icon library and removes the old one-off styling language", () => {
    expect(component).not.toContain("<svg");
    expect(component).not.toContain("style={{");
    expect(component).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("keeps the route skeleton aligned with the final two-column layout", () => {
    expect(loading).toContain('from "@/components/ui/card"');
    expect(loading).toContain("max-w-6xl");
    expect(loading).toContain("lg:grid-cols-");
    expect(loading).not.toContain("style={{");
  });
});
