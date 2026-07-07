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
