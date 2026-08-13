// @vitest-environment jsdom
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
 * Plus the two things that make the wires worth having: every `.gb` token root — the global
 * one AND every route-scoped compound root — is actually REACHED by the selector next-themes
 * produces, and every dark text pair clears WCAG AA.
 *
 * r2 note on that first one. The original check asked whether the GLOBAL dark selector string
 * contained `.dark .gb`, which it did, so sixteen cases went green while
 * `.gb.ns-immersive` (app/northstar-immersive/immersive-tokens.css) shipped a dark mirror
 * that matched nothing: its two branches were both same-element (`.gb.ns-immersive.dark`),
 * next-themes writes `.dark` on <html>, and the light root tied `.dark .gb` on specificity
 * (0,2,0) and won on load order. Dark rendered #F5F6F8 ground under #FAFAFA type — 1.04:1 on
 * a live customer route. A check that reads one hand-named selector cannot see that. So the
 * reachability tests below ENUMERATE every rule in every shipped stylesheet that declares a
 * custom property, and decide each one by matching and specificity rather than by string.
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

/* ══════════════════════════════════════════════════════════════════════════════════════
 * TOKEN-ROOT MACHINERY (r2). Everything below reads the shipped stylesheets and decides
 * reachability structurally — no selector is named by hand, so a token root added in a new
 * route file is audited the day it lands instead of the day someone remembers it.
 * ═════════════════════════════════════════════════════════════════════════════════════ */

type PostcssNode = { type: string; prop?: string; value?: string; selector?: string };
type PostcssRule = {
  selector: string;
  source?: { start?: { line: number } };
  each(callback: (node: PostcssNode) => void): void;
};
type PostcssModule = {
  parse(css: string): {
    walk(callback: (node: PostcssNode) => void): void;
    walkRules(callback: (rule: PostcssRule) => void): void;
  };
  list: { comma(value: string): string[] };
};

/** postcss reached the same way the compiler tests reach it: through the real build dep. */
function loadPostcss(): PostcssModule {
  const req = createRequire(path.join(webRoot, "package.json"));
  const reqFromPostcss = createRequire(req.resolve("@tailwindcss/postcss"));
  return reqFromPostcss("postcss") as PostcssModule;
}

/**
 * Every stylesheet the app ships, in the order the browser gets them: globals.css comes from
 * the root layout, so it lands first; a route-group token layer (imported by a nested
 * layout) lands after. That order is the whole reason a specificity TIE is a defect and not
 * a detail — the later sheet wins ties, and the later sheet is the scoped light root.
 */
async function shippedStylesheets(): Promise<{ file: string; css: string }[]> {
  const found: { file: string; css: string }[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // directory absent — nothing to audit there
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".css")) found.push({ file: path.relative(webRoot, full), css: await fs.readFile(full, "utf8") });
    }
  };
  await walk(path.join(webRoot, "app"));
  await walk(path.join(webRoot, "components"));
  const globals = "app/globals.css";
  return found.sort((a, b) =>
    a.file === globals ? -1 : b.file === globals ? 1 : a.file.localeCompare(b.file),
  );
}

/** One selector of one rule that declares custom properties. `.a, .b { --x }` yields two. */
type TokenRoot = { file: string; line: number; selector: string; props: Map<string, string> };

function parseTokenRoots(sheets: { file: string; css: string }[]): TokenRoot[] {
  const postcss = loadPostcss();
  const roots: TokenRoot[] = [];
  for (const { file, css } of sheets) {
    postcss.parse(css).walkRules((rule) => {
      const props = new Map<string, string>();
      rule.each((node) => {
        if (node.type === "decl" && node.prop?.startsWith("--")) props.set(node.prop, (node.value ?? "").trim());
      });
      if (props.size === 0) return;
      for (const selector of postcss.list.comma(rule.selector)) {
        roots.push({ file, line: rule.source?.start?.line ?? 0, selector: selector.replace(/\s+/g, " ").trim(), props });
      }
    });
  }
  return roots;
}

const isGbRoot = (selector: string) => /(^|[\s>+~])\.gb(\.|\[|$|[\s>+~])/.test(selector) || selector.includes(".gb.");
const isDarkRoot = (selector: string) => /\.dark(\.|\[|$|[\s>+~])/.test(selector) || /\[data-theme=["']?dark/.test(selector);

/**
 * CSS specificity, [ids, classes+attributes+pseudo-classes, elements+pseudo-elements].
 * Deliberately simple: it is only ever applied to token-root selectors, and
 * `assertCalculableSelectors` below refuses to let a shape it cannot count (`:where()`,
 * `:not()`, `:is()`) reach it silently.
 */
function specificity(selector: string): [number, number, number] {
  let ids = 0;
  let classes = 0;
  let elements = 0;
  const stripped = selector
    .replace(/\[[^\]]*\]/g, () => { classes += 1; return " "; })
    .replace(/::[a-zA-Z-]+/g, () => { elements += 1; return " "; })
    .replace(/:[a-zA-Z-]+(\([^()]*\))?/g, () => { classes += 1; return " "; })
    .replace(/#[\w-]+/g, () => { ids += 1; return " "; })
    .replace(/\.[\w-]+/g, () => { classes += 1; return " "; });
  for (const token of stripped.split(/[\s>+~]+/)) {
    if (/^[a-zA-Z][\w-]*$/.test(token)) elements += 1;
  }
  return [ids, classes, elements];
}

function compareRank(left: number[], right: number[]): number {
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

const outranks = (left: string, right: string) =>
  compareRank(specificity(left), specificity(right)) > 0;

/** Only classes, attributes, descendant combinators — the shapes `specificity` counts exactly. */
function assertCalculableSelectors(roots: TokenRoot[]): void {
  for (const root of roots) {
    expect(root.selector, `${root.file}:${root.line} uses a selector shape the specificity calculator cannot count`)
      .toMatch(/^[\w.\-\s[\]"'=]+$/);
  }
}

/**
 * The DOM next-themes actually produces: the class on <html>, `gb` on <body>, and the root
 * under test as a nested element carrying its own compound. This is the shape the P1 hid in.
 * A fresh document rather than the ambient one so the fixture cannot pick up anything a
 * neighbouring test left on the page.
 */
function darkDocument(): Document {
  const page = document.implementation.createHTMLDocument("dark page");
  page.documentElement.className = "dark";
  page.body.className = "gb";
  return page;
}

/** Build the element a light root claims, and hang it under <body class="gb"> in a dark page. */
function subjectFor(selector: string, document: Document): Element {
  const compound = selector.split(/[\s>+~]+/).filter(Boolean).pop() ?? selector;
  const element = document.createElement("div");
  for (const [, className] of compound.matchAll(/\.([\w-]+)/g)) element.classList.add(className);
  for (const [, name, value] of compound.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)) {
    element.setAttribute(name, value ?? "");
  }
  document.body.appendChild(element);
  return element;
}

/**
 * Resolve one custom property the way the cascade does: on each element from the subject
 * upwards, the matching declaration with the highest (specificity, source order) wins; if no
 * rule declares it on that element, inheritance carries the search to the parent. Inheritance
 * is not a nicety here — it is exactly how a half-fixed root produces an unreadable page: the
 * scoped light root re-declared `--background` while `--foreground` kept inheriting the dark
 * value from <body>.
 */
function resolveVar(subject: Element, property: string, roots: TokenRoot[]): string | undefined {
  for (let node: Element | null = subject; node; node = node.parentElement) {
    let winner: string | undefined;
    let winnerRank: number[] | undefined;
    roots.forEach((root, order) => {
      const value = root.props.get(property);
      if (value === undefined || !node!.matches(root.selector)) return;
      const rank = [...specificity(root.selector), order];
      if (!winnerRank || compareRank(rank, winnerRank) > 0) {
        winnerRank = rank;
        winner = value;
      }
    });
    if (winner !== undefined) return winner;
  }
  return undefined;
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

describe("#804 — EVERY .gb token root is actually reachable in dark", () => {
  /**
   * §K3 describes `.dark` landing "next to .gb" on <body>. next-themes cannot do that: it
   * writes its class on <html> and nothing else. A same-element selector would therefore
   * have compiled, shipped, and matched nothing — the same shape of silent failure the
   * ticket exists to end. The r1 version of this file checked that ONE global selector
   * string, which is why `.gb.ns-immersive` slipped past it; these enumerate instead.
   */
  it("the specificity calculator is right — it is what decides every verdict below", () => {
    expect(specificity(".gb")).toEqual([0, 1, 0]);
    expect(specificity(".dark .gb")).toEqual([0, 2, 0]);
    expect(specificity(".gb.ns-immersive")).toEqual([0, 2, 0]);
    expect(specificity('.gb[data-theme="dark"]')).toEqual([0, 2, 0]);
    expect(specificity(".dark .gb.ns-immersive")).toEqual([0, 3, 0]);
    expect(specificity("html body.gb::after")).toEqual([0, 1, 3]);
    // A tie is NOT a win: ties go to load order, and the route layer loads last.
    expect(outranks(".dark .gb", ".gb.ns-immersive")).toBe(false);
    expect(outranks(".dark .gb.ns-immersive", ".gb.ns-immersive")).toBe(true);
  });

  it("each light .gb root has a dark mirror that both matches it under html.dark and outranks it", async () => {
    const roots = parseTokenRoots(await shippedStylesheets()).filter((root) => isGbRoot(root.selector));
    assertCalculableSelectors(roots);

    const light = roots.filter((root) => !isDarkRoot(root.selector));
    const dark = roots.filter((root) => isDarkRoot(root.selector));
    // An empty walk is the failure mode this whole rewrite exists to end: it would report
    // "no unreachable roots" and mean "I read nothing".
    expect(light.map((root) => root.selector), "the walker found no .gb light token root").toContain(".gb");
    expect(dark.length, "the walker found no .gb dark token root").toBeGreaterThan(0);

    const document = darkDocument();
    const unreachable = light
      .filter((root) => {
        const subject = subjectFor(root.selector, document);
        return !dark.some((mirror) => subject.matches(mirror.selector) && outranks(mirror.selector, root.selector));
      })
      .map((root) => `${root.file}:${root.line}  ${root.selector}  (${specificity(root.selector).join(",")})`);

    expect(unreachable, "these token roots keep their LIGHT values on a dark page").toEqual([]);
  });

  it("no light root declares a hex token its reachable dark mirror forgets", async () => {
    const roots = parseTokenRoots(await shippedStylesheets()).filter((root) => isGbRoot(root.selector));
    const dark = roots.filter((root) => isDarkRoot(root.selector));
    const document = darkDocument();

    const orphans: string[] = [];
    for (const root of roots.filter((candidate) => !isDarkRoot(candidate.selector))) {
      const subject = subjectFor(root.selector, document);
      const mirrors = dark.filter((mirror) => subject.matches(mirror.selector) && outranks(mirror.selector, root.selector));
      for (const [property, value] of root.props) {
        // Only literals: `--font-sans`, `--radius`, the easings and durations are meant to be
        // inherited by the dark page, and the shadow tokens have their own wire (⑤).
        if (!/#[0-9a-f]{3,8}\b/i.test(value)) continue;
        if (!mirrors.some((mirror) => mirror.props.has(property))) {
          orphans.push(`${root.file}:${root.line}  ${root.selector} { ${property}: ${value} }`);
        }
      }
    }
    expect(orphans, "these tokens stay at their light literal on a dark page").toEqual([]);
  });

  /**
   * The r1 defect, pinned as its own shape rather than as its selector: an ancestor carries
   * `.dark`, and a token root that loads LATER re-declares `--background` without
   * `--foreground`. Before the fix this resolved to #FAFAFA type on a #F5F6F8 ground —
   * 1.04:1 — on /northstar-immersive, a route that is live to customers. Both load orders
   * are checked because the whole failure was a specificity tie broken by order: a fix that
   * only works because the sheets happen to load in one order is not a fix.
   */
  it("no .gb root resolves to an unreadable ground/type pair in dark, in either load order", async () => {
    const sheets = await shippedStylesheets();
    for (const [label, ordered] of [
      ["root layout first, route layer second (what ships)", sheets],
      ["reversed", [...sheets].reverse()],
    ] as const) {
      const all = parseTokenRoots(ordered);
      const document = darkDocument();
      for (const root of all.filter((candidate) => isGbRoot(candidate.selector) && !isDarkRoot(candidate.selector))) {
        const subject = subjectFor(root.selector, document);
        const ground = resolveVar(subject, "--background", all);
        const type = resolveVar(subject, "--foreground", all);
        const where = `${label} — ${root.file}:${root.line} ${root.selector}`;
        expect(ground, where).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(type, where).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(contrastRatio(type!, ground!), where).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("`gb` is on <body> while the theme class is on <html> — the reason for all of the above", async () => {
    expect(await readLayout()).toContain('<body className="gb');
  });

  it("no .gb-scoped recipe still paints a raw colour that cannot follow the theme (§K4)", async () => {
    const css = await readGlobals();
    // Comments carry the retirement record (which literal was replaced by which token), so
    // they are stripped structurally before the fence reads the file.
    const postcss = loadPostcss();

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
