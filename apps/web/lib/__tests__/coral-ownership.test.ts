import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");

function sourceFiles(relativeRoot: string) {
  const root = path.join(WEB_ROOT, relativeRoot);
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return {
        file: path.relative(WEB_ROOT, file),
        source: readFileSync(file, "utf8"),
      };
    });
}

describe("coral ownership", () => {
  it("names coral component variants after Otto instead of generic emphasis", () => {
    const button = readFileSync(path.join(WEB_ROOT, "components/ui/button.tsx"), "utf8");
    const badge = readFileSync(path.join(WEB_ROOT, "components/ui/badge.tsx"), "utf8");
    const bubble = readFileSync(path.join(WEB_ROOT, "components/ui/bubble.tsx"), "utf8");
    const card = readFileSync(path.join(WEB_ROOT, "components/ui/card.tsx"), "utf8");
    const message = readFileSync(path.join(WEB_ROOT, "components/ui/message.tsx"), "utf8");

    expect(button).toContain('otto: "bg-brand');
    expect(button).toContain('"otto-soft": "bg-brand-soft');
    expect(badge).toContain('otto: "border-transparent bg-brand');
    expect(badge).toContain('"otto-soft": "border-transparent bg-brand-soft');
    expect(bubble).toContain('otto:');
    expect(bubble).toContain('bg-brand-soft');
    expect(card).toContain('tone?: "default" | "otto"');
    expect(message).toContain('tone?: "default" | "otto"');

    for (const { file, source } of [
      ...sourceFiles("app"),
      ...sourceFiles("components"),
    ]) {
      expect(source, file).not.toMatch(/variant="(?:brand|soft)"/);
      expect(source, file).not.toMatch(/tone="brand"/);
    }
  });

  it("keeps raw coral utilities inside Fikirtive, Otto, and design-system ownership surfaces", () => {
    const allowed = [
      "app/design-system/DesignSystemReference.tsx",
      "components/auth/AuthPageShell.tsx",
      "components/admin/AdminDashboardV2.tsx",
      "components/admin/AdminV2Nav.tsx",
      "components/otto/",
      "components/ui/badge.tsx",
      "components/ui/bubble.tsx",
      "components/ui/button.tsx",
      "components/ui/card.tsx",
      "components/ui/message.tsx",
    ];
    const coralUtility = /(?:bg|text|border|ring)-brand(?:-|\/|\b)|accent-\[var\(--brand\)\]|var\(--brand\)/;

    for (const { file, source } of [
      ...sourceFiles("app"),
      ...sourceFiles("components"),
    ]) {
      if (!coralUtility.test(source)) continue;
      expect(allowed.some((entry) => file === entry || file.startsWith(entry)), file).toBe(true);
    }
  });

  it("uses semantic status and ink interaction language throughout CRM", () => {
    for (const { file, source } of sourceFiles("components/crm")) {
      expect(source, file).not.toMatch(/variant="otto(?:-soft)?"/);
      expect(source, file).not.toMatch(/tone="otto"/);
      expect(source, file).not.toMatch(/(?:bg|text|border|ring)-brand(?:-|\/|\b)/);
      expect(source, file).not.toContain("accent-[var(--brand)]");
    }

    const workflows = readFileSync(
      path.join(WEB_ROOT, "components/crm/workflows/workflow-list-page.tsx"),
      "utf8",
    );
    const monitoring = readFileSync(
      path.join(WEB_ROOT, "components/crm/workflows/workflow-monitoring.tsx"),
      "utf8",
    );
    expect(workflows).toContain('<Badge variant="success">');
    expect(monitoring).toContain('<Badge variant="info">Simulation only</Badge>');
  });
});
