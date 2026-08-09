/**
 * Design-token compile assertions — design-rules v3 (the law) vs globals.css (token truth).
 *
 * Compiles app/globals.css through the real Tailwind v4 pipeline (@tailwindcss/node, the
 * same compiler @tailwindcss/postcss drives in `next build`) and asserts the token-level
 * quick wins hold in the CSS the product actually ships:
 *
 *  1. Control radius (§5, polish-delta #1): `rounded-lg` renders the 14px control radius
 *     (var(--radius)), not the legacy Vapor 20px hijack.
 *  2. State colours (§T5 three-place rule, code-gaps #11): text-success / bg-error /
 *     text-info utilities actually generate (they were silently missing).
 *  3. Focus ring (§A2): the global two-layer .gb :focus-visible rule (1px keyline +
 *     40% halo) exists in the output.
 *  4. Motion tokens (§6): --dur-* / --ease-spring land in .gb and the button's arbitrary
 *     duration/easing utilities generate against them.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const webRoot = path.resolve(__dirname, "../..");

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const srgb = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(left: string, right: string): number {
  const [lighter, darker] = [relativeLuminance(left), relativeLuminance(right)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

async function compileGlobals(candidates: string[]): Promise<string> {
  // @tailwindcss/node is not a direct dep — resolve it through @tailwindcss/postcss
  // (direct devDep), whose own compiler it is. Keeps the test on the production pipeline.
  const req = createRequire(path.join(webRoot, "package.json"));
  const reqFromPostcss = createRequire(req.resolve("@tailwindcss/postcss"));
  const { compile } = await import(pathToFileURL(reqFromPostcss.resolve("@tailwindcss/node")).href);

  const entry = path.join(webRoot, "app/globals.css");
  const css = await fs.readFile(entry, "utf8");
  const compiler = await compile(css, { base: path.dirname(entry), onDependency: () => {} });
  return compiler.build(candidates);
}

describe("design tokens (globals.css compiled by Tailwind v4)", () => {
  const candidates = [
    "rounded-lg",
    "text-success",
    "bg-success",
    "bg-error",
    "text-info",
    "text-data-label",
    "text-brand-strong",
    "bg-brand-strong",
    "duration-[var(--dur-2)]",
    "ease-[var(--ease-spring)]",
  ];
  let out: string;

  async function compiled(): Promise<string> {
    if (!out) out = await compileGlobals(candidates);
    return out;
  }

  it("rounded-lg renders the 14px control radius, not the Vapor 20px hijack", async () => {
    const css = await compiled();
    const rule = css.match(/\.rounded-lg\s*\{[^}]*\}/)?.[0];
    expect(rule).toBeDefined();
    expect(rule).toContain("border-radius: var(--radius)");
    expect(rule).not.toContain("20px");
    // …and the .gb control radius the utility now points at is 14px.
    expect(css).toMatch(/\.gb\s*\{[^}]*--radius:\s*0\.875rem/);
  });

  it("state colour utilities generate (three-place rule — were silently missing)", async () => {
    const css = await compiled();
    expect(css).toMatch(/\.text-success\s*\{[^}]*var\(--success\)/);
    expect(css).toMatch(/\.bg-success\s*\{[^}]*var\(--success\)/);
    expect(css).toMatch(/\.bg-error\s*\{[^}]*var\(--error\)/);
    expect(css).toMatch(/\.text-info\s*\{[^}]*var\(--info\)/);
    expect(css).toMatch(/\.text-data-label\s*\{[^}]*var\(--data-label\)/);
    expect(css).toMatch(/\.text-brand-strong\s*\{[^}]*var\(--brand-strong\)/);
    expect(css).toMatch(/\.bg-brand-strong\s*\{[^}]*var\(--brand-strong\)/);
  });

  it("brand-strong passes WCAG AA for small text in both directions against white", async () => {
    const source = await fs.readFile(path.join(webRoot, "app/globals.css"), "utf8");
    const literal = source.match(/--brand-strong:\s*(#[0-9A-F]{6});/)?.[1];
    expect(literal).toBeDefined();
    expect(contrastRatio(literal!, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", literal!)).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * #739 — Library's "Delete" is a filled `variant="destructive"` button, so its contrast is
   * decided by this one token, not by that screen. White on the old #E5484D measured 3.91:1
   * against the 4.5:1 floor small text carries, and the same literal read 3.82:1 as
   * `text-destructive` on --background. Both directions are asserted because the token is
   * used both ways; --error carries the same literal and moves with it.
   */
  it("destructive and error pass WCAG AA in both directions (filled button and small text)", async () => {
    const light = (await fs.readFile(path.join(webRoot, "app/globals.css"), "utf8"))
      .match(/\.gb\s*\{[\s\S]*?\n\}/)?.[0];
    expect(light).toBeDefined();

    const background = light!.match(/--background:\s*(#[0-9A-F]{6})/i)?.[1];
    const onFill = light!.match(/--destructive-foreground:\s*(#[0-9A-F]{6})/i)?.[1];
    expect(background).toBe("#FCFCFC");
    expect(onFill).toBe("#FFFFFF");

    for (const token of ["destructive", "error"] as const) {
      const literal = light!.match(new RegExp(`--${token}:\\s*(#[0-9A-F]{6})`, "i"))?.[1];
      expect(literal, token).toBeDefined();
      // Filled: the label sitting on the token.
      expect(contrastRatio(onFill!, literal!), `${token} filled`).toBeGreaterThanOrEqual(4.5);
      // Text: the token sitting on the page.
      expect(contrastRatio(literal!, background!), `${token} as text`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * #813 — the AA fix above only reaches screens that ask for the token. Two admin screens
   * had typed the old red and the old green straight into `style={{ color: … }}`, so the
   * 3.91:1 failure survived there untouched, and a third surface still carried the retired
   * red as a `var(--error, …)` fallback. A literal cannot follow a token, so the fence is on
   * the literals themselves: once retired, they must not reappear anywhere in the markup.
   * This is not a ban on hex in general (the product still ships hundreds) — only on the
   * two shades that were measured and replaced.
   */
  it("the retired state-colour literals survive nowhere in the markup (#813)", async () => {
    const RETIRED = [
      { literal: "#E5484D", why: "the pre-#739 destructive/error red — 3.91:1 on white" },
      { literal: "#3FB950", why: "an off-token green that never tracked --success" },
    ];

    async function markupFiles(dir: string): Promise<string[]> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const nested = await Promise.all(
        entries.map(async (entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) return entry.name === "node_modules" ? [] : markupFiles(full);
          return full.endsWith(".tsx") ? [full] : [];
        }),
      );
      return nested.flat();
    }

    const files = [
      ...(await markupFiles(path.join(webRoot, "app"))),
      ...(await markupFiles(path.join(webRoot, "components"))),
    ];
    // An empty file list would make the assertion vacuously green.
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, "utf8");
      for (const { literal, why } of RETIRED) {
        if (text.toUpperCase().includes(literal)) {
          offenders.push(`${path.relative(webRoot, file)} — ${literal} (${why})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("global two-layer coral focus ring (§A2) is present", async () => {
    const css = await compiled();
    const rule = css.match(/\.gb\s+:focus-visible\s*\{[^}]*\}/)?.[0];
    expect(rule).toBeDefined();
    expect(rule).toContain("0 0 0 1px var(--ring)");
    expect(rule).toContain("0 0 0 4px color-mix(in oklab, var(--ring) 40%, transparent)");
  });

  it("motion tokens land in .gb and the button transition utilities generate", async () => {
    const css = await compiled();
    expect(css).toMatch(/\.gb\s*\{[^}]*--dur-2:\s*150ms/);
    expect(css).toMatch(/\.gb\s*\{[^}]*--ease-spring:\s*cubic-bezier\(0\.34,\s*1\.56,\s*0\.64,\s*1\)/);
    expect(css).toContain("transition-duration: var(--dur-2)");
    expect(css).toContain("transition-timing-function: var(--ease-spring)");
  });
});
