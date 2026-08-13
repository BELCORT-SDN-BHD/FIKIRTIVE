/**
 * globals.css cascade-layer fence (#798).
 *
 * The defect this guards against is silent: an unlayered rule in globals.css beats
 * EVERY Tailwind utility, responsive variants included, because unlayered author
 * styles outrank every cascade layer. So `md:flex-col` or `lg:hidden` written next
 * to an `al-*` / `cv-*` class compiles, ships, and does nothing — no error, no
 * warning, nothing to grep for. It was diagnosed once in fd53e925 ("the app's
 * unlayered al-* CSS beats Tailwind's @layer utilities, so lg:/max-lg: never
 * applied — the mobile ☰ leaked onto desktop and the sidebar wouldn't collapse on
 * phones") and worked around with hand-written media queries instead of fixed at
 * the root; design-rules §L6 then wrote the workaround down as house style.
 *
 * Two assertions, one per half of the claim:
 *   1. SOURCE — every rule in globals.css sits inside an @layer, except the three
 *      token roots listed below.
 *   2. COMPILED — after the real Tailwind v4 pipeline runs, the recipes really are
 *      in `components`, the utilities really are in `utilities`, and the layer
 *      statement really does order components before utilities. (1) without (2)
 *      would pass on a file whose layers were declared in the wrong order.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const webRoot = path.resolve(__dirname, "../..");
const globalsPath = path.join(webRoot, "app/globals.css");

/**
 * Selectors allowed to stay unlayered, each with the reason it is allowed.
 * Adding a row here is the ratchet: it costs an edit to this list and a reason.
 *
 * A token root declares custom properties. Variables are read by whatever rule
 * wins the cascade, so layering them changes nothing about which utility applies —
 * they are not in the class of bug above. `.gb` additionally paints its own element
 * (background-color / color / font-family); layering THAT is a repaint of five call
 * sites that pair `gb` with `bg-card`, which is a visual decision, not a cascade
 * cleanup, and is deliberately not smuggled into this fence.
 */
const UNLAYERED_TOKEN_ROOTS: Record<string, string> = {
  ":root": "Vapor token root — custom properties only",
  ".gb": "Grok-bright token root (+ the theme surface paint it owns)",
  // #804 grew this selector by one form, `.dark .gb`, and did not add a rule: next-themes
  // writes `.dark` on <html> while `gb` lives on <body>, so the same-element `.gb.dark` it
  // replaces could never have matched in production. Still one unlayered token root.
  '.gb.dark, .gb[data-theme="dark"], .dark .gb': "Grok-bright dark token root",
};

/** At-rules that are Tailwind directives rather than rules of our own. */
const TOP_LEVEL_DIRECTIVES = ["@import", "@theme", "@plugin", "@custom-variant", "@utility", "@source"];

type Block = { prelude: string; body: string };

/** Every brace block at depth 0, with comments removed. Enough of a parser for this file. */
function topLevelBlocks(css: string): Block[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: Block[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;
  let prelude = "";

  for (let i = 0; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === "{") {
      if (depth === 0) {
        prelude = stripped.slice(preludeStart, i).trim();
        bodyStart = i + 1;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        blocks.push({ prelude, body: stripped.slice(bodyStart, i) });
        preludeStart = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      preludeStart = i + 1;
    }
  }
  return blocks;
}

/** Rule preludes (selectors) inside a block, at any nesting depth. */
function selectorsIn(body: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "{") {
      const prelude = body.slice(start, i).trim();
      if (prelude && !prelude.startsWith("@")) selectors.push(prelude.replace(/\s+/g, " "));
      depth += 1;
      start = i + 1;
    } else if (ch === "}") {
      depth -= 1;
      start = i + 1;
    } else if (ch === ";" && depth >= 0) {
      start = i + 1;
    }
  }
  return selectors;
}

async function compileGlobals(candidates: string[]): Promise<string> {
  // Same route design-tokens.test.ts takes: @tailwindcss/node is the compiler
  // @tailwindcss/postcss drives in `next build`, resolved through it.
  const req = createRequire(path.join(webRoot, "package.json"));
  const reqFromPostcss = createRequire(req.resolve("@tailwindcss/postcss"));
  const { compile } = await import(pathToFileURL(reqFromPostcss.resolve("@tailwindcss/node")).href);
  const css = await fs.readFile(globalsPath, "utf8");
  const compiler = await compile(css, { base: path.dirname(globalsPath), onDependency: () => {} });
  return compiler.build(candidates);
}

describe("globals.css lives in cascade layers (#798)", () => {
  it("has no unlayered rule except the declared token roots", async () => {
    const blocks = topLevelBlocks(await fs.readFile(globalsPath, "utf8"));

    const offenders = blocks
      .filter((block) => !block.prelude.startsWith("@layer "))
      .filter((block) => !TOP_LEVEL_DIRECTIVES.some((directive) => block.prelude.startsWith(directive)))
      .filter((block) => !(block.prelude in UNLAYERED_TOKEN_ROOTS))
      .map((block) => block.prelude.replace(/\s+/g, " "));

    // A bare `@media` at the top level is the exact shape of the workaround this
    // ticket removed (fd53e925), so it is named rather than left to the generic message.
    expect(
      offenders,
      "Wrap these in @layer components (or @layer base for element defaults). Unlayered CSS " +
        "beats every Tailwind utility, so responsive variants next to these classes fail silently. " +
        "A token root that genuinely must stay unlayered goes in UNLAYERED_TOKEN_ROOTS with a reason.",
    ).toEqual([]);
  });

  it("still sweeps the whole file (an empty sweep is not a pass)", async () => {
    const blocks = topLevelBlocks(await fs.readFile(globalsPath, "utf8"));
    const layerBlocks = blocks.filter((block) => block.prelude.startsWith("@layer "));
    const layeredSelectors = layerBlocks.flatMap((block) => selectorsIn(block.body));

    // 390 layered rules at the time of writing; the floor catches the population
    // COLLAPSING (a rename, a rewrite, a file split) rather than pinning a count.
    expect(layerBlocks.length).toBeGreaterThanOrEqual(2);
    expect(layeredSelectors.length).toBeGreaterThanOrEqual(300);
    // The recipes the canvas, the asset panel and Otto actually render.
    for (const selector of [".al-btn", ".al-panel", ".gb .cv-toolbar", ".otto-prose"]) {
      expect(layeredSelectors, selector).toContain(selector);
    }
  });

  it("compiles with the recipes in `components` and utilities in `utilities`", async () => {
    const css = await compileGlobals(["md:hidden", "lg:flex-col", "bg-card"]);

    const order = css.match(/@layer ([^;{]*\bcomponents\b[^;{]*);/)?.[1];
    expect(order, "Tailwind must declare the layer order up front").toBeDefined();
    const names = order!.split(",").map((name) => name.trim());
    expect(names.indexOf("components")).toBeLessThan(names.indexOf("utilities"));

    const layerOf = new Map<string, string>();
    for (const block of topLevelBlocks(css)) {
      if (!block.prelude.startsWith("@layer ")) continue;
      const name = block.prelude.slice("@layer ".length).trim();
      for (const selector of selectorsIn(block.body)) if (!layerOf.has(selector)) layerOf.set(selector, name);
    }

    expect(layerOf.get(".al-btn")).toBe("components");
    expect(layerOf.get(".gb .cv-toolbar")).toBe("components");
    expect(layerOf.get(".otto-prose")).toBe("components");
    expect(layerOf.get("body")).toBe("base");
    // The responsive variants that used to lose to this file.
    expect(layerOf.get(".md\\:hidden")).toBe("utilities");
    expect(layerOf.get(".lg\\:flex-col")).toBe("utilities");
  });

  it("leaves nothing but the token roots unlayered in the shipped stylesheet", async () => {
    const css = await compileGlobals(["md:hidden"]);
    const unlayered = topLevelBlocks(css)
      .filter((block) => !block.prelude.startsWith("@layer ") && !block.prelude.startsWith("@"))
      .map((block) => block.prelude.replace(/\s+/g, " "));

    expect(unlayered).toEqual(Object.keys(UNLAYERED_TOKEN_ROOTS));
  });
});
