import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const REFERENCE = fs.readFileSync(
  path.join(WEB_ROOT, "app/product-patterns/application-shell/ApplicationShellReference.tsx"),
  "utf8",
);

describe("Application shell Founder checkpoint", () => {
  it("renders the formal shell and Otto panel instead of a duplicate showcase implementation", () => {
    expect(REFERENCE).toContain('from "@/components/global-navigation"');
    expect(REFERENCE).toContain('from "@/components/otto/panel/OttoPanelShell"');
    expect(REFERENCE).toContain("<MerchantShellFrame");
    expect(REFERENCE).toContain("<OttoPanelShell");
  });

  it("takes every destination from the canonical navigation source", () => {
    expect(REFERENCE).toContain('from "@fikirtive/core/navigation"');
    expect(REFERENCE.match(/href=["']\//g) ?? []).toEqual([]);
  });

  it("preserves link semantics while taking styles from the canonical Button primitive", () => {
    expect(REFERENCE).toContain('import { buttonVariants } from "@/components/ui/button"');
    expect(REFERENCE.match(/<Link href=\{SHELL_ROUTES\./g)).toHaveLength(3);
  });

  it("labels the fixture and does not pretend it is live merchant data", () => {
    expect(REFERENCE).toContain("Application shell checkpoint");
    expect(REFERENCE).toContain("This fixture is only here to review");
    expect(REFERENCE).toContain("Preview only. No session was changed.");
  });
});
