import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MERCHANT_NAV } from "@fikirtive/core/navigation";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DESIGN_SYSTEM_ROOT = path.join(REPO_ROOT, "apps/web/design-system");

type AuthorityMap = {
  canonicalRoot: string;
  current: Record<string, string>;
  compatibilityAliases: Record<string, string>;
  deliveryAliases: Record<string, string>;
  references: Record<string, string>;
};

const authority = JSON.parse(
  fs.readFileSync(path.join(DESIGN_SYSTEM_ROOT, "authority.json"), "utf8"),
) as AuthorityMap;

type NavigationContract = {
  activeMainNavigationKeys: string[];
  parkedMainNavigationKeys: string[];
  knownRuntimeExtraMainNavigationKeys: string[];
};

const navigationContract = JSON.parse(
  fs.readFileSync(
    path.join(DESIGN_SYSTEM_ROOT, "information-architecture/navigation-contract.json"),
    "utf8",
  ),
) as NavigationContract;

function repoPath(relativePath: string) {
  return path.join(REPO_ROOT, relativePath);
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
    const [red = 0, green = 0, blue = 0] = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [lighter = 0, darker = 0] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("design-system single source of truth", () => {
  it("keeps every current design owner inside the canonical folder", () => {
    expect(authority.canonicalRoot).toBe("apps/web/design-system");

    for (const source of Object.values(authority.current)) {
      expect(source.startsWith("apps/web/design-system/"), source).toBe(true);
      expect(fs.existsSync(repoPath(source)), source).toBe(true);
      expect(source.includes("/references/"), source).toBe(false);
    }
  });

  it("keeps the integration handoff registered and discoverable from project instructions", () => {
    const handoff = "apps/web/design-system/governance/frontend-integration-handoff.md";

    expect(authority.current.frontendIntegrationHandoff).toBe(handoff);
    expect(fs.existsSync(repoPath(handoff))).toBe(true);
    expect(fs.readFileSync(repoPath("AGENTS.md"), "utf8")).toContain(handoff);
    expect(fs.readFileSync(path.join(DESIGN_SYSTEM_ROOT, "README.md"), "utf8")).toContain(
      "governance/frontend-integration-handoff.md",
    );
    expect(fs.readFileSync(path.join(DESIGN_SYSTEM_ROOT, "governance/README.md"), "utf8")).toContain(
      "frontend-integration-handoff.md",
    );

    const baseline = "apps/web/design-system/governance/frontend-baseline-handoff.md";
    expect(authority.current.frontendBaselineHandoff).toBe(baseline);
    expect(fs.existsSync(repoPath(baseline))).toBe(true);
    expect(fs.readFileSync(repoPath(handoff), "utf8")).toContain("frontend-baseline-handoff.md");
    expect(fs.readFileSync(path.join(DESIGN_SYSTEM_ROOT, "README.md"), "utf8")).toContain(
      "governance/frontend-baseline-handoff.md",
    );
  });

  it("registers the frozen Founder-facing information architecture", () => {
    expect(authority.current.informationArchitecture).toBe(
      "apps/web/design-system/information-architecture",
    );

    for (const file of ["product-map.md", "surface-contract.md", "core-flows.md"]) {
      const source = fs.readFileSync(
        path.join(DESIGN_SYSTEM_ROOT, "information-architecture", file),
        "utf8",
      );
      expect(source, file).toContain("Founder approved and frozen");
    }
  });

  it("allows only the explicitly recorded runtime navigation drift", () => {
    const runtimeMainKeys = MERCHANT_NAV.map((node) => node.key);
    const knownExtras = new Set(navigationContract.knownRuntimeExtraMainNavigationKeys);
    const runtimeActiveKeys = runtimeMainKeys.filter((key) => !knownExtras.has(key));
    const runtimeExtraKeys = runtimeMainKeys.filter(
      (key) => !navigationContract.activeMainNavigationKeys.includes(key),
    );

    expect(runtimeActiveKeys).toEqual(navigationContract.activeMainNavigationKeys);
    expect(runtimeExtraKeys).toEqual(navigationContract.knownRuntimeExtraMainNavigationKeys);
    expect(
      navigationContract.knownRuntimeExtraMainNavigationKeys.every((key) =>
        navigationContract.parkedMainNavigationKeys.includes(key),
      ),
    ).toBe(true);
  });

  it("keeps every old import and documentation entry as an alias, not a copy", () => {
    for (const [alias, owner] of Object.entries(authority.compatibilityAliases)) {
      const aliasPath = repoPath(alias);
      const ownerPath = repoPath(owner);

      expect(fs.lstatSync(aliasPath).isSymbolicLink(), alias).toBe(true);
      expect(fs.realpathSync(aliasPath), alias).toBe(fs.realpathSync(ownerPath));
    }
  });

  it("serves brand assets directly from their official masters", () => {
    for (const [deliveryPath, master] of Object.entries(authority.deliveryAliases)) {
      const aliasPath = repoPath(deliveryPath);

      expect(fs.lstatSync(aliasPath).isSymbolicLink(), deliveryPath).toBe(true);
      expect(fs.realpathSync(aliasPath), deliveryPath).toBe(fs.realpathSync(repoPath(master)));
    }
  });

  it("labels historical sources as references instead of current authority", () => {
    const current = new Set(Object.values(authority.current).map((entry) => fs.realpathSync(repoPath(entry))));

    for (const reference of Object.values(authority.references)) {
      const resolved = fs.realpathSync(repoPath(reference));
      expect(resolved.startsWith(fs.realpathSync(DESIGN_SYSTEM_ROOT)), reference).toBe(true);
      expect(current.has(resolved), reference).toBe(false);
    }
  });

  it("renders the Fikirtive mark from the official SVG instead of duplicating its geometry", () => {
    const source = fs.readFileSync(
      path.join(DESIGN_SYSTEM_ROOT, "brand/components/FikirtiveMark.tsx"),
      "utf8",
    );

    expect(source).toContain('src="/brand/f-app-icon-coral.svg"');
    expect(source).not.toMatch(/<svg|#[0-9a-f]{6}/i);
  });

  it("keeps the canonical Otto button coral while meeting AA small-text contrast", () => {
    const palette = JSON.parse(
      fs.readFileSync(path.join(DESIGN_SYSTEM_ROOT, "brand/colors.json"), "utf8"),
    ) as { brand: { coral: string; ottoEyes: string } };
    const source = fs.readFileSync(
      path.join(DESIGN_SYSTEM_ROOT, "primitives/button.tsx"),
      "utf8",
    );

    expect(contrastRatio(palette.brand.coral, palette.brand.ottoEyes)).toBeGreaterThanOrEqual(4.5);
    expect(source).toContain('otto: "bg-brand text-brand-ink');
    expect(source).not.toContain('otto: "bg-brand text-brand-foreground');
  });
});
