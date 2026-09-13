// #1356 P2 (judge review on PR #1428): the file list wired into ci.yml's `docsscan`
// job used to be a HAND-PLOTTED inventory — "grep for a docs/ mention, then read each
// hit to confirm" — with no machine behind it, and that is exactly how it went stale
// on the first pass: two real docs-content readers (founder-alert-docs.test.ts,
// reconcile-actions.test.ts) were missed, because their readFileSync call and their
// "docs/…" string literal sit behind a local `read(...)` helper on two different
// lines, not adjacent to each other the way the other five files' do.
//
// This test re-derives the inventory independently, by the GENERAL signature every
// confirmed file shares: a readFileSync/readdirSync/readFile( call, plus a quoted
// string literal containing "docs/" or the bare token "docs", both OUTSIDE comments —
// and refuses to let the wired list in ci.yml and this re-derivation disagree, in
// either direction. A file added to one side without the other is red.
//
// THE HEURISTIC IS NOT AN AST — it is a comment-stripped regex scan, the same class of
// tool the original inventory was built with, just applied uniformly instead of by
// eye. It over-matches on strings that merely CONTAIN "docs/…" as prose rather than as
// a real read target (e.g. a `why:` field explaining a Founder ruling by name) — the
// EXEMPTIONS map below is where those are named, one at a time, with why each is not a
// real docs/** content reader. An exemption whose file no longer matches the heuristic
// at all is itself an error (nothing left to exempt), so this cannot rot into a list of
// stale entries either.
//
// Run: node --test scripts/__tests__/docs-scan-inventory.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "ci.yml");

function existsSafe(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

// ── candidates: re-derived from source, independent of ci.yml ────────────────────

const TEST_FILE_RE = /\.test\.(ts|tsx|mjs|js)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", ".git"]);
const SCAN_ROOTS = ["apps", "packages", "scripts"];

function testFilesUnder(dir, out = []) {
  if (!existsSafe(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      testFilesUnder(full, out);
    } else if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Comments stripped before either pattern is tested, so a docs/specs/… path cited in
// prose (a JSDoc header, a `//` note) does not count as a read target — the same
// reason quality-legs.test.sh strips YAML/shell comments before its own scans.
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /(^|[^:])\/\/.*$/gm; // never strip after `:` — keeps `https://` intact
function stripComments(source) {
  return source.replace(BLOCK_COMMENT_RE, "").replace(LINE_COMMENT_RE, "$1");
}

const FS_READ_RE = /readFileSync|readdirSync|readFile\(/;
// Either a quoted string containing "docs/" (design-system-data-patterns.test.ts:
// "../../docs/brand/colors.json"), or a bare quoted "docs" used as one path.join/
// resolve segment among others (northstar-shell-purge.test.ts's FLAG_SCAN_ROOTS,
// otto-engine's join(HERE, "..", "..", "..", "docs", "specs", "otto-engine.md")).
const DOCS_LITERAL_RE = /["'`][^"'`]*docs\/[^"'`]*["'`]|["'`]docs["'`]/;

// Known false positives the heuristic cannot itself tell apart from a real read: a
// quoted "docs/…" string that is prose, not a path ever passed to a read call. Each
// entry says which, and why.
const EXEMPTIONS = new Map([
  [
    "apps/web/lib/__tests__/product-vocabulary-fence.test.ts",
    "its readFileSync/readdirSync calls never target docs/** — the only docs/ mention " +
      'is prose inside a `why:` exemption string ("已登记 docs/specs/frontend-baseline.md ' +
      '§5 等 Founder 裁"), never a path argument to a read call.',
  ],
]);

function findCandidates() {
  const out = new Set();
  for (const root of SCAN_ROOTS) {
    for (const file of testFilesUnder(join(REPO_ROOT, root))) {
      const source = readFileSync(file, "utf8");
      const stripped = stripComments(source);
      if (FS_READ_RE.test(stripped) && DOCS_LITERAL_RE.test(stripped)) {
        out.add(relative(REPO_ROOT, file));
      }
    }
  }
  return out;
}

// ── wired: re-derived from ci.yml's docsscan job ──────────────────────────────────

// Each package's directory, read from its OWN package.json "name" field rather than
// hand-mapped, so this does not drift from pnpm-workspace.yaml by hand.
function packageDirs() {
  const map = new Map();
  for (const root of ["apps", "packages"]) {
    for (const entry of readdirSync(join(REPO_ROOT, root), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = join(REPO_ROOT, root, entry.name, "package.json");
      if (!existsSafe(pkgJsonPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      if (pkg.name) map.set(pkg.name, `${root}/${entry.name}`);
    }
  }
  return map;
}

// The docsscan job's `vitest run` steps are one-line `run:` scripts (not YAML block
// scalars), so a regex over the raw file is exact for this one job — no YAML parser
// needed for three lines this test does not otherwise care about the shape of.
const VITEST_RUN_RE = /pnpm --filter (@fikirtive\/[a-z0-9-]+) exec vitest run (.+)$/gm;

function findWired() {
  const ciSource = readFileSync(WORKFLOW, "utf8");
  const dirs = packageDirs();
  const out = new Set();
  let match;
  while ((match = VITEST_RUN_RE.exec(ciSource)) !== null) {
    const pkgName = match[1];
    const dir = dirs.get(pkgName);
    if (!dir) {
      throw new Error(
        `docs-scan-inventory: ci.yml runs vitest in package '${pkgName}', which no ` +
          `apps/*/package.json or packages/*/package.json declares as its "name"`,
      );
    }
    for (const file of match[2].trim().split(/\s+/)) {
      out.add(`${dir}/${file}`);
    }
  }
  return out;
}

test("docsscan's wired file list matches the independently re-derived docs-content inventory", () => {
  const candidates = findCandidates();
  const wired = findWired();

  assert.ok(wired.size > 0, "ci.yml's docsscan job runs no 'vitest run' steps at all");

  // An exemption with nothing left to exempt is itself stale — the same discipline
  // northstar-shell-purge.test.ts's BANNED_COPY_EXEMPTIONS applies to itself.
  for (const [file, why] of EXEMPTIONS) {
    assert.ok(
      candidates.has(file),
      `exemption '${file}' no longer matches the heuristic (recorded reason: ${why}) — remove it, it has no object left to exempt`,
    );
  }

  const expected = [...candidates].filter((f) => !EXEMPTIONS.has(f)).sort();
  const actual = [...wired].sort();

  const missingFromCiYml = expected.filter((f) => !wired.has(f));
  const notActuallyDocsContent = actual.filter((f) => !candidates.has(f));

  const problems = [];
  if (missingFromCiYml.length > 0) {
    problems.push(
      "re-derived as reading docs/** content but NOT wired into ci.yml's docsscan job " +
        "(add it to a 'vitest run' step there, or add it to EXEMPTIONS above with why " +
        "it is a false positive):\n" +
        missingFromCiYml.map((f) => `    - ${f}`).join("\n"),
    );
  }
  if (notActuallyDocsContent.length > 0) {
    problems.push(
      "wired into ci.yml's docsscan job but this re-derivation no longer finds it reading " +
        "docs/** content (it may have been edited to stop, or the heuristic needs a wider " +
        "pattern — read the file before deciding which):\n" +
        notActuallyDocsContent.map((f) => `    + ${f}`).join("\n"),
    );
  }

  assert.equal(
    problems.length,
    0,
    "docs-scan-inventory: the file list wired into ci.yml's docsscan job and this " +
      "test's independent re-derivation disagree:\n\n" +
      problems.join("\n\n"),
  );
});
