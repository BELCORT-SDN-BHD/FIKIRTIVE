/**
 * B0-28 — the fence around the ONE page in this product that renders for a caller with no session
 * and no account.
 *
 * The page's safety is not a property of the page. It is a property of what the page can REACH:
 * a server component renders whatever it imports, so one convenient `import { getProjects } from
 * "@/lib/data"` added by a future author is all it takes to put a merchant's workspace on a URL
 * anyone can forward. Reviewers do not reliably notice an added import; a machine does.
 *
 * So this file walks the page's transitive import graph — every `@/…` and relative module it can
 * reach, at any depth — and pins the WHOLE set. Not a deny-list of scary names (a deny-list only
 * knows the modules that existed when it was written), the exact closure: anything new that
 * appears there fails this test and has to be argued for in a diff.
 *
 * The second half pins the other way this page can quietly break: a `layout.tsx` above it. W2
 * builds the merchant's calendar at `/schedule`, and a layout there runs for THIS page too — an
 * auth gate in it would send every reviewer to /login, restoring the dead end the page exists to
 * remove, with nothing in the page's own file changed.
 *
 * 红→绿演练(both performed, then reverted):
 *   · add `import { getProjects } from "@/lib/data"` to the page ⇒ first gate red, naming
 *     `lib/data.ts` as an unapproved module in the closure;
 *   · add `apps/web/app/schedule/layout.tsx` that calls `requireOwner()` ⇒ second gate red.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const PAGE = "app/schedule/share-preview/page.tsx";

/**
 * EXACTLY what the public preview page may reach, and why each one is allowed to be there.
 *
 * Adding a line here is the decision this test exists to force someone to make in writing.
 */
const ALLOWED_CLOSURE = [
  PAGE,
  // The only data module. Reads the one post the token attests, and nothing else.
  "lib/share-preview-view.ts",
  // The two-layer verification (HMAC ∧ live mint row) that authorizes the whole page.
  "lib/share-preview.ts",
  // The public-door rate gate, and the caller identity it counts.
  "lib/rate-limit-gates.ts",
  "lib/caller-identity.ts",
  // Presentation only — shadcn primitives and the class merger.
  "components/ui/badge.tsx",
  "components/ui/card.tsx",
  "components/ui/separator.tsx",
  "lib/utils.ts",
].sort();

/** Every module specifier in a file, from static imports, `export … from`, and dynamic import(). */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s[^;]*?from\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

/** Resolve a specifier to a repo-relative file inside apps/web, or null for an external package. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(WEB_ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(WEB_ROOT, path.dirname(fromFile), specifier);
  else return null; // an npm package or a workspace package — not part of this app's own graph
  for (const candidate of [`${base}.ts`, `${base}.tsx`, base, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(WEB_ROOT, candidate);
    }
  }
  return null;
}

/** Every module inside apps/web the page can reach, at any depth. */
function importClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(path.join(WEB_ROOT, file), "utf8");
    for (const specifier of specifiers(source)) {
      const resolved = resolveLocal(specifier, file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen].sort();
}

describe("the public share-preview page reaches nothing it does not need", () => {
  it("its whole import closure is the approved set — not one module more", () => {
    expect(importClosure(PAGE)).toEqual(ALLOWED_CLOSURE);
  });

  /**
   * The same fact said a second way, because the first assertion is only as loud as its diff.
   * These are the app's list-shaped and session-shaped modules: any of them appearing in a
   * session-less page's graph is the defect this whole fence is about, and naming them makes the
   * failure message say WHY rather than just "the set changed".
   */
  it("in particular it cannot reach any list, any session gate, or any write path", () => {
    const closure = importClosure(PAGE);
    const forbidden = [
      "lib/data.ts", // getProjects / getGenerationThumbs / every workspace list
      "lib/actions.ts",
      "lib/auth-guard.ts", // a session gate has no meaning on a seat-less page
      "lib/schedule-actions.ts", // the WRITE side, including the minting action
      "lib/otto-actions.ts",
      "lib/admin-actions.ts",
      "lib/crm-actions.ts",
      "lib/campaign-actions.ts",
      "lib/billing-actions.ts",
      "lib/storage.ts", // media goes through the signed proxy; the page never touches a bucket
    ];
    expect(closure.filter((file) => forbidden.includes(file))).toEqual([]);
  });

  it("reads its data from exactly one module, so there is one place to review", () => {
    const dataModules = importClosure(PAGE).filter(
      (file) => file.startsWith("lib/") && file !== "lib/utils.ts" && file !== "lib/caller-identity.ts",
    );
    expect(dataModules).toEqual(["lib/rate-limit-gates.ts", "lib/share-preview-view.ts", "lib/share-preview.ts"]);
  });
});

describe("nothing above the page may gate it", () => {
  /** Every layout Next would run for /schedule/share-preview, outermost first. */
  const LAYOUTS_ABOVE = ["app/layout.tsx", "app/schedule/layout.tsx", "app/schedule/share-preview/layout.tsx"];

  it("no layout between the app root and this page turns it back into a signed-in surface", () => {
    const gated = LAYOUTS_ABOVE.filter((file) => {
      const full = path.join(WEB_ROOT, file);
      if (!fs.existsSync(full)) return false;
      const source = fs.readFileSync(full, "utf8");
      return /requireOwner|getSession|redirect\(\s*["']\/login/.test(source);
    });
    expect(gated).toEqual([]);
  });
});
