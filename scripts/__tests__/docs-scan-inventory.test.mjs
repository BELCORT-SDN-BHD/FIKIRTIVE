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
//
// THE OPENING `/*` MUST START ITS OWN LINE (judge review on PR #1428, P2): an
// unanchored `\/\*[\s\S]*?\*\// let a STRING containing "docs/**" fake a block-comment
// opener — the two characters "/*" sitting inside prose like `"see docs/** for…"` — and
// the non-greedy match then ran to the NEXT unrelated "*/" anywhere later in the file,
// silently deleting every real readFileSync call and docs/ literal in between. This
// file caught itself: line 20's own `// … real docs/** content reader.` opened a fake
// comment that a later `*/package.json"` string closed, eating the EXEMPTIONS map, both
// pattern definitions, and findCandidates() itself — which is why FS_READ_RE stopped
// matching THIS file's own stripped source (verified by hand before this fix). Anchoring
// the opener to line-start (optional leading whitespace only) means a `/*` embedded
// mid-line in a string can never start a comment span — only a real, line-leading block
// comment can. See the fixture test below, which pins this shape down directly.
const BLOCK_COMMENT_RE = /(^|\n)\s*\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /(^|[^:])\/\/.*$/gm; // never strip after `:` — keeps `https://` intact
function stripComments(source) {
  return source.replace(BLOCK_COMMENT_RE, "$1").replace(LINE_COMMENT_RE, "$1");
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
  [
    "scripts/__tests__/docs-scan-inventory.test.mjs",
    "this file's own readFileSync/readdirSync calls read ci.yml, package.json files under " +
      "apps/*/packages/*, and other test source files it scans for the SAME heuristic — " +
      "never docs/** content. The docs/ literal the heuristic finds here is this file's own " +
      "regex source, EXEMPTIONS reasoning, and fixture strings describing what a docs/** " +
      "read looks like (the anchored-BLOCK_COMMENT_RE fix above), never a path argument to " +
      "a read call. Became a candidate only once the BLOCK_COMMENT_RE anchor fix stopped " +
      "this file's own header comment from fake-opening a block comment over its own body.",
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
// scalars), so a regex over the raw file — once YAML `#` comments are stripped, below —
// finds exactly these three lines. NOT "a regex over the raw file is exact" outright
// (judge review on PR #1428, P3): without stripping, a step COMMENTED OUT of the
// docsscan job (`# run: pnpm --filter … vitest run …`) still matched this regex and
// counted as wired — self-description too strong, even though quality-legs.test.sh's
// 3e byte-for-byte canonical comparison already catches any such edit to ci.yml
// separately, which is why this went unexploited. Stripped here anyway, so this file's
// own claim matches what it actually checks.
const YAML_COMMENT_RE = /(^|\s)#.*$/gm; // a `#` at line-start or after whitespace runs to EOL
function stripYamlComments(source) {
  return source.replace(YAML_COMMENT_RE, "$1");
}

const VITEST_RUN_RE = /pnpm --filter (@fikirtive\/[a-z0-9-]+) exec vitest run (.+)$/gm;

function findWired() {
  const ciSource = stripYamlComments(readFileSync(WORKFLOW, "utf8"));
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

// ── regression: the B shape (judge review on PR #1428, P2) ───────────────────────
//
// Reproduces the exact shape scripts/__tests__/docs-scan-inventory.test.mjs (THIS
// file, before the anchor fix above) carried for real: a string mentioning "docs/**"
// as prose supplies a fake block-comment OPENER (the two characters "/*" sitting
// inside it), and a later, unrelated string containing "*/" supplies the CLOSER —
// silently deleting every real readFileSync call and docs/ literal sitting between
// the two, including the ones a fixed reviewer would expect this very heuristic to
// catch. Pinned directly against stripComments() so a future change to either regex
// cannot reopen this hole without failing here first.
test("stripComments does not let a docs/** string fake a block-comment opener that swallows a real read between it and an unrelated later '*/' (the B shape)", () => {
  const fixture = [
    '// a comment mentioning docs/** as prose — contains the two chars "/*"',
    'const REAL_MARKER = "REAL_CODE_SURVIVED";',
    'const contents = readFileSync(join(HERE, "docs", "specs", "target.md"), "utf8");',
    'const glob = "apps/*/package.json"; // unrelated string that happens to contain */',
  ].join("\n");

  const stripped = stripComments(fixture);
  assert.ok(
    stripped.includes("REAL_MARKER"),
    "the docs/** mention above must not fake-open a block comment that swallows the " +
      "real code below it, up to the unrelated '*/' three lines down — got:\n" + stripped,
  );
  assert.ok(
    FS_READ_RE.test(stripped) && DOCS_LITERAL_RE.test(stripped),
    "a real readFileSync(…, \"docs/specs/target.md\") between a fake '/*' opener and an " +
      "unrelated later '*/' must still be found by the candidate heuristic — got:\n" + stripped,
  );
});

// ── regression: a commented-out docsscan step must not count as wired ────────────
// (judge review on PR #1428, P3 — findWired() used to scan ci.yml's raw text, so a
// step commented out of the docsscan job still matched VITEST_RUN_RE and counted as
// wired. Backstopped separately by quality-legs.test.sh's 3e byte-for-byte comparison,
// which is why this was never exploitable — but the fix belongs here too, so this
// file's own header comment stops overclaiming what the raw-text scan proves.)
test("stripYamlComments removes a commented-out 'vitest run' step so it cannot count as wired", () => {
  const fixture = [
    "      - name: docs-content gates — packages/example",
    "        # run: pnpm --filter @fikirtive/example exec vitest run src/rogue.test.ts",
    "      - name: docs-content gates — packages/core",
    "        run: pnpm --filter @fikirtive/core exec vitest run src/founder-alert-docs.test.ts",
  ].join("\n");

  const stripped = stripYamlComments(fixture);
  const matches = [...stripped.matchAll(VITEST_RUN_RE)];
  assert.equal(
    matches.length,
    1,
    "a step commented out with '#' must not match VITEST_RUN_RE — only the live " +
      "founder-alert-docs.test.ts step should — got matches:\n" +
      matches.map((m) => `    ${m[0]}`).join("\n"),
  );
  assert.match(matches[0][0], /founder-alert-docs\.test\.ts$/);
});
