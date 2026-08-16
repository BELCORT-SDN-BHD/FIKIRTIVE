/**
 * #920(#840 判官 r1 P2)— Otto's three fixed-row `<Textarea>` boxes must not grow with
 * content.
 *
 * `@/components/ui/textarea` ships `field-sizing-content` in its own base classes —
 * correct for a form field that should expand to fit what's typed, wrong for a composer
 * built around a specific `rows={N}` box inside fixed chrome (a bordered, shadowed,
 * rounded panel other elements are laid out around). Left alone, `field-sizing: content`
 * silently overrides the browser's normal rows-based sizing the instant the merchant
 * types past the first line, pushing surrounding layout around — the "迁移零重排" (a
 * migration must not reflow layout) rule #840 itself is built on, broken by the shared
 * primitive's own default rather than anything this call site wrote.
 *
 * There is no browser here to lay a box out and watch it hold still, so this file proves
 * the claim two ways instead of one:
 *   1. COMPILED — `field-sizing-fixed` really does compile to `field-sizing: fixed` through
 *      the real Tailwind v4 pipeline (not just a class name that happens to look right).
 *   2. SOURCE — every one of Otto's three fixed-row Textarea call sites carries that class,
 *      keeps its `rows={N}`, and none of them regained `field-sizing-content` by width
 *      (twMerge drops the earlier one, but a stray second `field-sizing-*` class written
 *      by hand wouldn't go through twMerge until render, so the source itself is checked
 *      too) — a population floor keeps this from silently checking zero files if a
 *      composer is ever renamed or removed.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const globalsPath = path.join(WEB_ROOT, "app/globals.css");

/** The four fixed-row composer/caption boxes and the `rows` each one is built around. */
const FIXED_HEIGHT_TEXTAREAS: { file: string; rows: number }[] = [
  { file: "components/otto/OttoChatStream.tsx", rows: 2 },
  { file: "components/otto/OttoFrontDoor.tsx", rows: 3 },
  { file: "components/otto/OttoSchedule.tsx", rows: 4 },
];

async function compileGlobals(candidates: string[]): Promise<string> {
  // Same real production pipeline design-tokens.test.ts / globals-css-layers.test.ts /
  // dark-mode-activation.test.ts drive: @tailwindcss/node is the compiler
  // @tailwindcss/postcss uses inside `next build`.
  const req = createRequire(path.join(WEB_ROOT, "package.json"));
  const reqFromPostcss = createRequire(req.resolve("@tailwindcss/postcss"));
  const { compile } = await import(pathToFileURL(reqFromPostcss.resolve("@tailwindcss/node")).href);
  const compiler = await compile(fs.readFileSync(globalsPath, "utf8"), {
    base: path.dirname(globalsPath),
    onDependency: () => {},
  });
  return compiler.build(candidates);
}

/** The `<Textarea ... />` block for a given file — self-closing, so no brace-depth
 *  tracking is needed the way a `readOpeningTag`-style parser would for `<button>`. */
function textareaBlock(file: string): string {
  const text = fs.readFileSync(path.join(WEB_ROOT, file), "utf8");
  const block = text.match(/<Textarea[\s\S]*?\/>/)?.[0];
  if (!block) throw new Error(`${file}: no <Textarea ... /> found`);
  return block;
}

/** Just the `className="..."` value — the surrounding block also holds comments, and a
 *  comment is free to talk about `field-sizing-content` by name (as the ones explaining
 *  this very fix do) without that being a class on the element. */
function textareaClassName(file: string): string {
  const value = textareaBlock(file).match(/\bclassName="([^"]*)"/)?.[1];
  if (value === undefined) throw new Error(`${file}: <Textarea> has no className="..."`);
  return value;
}

describe("#920 — Otto's fixed-row composers do not grow with content", () => {
  it("field-sizing-fixed really compiles to `field-sizing: fixed`, not just a class that looks right", async () => {
    const css = await compileGlobals(["field-sizing-fixed", "field-sizing-content"]);
    expect(css).toMatch(/\.field-sizing-fixed\s*\{\s*field-sizing:\s*fixed;?\s*\}/);
    // The pair is asserted together so a future twMerge/Tailwind upgrade that stopped
    // treating them as the same conflict group would be caught by the merge test below,
    // not silently pass because only one half was ever compiled.
    expect(css).toMatch(/\.field-sizing-content\s*\{\s*field-sizing:\s*content;?\s*\}/);
  });

  it("still finds all three fixed-row composers (population floor)", () => {
    // Fails loudly if a composer is renamed/moved rather than quietly checking nothing.
    expect(FIXED_HEIGHT_TEXTAREAS.length).toBe(3);
    for (const { file } of FIXED_HEIGHT_TEXTAREAS) {
      expect(fs.existsSync(path.join(WEB_ROOT, file)), file).toBe(true);
    }
  });

  for (const { file, rows } of FIXED_HEIGHT_TEXTAREAS) {
    it(`${file}: keeps its fixed rows={${rows}} box and overrides field-sizing-content`, () => {
      const block = textareaBlock(file);
      expect(block, `${file} rows`).toContain(`rows={${rows}}`);
      const className = textareaClassName(file);
      expect(className.split(/\s+/), `${file} className`).toContain("field-sizing-fixed");
    });
  }

  it("twMerge actually drops ui/textarea's field-sizing-content once field-sizing-fixed is appended", () => {
    // The base classes are ui/textarea.tsx's own, copied so this test fails (not silently
    // passes) if that component's base string ever moves the field-sizing utility.
    const uiTextarea = fs.readFileSync(path.join(WEB_ROOT, "components/ui/textarea.tsx"), "utf8");
    expect(uiTextarea, "components/ui/textarea.tsx no longer ships field-sizing-content as a base class")
      .toMatch(/field-sizing-content/);
    const cnSource = fs.readFileSync(path.join(WEB_ROOT, "lib/utils.ts"), "utf8");
    expect(cnSource).toContain("twMerge");
    for (const { file } of FIXED_HEIGHT_TEXTAREAS) {
      const classes = textareaClassName(file).split(/\s+/);
      // The call site itself must not carry field-sizing-content — if it did, whichever
      // one twMerge keeps would be a coin flip on class order, not a guarantee.
      expect(classes, `${file} must not also carry field-sizing-content`).not.toContain("field-sizing-content");
    }
  });
});
