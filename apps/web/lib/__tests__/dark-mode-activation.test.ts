/**
 * #804 — the §K3 activation contract, asserted wire by wire.
 *
 * Dark mode was not missing before this ticket. The `.gb.dark` token block had existed and
 * been contrast-audited for months; it was simply unreachable — nothing ever set the class,
 * so every value in it was dead code that no screen and no test could tell apart from a
 * correct one. That is the failure mode this file guards: a token block that LOOKS right and
 * reaches nothing. Each assertion below therefore checks a wire, not a value:
 *
 *   ① provider   — next-themes is mounted, with the class strategy and a system default.
 *   ② variant    — `dark:` compiles to the CLASS, never to the OS media query.
 *   ③ scheme     — `color-scheme` is declared in both token blocks (§K2.7), so native
 *                  controls (date pickers, selects, file inputs) follow the theme.
 *   ④ themeColor — both ground colours reach the browser chrome, and they are the two
 *                  `--background` literals, not a hand-typed near-miss.
 *   ⑤ shadows    — the six dark shadow tokens land in the dark block (§K1).
 *
 * Plus the two things that make the wires worth having: the dark block is actually REACHED
 * by the selector next-themes produces, and every dark text pair clears WCAG AA.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const webRoot = path.resolve(__dirname, "../..");
const globalsPath = path.join(webRoot, "app/globals.css");

const readGlobals = () => fs.readFile(globalsPath, "utf8");
const readLayout = () => fs.readFile(path.join(webRoot, "app/layout.tsx"), "utf8");

/** The `.gb` light token block: from `.gb {` to the first line that closes it. */
function lightBlock(css: string): string {
  const block = css.match(/\n\.gb \{[\s\S]*?\n\}/)?.[0];
  if (!block) throw new Error("the .gb light token block is gone");
  return block;
}

/** The dark token block, whatever the selector has grown to. */
function darkBlock(css: string): string {
  const block = css.match(/\n\.gb\.dark[^{]*\{[\s\S]*?\n\}/)?.[0];
  if (!block) throw new Error("the .gb dark token block is gone");
  return block;
}

function token(block: string, name: string): string | undefined {
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`, "i"))?.[1]?.trim();
}

async function compileGlobals(candidates: string[]): Promise<string> {
  // @tailwindcss/node is the compiler @tailwindcss/postcss drives in `next build`; resolving
  // it through that direct devDep keeps this on the production pipeline (same route
  // design-tokens.test.ts and globals-css-layers.test.ts take).
  const req = createRequire(path.join(webRoot, "package.json"));
  const reqFromPostcss = createRequire(req.resolve("@tailwindcss/postcss"));
  const { compile } = await import(pathToFileURL(reqFromPostcss.resolve("@tailwindcss/node")).href);
  const compiler = await compile(await readGlobals(), {
    base: path.dirname(globalsPath),
    onDependency: () => {},
  });
  return compiler.build(candidates);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const srgb = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(left: string, right: string): number {
  const [lighter, darker] = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("#804 wire ① — the provider is mounted", () => {
  it("layout.tsx renders ThemeProvider around the app", async () => {
    const layout = await readLayout();
    expect(layout).toContain('import { ThemeProvider } from "@/components/theme-provider"');
    expect(layout).toContain("<ThemeProvider>");
    // next-themes writes onto <html> before hydration; without this React would blow the
    // tree away on every load and the flash-free script would be pointless.
    expect(layout).toContain("suppressHydrationWarning");
  });

  it("the provider uses the class strategy, keeps System, and defaults to it", async () => {
    const provider = await fs.readFile(path.join(webRoot, "components/theme-provider.tsx"), "utf8");
    expect(provider).toContain('from "next-themes"');
    expect(provider).toContain('attribute="class"');
    expect(provider).toContain('defaultTheme="system"');
    expect(provider).toContain("enableSystem");
  });

  it("the merchant has all three choices, System included", async () => {
    const toggle = await fs.readFile(path.join(webRoot, "components/theme-toggle.tsx"), "utf8");
    for (const value of ["light", "dark", "system"]) {
      expect(toggle, value).toContain(`value: "${value}"`);
    }
    // A two-state switch can leave System but never return to it — the default would be
    // unreachable the moment it was touched once.
    expect(toggle).toContain("useTheme");
  });
});

describe("#804 wire ② — `dark:` fires on the class, not the OS", () => {
  it("@custom-variant dark is declared", async () => {
    expect(await readGlobals()).toMatch(/@custom-variant\s+dark\s*\(&:where\(\.dark,\s*\.dark \*\)\);/);
  });

  /**
   * The regression this pins is silent and already shipped once: with Tailwind's stock
   * variant, `dark:bg-input/30` on <Select>/<Textarea> compiled to a
   * `prefers-color-scheme: dark` media query, so an OS-dark merchant got grey washes on
   * those controls while the page around them was still light.
   */
  it("a dark: utility compiles to .dark, and no prefers-color-scheme block claims it", async () => {
    const css = await compileGlobals(["dark:bg-card"]);
    const rule = css.match(/[^\n}]*\\:bg-card[^{]*\{[^}]*\}/)?.[0];
    expect(rule, "dark:bg-card must generate").toBeDefined();
    expect(rule).toContain(".dark");
    expect(rule).not.toContain("prefers-color-scheme");
  });

  it("the three shipped dark: call sites are the ones this fixes", async () => {
    const kit = path.join(webRoot, "components/ui");
    const withDark: string[] = [];
    for (const name of await fs.readdir(kit)) {
      if ((await fs.readFile(path.join(kit, name), "utf8")).includes("dark:")) withDark.push(name);
    }
    expect(withDark.sort()).toEqual(["select.tsx", "switch.tsx", "textarea.tsx"]);
  });
});

describe("#804 wire ③ — color-scheme (§K2.7)", () => {
  it("both token blocks declare it, so native controls follow the theme", async () => {
    const css = await readGlobals();
    expect(lightBlock(css)).toMatch(/color-scheme:\s*light;/);
    expect(darkBlock(css)).toMatch(/color-scheme:\s*dark;/);
  });

  it("it survives the compile (it is a real declaration, not a comment)", async () => {
    const css = await compileGlobals([]);
    expect(css).toMatch(/color-scheme:\s*light/);
    expect(css).toMatch(/color-scheme:\s*dark/);
  });
});

describe("#804 wire ④ — themeColor metadata", () => {
  it("both ground colours reach the browser chrome, and they ARE the --background pair", async () => {
    const layout = await readLayout();
    const css = await readGlobals();

    expect(layout).toContain("export const viewport");
    expect(layout).toContain("themeColor");

    const light = token(lightBlock(css), "background");
    const dark = token(darkBlock(css), "background");
    expect(light).toBe("#FCFCFC");
    expect(dark).toBe("#0B0B0C");
    // Typed once in §K3 and again in the metadata is exactly how the two drift apart.
    expect(layout).toContain(`color: "${light}"`);
    expect(layout).toContain(`color: "${dark}"`);
    expect(layout).toContain("(prefers-color-scheme: light)");
    expect(layout).toContain("(prefers-color-scheme: dark)");
  });
});

describe("#804 wire ⑤ — the six dark shadow tokens (§K1)", () => {
  it("all six are declared in the dark block, none inherited from the light one", async () => {
    const dark = darkBlock(await readGlobals());
    for (const name of ["shadow-xs", "shadow-sm", "shadow-md", "shadow-lg", "shadow-xl", "shadow-brand"]) {
      const value = token(dark, name);
      expect(value, name).toBeDefined();
      // The light values are all rgba(20 20 24 / …) — invisible on #0B0B0C. Inheriting one
      // is the exact defect §K1 recorded, and it looks identical to having fixed it.
      expect(value, name).not.toContain("20 20 24");
    }
  });
});

describe("#804 — the dark block is actually reachable", () => {
  /**
   * §K3 describes `.dark` landing "next to .gb" on <body>. next-themes cannot do that: it
   * writes its class on <html> and nothing else. A same-element selector would therefore
   * have compiled, shipped, and matched nothing — the same shape of silent failure the
   * ticket exists to end.
   */
  it("the selector covers the ancestor form next-themes produces", async () => {
    const css = await readGlobals();
    const selector = css.match(/\n(\.gb\.dark[^{]*)\{/)?.[1]?.trim();
    expect(selector).toContain(".dark .gb");
  });

  it("`gb` is on <body> while the theme class is on <html> — the reason for the above", async () => {
    expect(await readLayout()).toContain('<body className="gb');
  });

  it("no .gb-scoped recipe still paints a raw colour that cannot follow the theme (§K4)", async () => {
    const css = await readGlobals();
    // Comments carry the retirement record (which literal was replaced by which token), so
    // they are stripped structurally before the fence reads the file.
    const req = createRequire(path.join(webRoot, "package.json"));
    const reqFromPostcss = createRequire(req.resolve("@tailwindcss/postcss"));
    const postcss = reqFromPostcss("postcss") as {
      parse(css: string): {
        walk(cb: (n: { type: string; selector?: string; prop?: string; value?: string }) => void): void;
      };
    };

    const offenders: string[] = [];
    let selector = "";
    postcss.parse(css).walk((node) => {
      if (node.type === "rule") selector = node.selector ?? "";
      if (node.type !== "decl" || !selector.startsWith(".gb ")) return;
      // Shadows are exempt by §K2.2: dark grounds with shadow and defines edges with the
      // 1px border, so a weak dark shadow is the intended behaviour, not an inversion.
      if ((node.prop ?? "").includes("shadow")) return;
      if (/#[0-9a-f]{3,8}\b|rgba?\(\s*255[\s,]/i.test(node.value ?? "")) {
        offenders.push(`${selector} { ${node.prop}: ${node.value} }`);
      }
    });
    expect(offenders).toEqual([]);
  });
});

describe("#804 — dark semantic colour keeps WCAG AA", () => {
  /**
   * §K1 claims every dark pair passes AA. The claim was untestable while nothing rendered
   * dark; now it ships, so it is computed from the token block itself rather than trusted.
   * Pairs are named the way the product uses them: soft text on its soft ground, and the
   * same soft text on the page ground (badges sit on both).
   */
  it("text pairs clear 4.5:1 — success, warning, danger, info, brand and links included", async () => {
    const dark = darkBlock(await readGlobals());
    const value = (name: string) => {
      const literal = token(dark, name);
      expect(literal, name).toMatch(/^#[0-9A-Fa-f]{6}$/);
      return literal!;
    };

    const background = value("background");
    const pairs: [string, string, string][] = [
      ["foreground on page", value("foreground"), background],
      ["muted-foreground on page", value("muted-foreground"), background],
      ["foreground on card", value("foreground"), value("card")],
      ["foreground on popover", value("foreground"), value("popover")],
      // Filled controls: the label sits ON the token, and §K2.5 says never assume white survives.
      ["primary-foreground on primary", value("primary-foreground"), value("primary")],
      ["brand-foreground on brand", value("brand-foreground"), value("brand")],
      ["destructive-foreground on destructive", value("destructive-foreground"), value("destructive")],
      // Semantic soft pairs, on their own ground and on the page.
      ["success text on success-soft", value("success-soft-foreground"), value("success-soft")],
      ["success text on page", value("success-soft-foreground"), background],
      ["warning text on warning-soft", value("warning-soft-foreground"), value("warning-soft")],
      ["warning text on page", value("warning-soft-foreground"), background],
      ["error text on error-soft", value("error-soft-foreground"), value("error-soft")],
      ["error text on page", value("error-soft-foreground"), background],
      ["info text on info-soft", value("info-soft-foreground"), value("info-soft")],
      ["info text on page", value("info-soft-foreground"), background],
      ["brand text on brand-soft", value("brand-soft-foreground"), value("brand-soft")],
      // The `link` button variant is `text-brand-strong` — a link is small text, §A1.3.
      ["link text on page", value("brand-strong"), background],
      ["link text on card", value("brand-strong"), value("card")],
    ];

    for (const [name, foreground, ground] of pairs) {
      expect(contrastRatio(foreground, ground), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the focus ring clears the 3:1 non-text floor on the dark page", async () => {
    const dark = darkBlock(await readGlobals());
    expect(contrastRatio(token(dark, "ring")!, token(dark, "background")!)).toBeGreaterThanOrEqual(3);
  });

  it("no pure black or pure white anywhere in the dark block (§K2.6)", async () => {
    const dark = darkBlock(await readGlobals());
    const grounds = dark.match(/--[a-z-]+:\s*#[0-9A-Fa-f]{6}/g) ?? [];
    expect(grounds.length).toBeGreaterThan(20);
    for (const declaration of grounds) {
      expect(declaration.toUpperCase()).not.toMatch(/#(000000|FFFFFF)$/);
    }
  });
});
