/**
 * B0-28 — the fence around the ONE page in this product that renders for a caller with no session
 * and no account.
 *
 * The page's safety is not a property of the page. It is a property of what the page can REACH:
 * a server component renders whatever it imports, so one convenient `import { getProjects } from
 * "@/lib/data"` added by a future author is all it takes to put a merchant's workspace on a URL
 * anyone can forward. Reviewers do not reliably notice an added import; a machine does.
 *
 * So this file walks the page's transitive import graph and pins the WHOLE thing. Not a deny-list
 * of scary names (a deny-list only knows the modules that existed when it was written), the exact
 * closure: anything new that appears there fails this test and has to be argued for in a diff.
 *
 * ── WHAT r1 GOT WRONG, AND WHY THE SHAPE CHANGED ─────────────────────────────────────────────
 * r1 pinned only the modules INSIDE apps/web, and resolved every other specifier to `null` — so
 * `@fikirtive/db` was invisible to it. The judge put `import { prisma } from "@fikirtive/db"`
 * straight into the page and watched all four gates stay green: the fence was blind to the one
 * import that matters most. Listing the package alongside the modules would not have fixed it
 * either, because `lib/share-preview-view.ts` legitimately imports the same package — a flat set
 * cannot tell the reviewed data module apart from the page.
 *
 * So what is pinned now is the EDGE, not the name: `<file> → <specifier>`, for every specifier
 * that leaves this app. "Who may reach the database" is then a fact this file states, and the
 * page is not on that list.
 *
 * ── THE OTHER TWO WAYS THIS PAGE CAN QUIETLY STOP BEING PUBLIC ───────────────────────────────
 * · A `layout.tsx` above it. W2 builds the merchant's calendar at `/schedule`, and a layout there
 *   runs for THIS page too — an auth gate up there would send every reviewer to /login with
 *   nothing in the page's own file changed.
 * · The merchant SHELL. `isMerchantSurface` matches by path PREFIX, so the moment W2-11 puts
 *   `/schedule` into `merchantNavLinks()`, this anonymous page inherits the whole signed-in
 *   chrome — nav rail, identity menu, sign-out — around a post shown to somebody who has no
 *   account. That is a one-line change in another ticket's file, and nothing here would have
 *   noticed. The assertion below is the alarm bell, not the fix: whoever flips that switch owes
 *   this page its own layout or an exclusion in `isMerchantSurface`.
 *
 * 红→绿演练(all performed, then reverted):
 *   · add `import { getProjects } from "@/lib/data"` to the page ⇒ module gate red, naming
 *     `lib/data.ts`;
 *   · add `import { prisma } from "@fikirtive/db"` to the page ⇒ edge gate red AND the
 *     database-reach gate red, naming the page (r1 stayed 4/4 GREEN on this one);
 *   · add `apps/web/app/schedule/layout.tsx` that calls `requireOwner()` ⇒ layout gate red;
 *   · add `/schedule` to MERCHANT_NAV ⇒ shell gate red.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/otto"),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));
vi.mock("@/lib/tenant-actions", () => ({ stopImpersonatingTenant: vi.fn() }));

const { isMerchantSurface } = await import("@/components/global-navigation");

const WEB_ROOT = path.resolve(__dirname, "../..");
const PAGE = "app/schedule/share-preview/page.tsx";

/**
 * EXACTLY which files inside apps/web the public page may reach, and why each is allowed.
 *
 * Adding a line here is the decision this test exists to force someone to make in writing.
 */
const ALLOWED_MODULES = [
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

/**
 * EXACTLY which module each of those files may reach OUTSIDE this app — the half r1 could not
 * see. Read it as a sentence: this file, may import, that package. The database appears three
 * times and the page is not one of them.
 */
const ALLOWED_EXTERNAL_IMPORTS = [
  // The page itself: the publish-truth authority, and the request headers it reads the token from.
  `${PAGE} → @fikirtive/core/schedule-draft`,
  `${PAGE} → next/headers`,
  // The data module: the client, the token signer/verifier, the storage-key + channel-label helpers.
  "lib/share-preview-view.ts → @fikirtive/core",
  "lib/share-preview-view.ts → @fikirtive/core/schedule-draft",
  "lib/share-preview-view.ts → @fikirtive/db",
  "lib/share-preview-view.ts → @fikirtive/token-crypto",
  "lib/share-preview-view.ts → server-only",
  // The authority layer: the mint-row lookup and the HMAC it is paired with.
  "lib/share-preview.ts → @fikirtive/db",
  "lib/share-preview.ts → @fikirtive/token-crypto",
  "lib/share-preview.ts → node:crypto",
  "lib/share-preview.ts → server-only",
  // The rate gate: the shared counter, not the client barrel.
  "lib/rate-limit-gates.ts → @fikirtive/db/rate-limit",
  "lib/rate-limit-gates.ts → server-only",
  "lib/caller-identity.ts → node:net",
  // Presentation only.
  "components/ui/badge.tsx → class-variance-authority",
  "components/ui/badge.tsx → @base-ui/react/merge-props",
  "components/ui/badge.tsx → @base-ui/react/use-render",
  "components/ui/badge.tsx → react",
  "components/ui/card.tsx → react",
  "components/ui/separator.tsx → @base-ui/react/separator",
  "lib/utils.ts → clsx",
  "lib/utils.ts → tailwind-merge",
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

/** Resolve a specifier to a file inside apps/web, or null when it leaves this app. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(WEB_ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(WEB_ROOT, path.dirname(fromFile), specifier);
  else return null; // a workspace package, an npm package or a node builtin — recorded as an edge
  for (const candidate of [`${base}.ts`, `${base}.tsx`, base, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(WEB_ROOT, candidate);
    }
  }
  return null;
}

/**
 * Everything the page can reach, at any depth: the files inside this app, AND every
 * `<file> → <specifier>` edge that leaves it. Both halves are needed — the modules alone were
 * exactly r1's blind spot.
 */
function importClosure(entry: string): { modules: string[]; external: string[] } {
  const modules = new Set<string>();
  const external = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (modules.has(file)) continue;
    modules.add(file);
    const source = fs.readFileSync(path.join(WEB_ROOT, file), "utf8");
    for (const specifier of specifiers(source)) {
      const resolved = resolveLocal(specifier, file);
      if (resolved) {
        if (!modules.has(resolved)) queue.push(resolved);
      } else {
        external.add(`${file} → ${specifier}`);
      }
    }
  }
  return { modules: [...modules].sort(), external: [...external].sort() };
}

describe("the public share-preview page reaches nothing it does not need", () => {
  it("every file it can reach inside this app is on the approved list — not one more", () => {
    expect(importClosure(PAGE).modules).toEqual(ALLOWED_MODULES);
  });

  it("every import that LEAVES this app is on the approved list — not one more", () => {
    expect(importClosure(PAGE).external).toEqual(ALLOWED_EXTERNAL_IMPORTS);
  });

  /**
   * The database, said on its own so the failure message says WHY.
   *
   * `@fikirtive/db` hands out the Prisma client; `@fikirtive/db/rate-limit` hands out the shared
   * counter, which needs it too. Three files may hold either, and each of the three is a module a
   * reviewer has read for this exact purpose. THE PAGE IS NOT ONE OF THEM: a server component
   * that can query is a server component that can query anything.
   */
  it("only the reviewed data modules can reach the database — never the page itself", () => {
    const reachesDb = importClosure(PAGE)
      .external.filter((edge) => / → @fikirtive\/db(\/|$)/.test(edge))
      .map((edge) => edge.split(" → ")[0]!);
    expect([...new Set(reachesDb)].sort()).toEqual([
      "lib/rate-limit-gates.ts", // the counter behind the public-door gate
      "lib/share-preview-view.ts", // the one post + its own media
      "lib/share-preview.ts", // the mint row that authorizes the whole page
    ]);
    expect(reachesDb).not.toContain(PAGE);
  });

  /**
   * The same fact said a third way, because a set-equality diff is only as loud as its reader.
   * These are the app's list-shaped and session-shaped modules: any of them appearing in a
   * session-less page's graph is the defect this whole fence is about, and naming them makes the
   * failure say why rather than just "the set changed".
   */
  it("in particular it cannot reach any list, any session gate, or any write path", () => {
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
    expect(importClosure(PAGE).modules.filter((file) => forbidden.includes(file))).toEqual([]);
  });

  it("reads its data from exactly one module, so there is one place to review", () => {
    const dataModules = importClosure(PAGE).modules.filter(
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

describe("the merchant shell must never wrap this page", () => {
  /**
   * THE ALARM BELL FOR W2-11 (judge r1 P2-3).
   *
   * `isMerchantSurface` matches by path PREFIX (`pathMatches`: `startsWith(target + "/")`), and
   * `MERCHANT_SURFACE_PATHS` is derived from `merchantNavLinks()`. `SHELL_ROUTES.schedule` is
   * already `/schedule` in `@fikirtive/core/navigation`, waiting for W2-11 to wire it into the
   * nav — and on that day `/schedule/share-preview` becomes a merchant surface for free.
   *
   * What that would ship: a nav rail, an identity menu and a SIGN-OUT button drawn around a post
   * shown to a client who has no account, on a page whose whole premise is that there is nothing
   * here to press. Nobody would have decided it; a prefix would have.
   *
   * This assertion cannot prevent it and does not try. It makes the day it happens a red CI run
   * on W2-11's own branch, with this comment attached, instead of a quiet regression discovered
   * by whoever the merchant sent the link to.
   */
  it("isMerchantSurface says no — and must keep saying no when /schedule becomes a real route", () => {
    expect(isMerchantSurface("/schedule/share-preview")).toBe(false);
  });

  // 判官修复轮 P3-1:警铃只钉了裸路径本身,两个变异样本补上豁免的真实形状——
  // exclusion 是路径段前缀(`startsWith(target + "/")`),不是字符串前缀。
  it("a sub-path of the carve-out stays exempt too (/schedule/share-preview/<token>)", () => {
    expect(isMerchantSurface("/schedule/share-preview/abc123")).toBe(false);
  });

  it("a same-prefix sibling is NOT a carve-out; shell ownership is decided independently", () => {
    // Schedule 本身在 Beta 已 parked,所以这个 sibling 仍然没有 merchant shell。
    expect(isMerchantSurface("/schedule/share-previewx")).toBe(false);
    // Create 是 active owner:真正的 Canvas 子树无壳,同字串 sibling 仍由 Create 的壳接住。
    expect(isMerchantSurface("/create/canvas/example")).toBe(false);
    expect(isMerchantSurface("/create/canvasx")).toBe(true);
  });

  it("the page renders no shell of its own either — no nav, no identity menu, no sign-out", () => {
    const source = fs.readFileSync(path.join(WEB_ROOT, PAGE), "utf8");
    for (const forbidden of ["GlobalNavigation", "MerchantShell", "signOut", "SectionTabs"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
