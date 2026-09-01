import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schedule = readFileSync(
  new URL("../../components/otto/OttoSchedule.tsx", import.meta.url),
  "utf8",
);
const loading = readFileSync(
  new URL("../../app/schedule/loading.tsx", import.meta.url),
  "utf8",
);

describe("Schedule design-system composition", () => {
  it("uses shared shadcn primitives for status, planning, choices and forms", () => {
    for (const primitive of [
      "Alert",
      "Badge",
      "Button",
      "Card",
      "Empty",
      "FieldGroup",
      "NativeSelect",
      "ToggleGroup",
    ]) {
      expect(schedule, `${primitive} is missing`).toContain(primitive);
    }
    expect(schedule).toMatch(/<SelectGroup>[\s\S]*<SelectItem/);
  });

  it("uses the shared Otto identity and removes local form and avatar copies", () => {
    expect(schedule).toContain("<OttoAvatar");
    expect(schedule).not.toContain("function CoralCloud");
    expect(schedule).not.toMatch(/function Field\(/);
  });

  it("keeps Otto proposals and the real queue visible side by side on desktop", () => {
    expect(schedule).toContain("lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]");
    expect(schedule).toContain('<section aria-label="Otto plan">');
    expect(schedule).toContain("Up next");
  });

  it("keeps the route skeleton aligned with the final layout", () => {
    expect(loading).toContain("max-w-[1280px]");
    expect(loading).toContain("lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]");
    expect(loading).not.toContain("animate-pulse");
  });
});
