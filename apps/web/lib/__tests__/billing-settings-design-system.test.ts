import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");

function source(file: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, file), "utf8");
}

describe("Billing and Settings use the shared design system", () => {
  it("composes Billing from shadcn cards, alerts, empty states, and buttons", () => {
    const page = source("app/billing/page.tsx");
    const button = source("components/billing/BuyPackButton.tsx");

    expect(page).toMatch(/CardHeader|CardContent|CardFooter/);
    expect(page).toMatch(/<Alert|<Empty/);
    expect(button).toMatch(/<Button|<Spinner|<Alert/);
    expect(page).not.toContain("style={{");
    expect(button).not.toContain("style={{");
  });

  it("renders spend history as the shared table instead of custom row cards", () => {
    const history = source("components/billing/SpendHistory.tsx");

    expect(history).toMatch(/TableHeader|TableBody|TableRow|TableCell/);
    expect(history).toMatch(/<Empty/);
    expect(history).not.toContain("style={{");
  });

  it("composes Settings from Card, Field, Separator, and semantic status components", () => {
    const page = source("components/otto/settings/SettingsPage.tsx");
    const sections = source("components/otto/settings/sections.tsx");

    expect(page).toMatch(/CardHeader|CardContent|FieldGroup|FieldError|Separator/);
    expect(sections).toMatch(/Badge|Button|Table/);
    expect(`${page}\n${sections}`).not.toMatch(/cv-set-|style=\{\{/);
  });

  it("keeps every theme option inside SelectGroup", () => {
    const toggle = source("components/theme-toggle.tsx");

    expect(toggle).toMatch(/<SelectGroup>[\s\S]*<SelectItem/);
  });
});
