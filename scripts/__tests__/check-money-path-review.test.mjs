import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Black-box (subprocess) tests: check-money-path-review.mjs is a CLI script that reads
// GITHUB_EVENT_PATH and runs `git` relative to its own cwd, exactly as GitHub Actions
// invokes it — so a real `node <script>` subprocess against a throwaway git fixture is
// the most faithful way to test it (no script changes needed to make it importable).
const SCRIPT_PATH = fileURLToPath(new URL("../ci/check-money-path-review.mjs", import.meta.url));
const SCRIPT = SCRIPT_PATH;

// One representative path from each of the three MONEY_PATH_FILES / MONEY_IN_FILES /
// MONEY_PATH_PREFIXES lists in the script — proves all three membership branches of
// moneyPaths() actually trigger the gate, not just the first one.
//
// #480 rework (sealed cross-family judge P2 #1 on PR #482): MONEY_OUT_FILE used to be
// "apps/web/lib/billing-actions.ts", which the script itself only lists under
// MONEY_IN_FILES — so the "FAIL: MONEY_PATH_FILES branch" case was silently re-testing
// money-in membership twice and never exercising a genuine money-OUT exact-file match.
// gen-actions.ts is MONEY_PATH_FILES-only and foundational (the direct-gen spend entry
// point) — it is not going anywhere near MONEY_IN_FILES.
const MONEY_OUT_FILE = "apps/web/lib/gen-actions.ts";
const MONEY_IN_FILE = "apps/web/lib/credit-actions.ts";
const MONEY_PREFIX_FILE = "packages/db/prisma/migrations/20260101000000_x/migration.sql";
const UNRELATED_FILE = "apps/web/lib/unrelated-feature.ts";
// Gate self-protection (#480 rework, judge P1 #3): one of the five files the gate now
// monitors about itself. check-money-path-review.mjs is the most direct case — the fixture
// stands in a dummy copy at the same path; the REAL script (SCRIPT) still runs the check.
const GATE_SELF_FILE = "scripts/ci/check-money-path-review.mjs";
// Round 3 (#480 rework, second sealed judge FAIL — comment 5088727861, P0): the four archive
// worker-guard scripts that only reject GENERATION_PROVIDER=fal (byteplus is real money too),
// and the direct CreditLedger writer whose DATABASE_URL guard is bypassed by
// DATABASE_URL_POOLED's priority in packages/db/src/index.ts.
const WORKER_GUARD_FILE = "scripts/archive/verify-gen-character-no-refs-worker.mjs";
const CREDIT_LEDGER_SCRIPT_FILE = "scripts/tools/seed-local-qa-data.mjs";

// Identity fixtures for the comment-based reviewer check (round 3, judge P1 "凭证署名不认证").
const GITHUB_REPO = "example-org/example-repo";
const PR_AUTHOR_LOGIN = "pr-author";
const REVIEWER_LOGIN = "trusted-reviewer";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function write(repo, path, contents) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

function commit(repo, message) {
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

// Builds a repo with a base commit (one file per list branch + one unrelated file, so
// diffs can touch any single one) and returns { repo, baseSha }.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "fikirtive-480-money-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "Money Gate Test"]);
  git(repo, ["config", "user.email", "money-gate@example.test"]);
  write(repo, MONEY_OUT_FILE, "export async function startGen() {}\n");
  write(repo, MONEY_IN_FILE, "export async function grantCredits() {}\n");
  write(repo, MONEY_PREFIX_FILE, "-- base migration\n");
  write(repo, UNRELATED_FILE, "export const label = \"base\";\n");
  write(repo, GATE_SELF_FILE, "// stand-in for the gate script itself\n");
  write(repo, WORKER_GUARD_FILE, "// stand-in for a fal-only worker guard script\n");
  write(repo, CREDIT_LEDGER_SCRIPT_FILE, "// stand-in for a direct CreditLedger writer\n");
  const baseSha = commit(repo, "base");
  return { repo, baseSha, root };
}

function prEvent(base, head, { number = 1, authorLogin = PR_AUTHOR_LOGIN } = {}) {
  return {
    pull_request: { number, base: { sha: base }, head: { sha: head }, user: { login: authorLogin } },
    repository: { full_name: GITHUB_REPO },
  };
}

// One GitHub-comments-API-shaped comment object.
function comment({ login = REVIEWER_LOGIN, association = "COLLABORATOR", body }) {
  return { user: { login }, author_association: association, body };
}

// Runs the gate as CI does: GITHUB_EVENT_PATH pointing at a pull_request payload, cwd set to
// the fixture repo, GITHUB_REPOSITORY set (the script falls back to it when the event payload
// lacks repository.full_name). `comments`, when given, is written to a fixture file and wired
// through MONEY_PATH_REVIEW_COMMENTS_FIXTURE — the ONLY way to drive the comment-verification
// logic offline (no real GitHub API access here). `comments: "unreadable"` points the env var at
// a path that does not exist, exercising the exact same catch block a real network failure hits.
function runGate(root, repo, event, { comments } = {}) {
  const eventPath = join(root, "480-event.json");
  writeFileSync(eventPath, JSON.stringify(event));
  const env = { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: GITHUB_REPO };
  if (comments === "unreadable") {
    env.MONEY_PATH_REVIEW_COMMENTS_FIXTURE = join(root, "480-does-not-exist.json");
  } else if (comments !== undefined) {
    const fixturePath = join(root, "480-comments-fixture.json");
    writeFileSync(fixturePath, JSON.stringify(comments));
    env.MONEY_PATH_REVIEW_COMMENTS_FIXTURE = fixturePath;
  }
  const result = spawnSync("node", [SCRIPT], { cwd: repo, encoding: "utf8", env });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("FAIL: a money-path file changed with no review comment, for every list branch", async (t) => {
  const cases = [
    ["MONEY_PATH_FILES", MONEY_OUT_FILE],
    ["MONEY_IN_FILES", MONEY_IN_FILE],
    ["MONEY_PATH_PREFIXES", MONEY_PREFIX_FILE],
    ["gate self-protection", GATE_SELF_FILE],
    ["round-3 worker-guard script", WORKER_GUARD_FILE],
    ["round-3 CreditLedger script", CREDIT_LEDGER_SCRIPT_FILE],
  ];
  for (const [label, path] of cases) {
    await t.test(label, (child) => {
      const { repo, root, baseSha } = fixture(child);
      write(repo, path, "// changed\n");
      const headSha = commit(repo, `touch ${path}`);
      const { status, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments: [] });
      assert.equal(status, 1, stderr);
      assert.match(stderr, /money-path-review: FAIL/);
      assert.match(stderr, new RegExp(`money-path file changed: ${escapeRegex(path)}`));
      assert.match(stderr, /MONEY-SAFETY-REVIEWED/);
    });
  }
});

test("PASS: a money-path file changed with a qualifying reviewer comment bound to the head SHA", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const comments = [comment({ body: `[MONEY-SAFETY-REVIEWED: alice @ ${headSha}]` })];
  const { status, stdout, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 0, stdout + stderr);
  assert.match(stdout, new RegExp(`money-path-review: PASS money path reviewed by alice \\(@${REVIEWER_LOGIN}\\)`));
});

test("FAIL: a stale token bound to an earlier SHA does not clear a later commit", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// first change\n");
  const staleHeadSha = commit(repo, "first money-out change");
  write(repo, MONEY_OUT_FILE, "// second change, unreviewed\n");
  const headSha = commit(repo, "second money-out change");
  const comments = [comment({ body: `[MONEY-SAFETY-REVIEWED: alice @ ${staleHeadSha}]` })];
  const { status, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 1, stderr);
  assert.match(stderr, /stamped .* but the current head is/);
  assert.match(stderr, /re-review the new commits and re-stamp/);
});

test("not triggered: only an out-of-list file changed", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, UNRELATED_FILE, "export const label = \"changed\";\n");
  const headSha = commit(repo, "touch unrelated file only");
  const { status, stdout } = runGate(root, repo, prEvent(baseSha, headSha));
  assert.equal(status, 0);
  assert.match(stdout, /money-path-review: PASS no money-path file in this pull request/);
});

test("local (no pull-request event): advisory NOTICE, never fails closed", (t) => {
  const { repo, baseSha } = fixture(t);
  git(repo, ["remote", "add", "origin", repo]);
  git(repo, ["update-ref", "refs/remotes/origin/main", baseSha]);
  write(repo, MONEY_OUT_FILE, "// local uncommitted-context change\n");
  commit(repo, "local money-out change");
  const result = spawnSync("node", [SCRIPT], { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_EVENT_PATH: "" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NOTICE this branch touches a money path/);
  assert.match(result.stdout, new RegExp(escapeRegex(MONEY_OUT_FILE)));
  assert.match(result.stdout, /local run is advisory; the same check is fail-closed on the pull request/);
});

// #480 rework — sealed cross-family judge findings on PR #482 (comments 5087841805 and
// 5088727861), each with its own red case below:

test("FAIL (P0 #3): renaming a listed file to an unlisted path does not clear the gate", (t) => {
  const { repo, root, baseSha } = fixture(t);
  git(repo, ["mv", MONEY_OUT_FILE, "apps/web/lib/renamed-unlisted-path.ts"]);
  const headSha = commit(repo, "rename money-out file to an unlisted path");
  const { status, stdout, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments: [] });
  assert.equal(status, 1, stdout + stderr);
  assert.match(stderr, /money-path-review: FAIL/);
  // --no-renames reports the OLD (listed) path as a deletion — that is what must trip the gate.
  assert.match(stderr, new RegExp(`money-path file changed: ${escapeRegex(MONEY_OUT_FILE)}`));
});

test("FAIL (P0 #3): deleting a listed file does not clear the gate", (t) => {
  const { repo, root, baseSha } = fixture(t);
  git(repo, ["rm", MONEY_OUT_FILE]);
  const headSha = commit(repo, "delete money-out file");
  const { status, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments: [] });
  assert.equal(status, 1, stderr);
  assert.match(stderr, new RegExp(`money-path file changed: ${escapeRegex(MONEY_OUT_FILE)}`));
});

test("FAIL (P1): a blank/whitespace-only reviewer name does not clear the gate", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const comments = [comment({ body: `[MONEY-SAFETY-REVIEWED:  @ ${headSha}]` })];
  const { status, stdout, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 1, stdout + stderr);
  assert.match(stderr, /blank reviewer/);
});

test("FAIL (P1): a short SHA prefix does not clear the gate", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const comments = [comment({ body: `[MONEY-SAFETY-REVIEWED: alice @ ${headSha.slice(0, 7)}]` })];
  const { status, stdout, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 1, stdout + stderr);
  // A 7-char SHA no longer matches TOKEN at all (it requires exactly 40 hex chars), so this
  // falls through to the standard no-qualifying-comment FAIL path.
  assert.match(stderr, /MONEY-SAFETY-REVIEWED/);
});

test("FAIL (P1): a malformed PR event fails closed instead of falling back to advisory", (t) => {
  const { repo } = fixture(t);
  const eventPath = join(repo, "..", "480-broken-event.json");
  writeFileSync(eventPath, "{ this is not valid JSON");
  const result = spawnSync("node", [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /money-path-review: FAIL/);
  assert.match(result.stderr, /could not be read or parsed/);
  assert.match(result.stderr, /failing closed/);
});

test("FAIL (P1): modifying the gate script itself does not clear the gate", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, GATE_SELF_FILE, "// pretend the monitored-file list was quietly narrowed\n");
  const headSha = commit(repo, "touch the gate script itself");
  const { status, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments: [] });
  assert.equal(status, 1, stderr);
  assert.match(stderr, new RegExp(`money-path file changed: ${escapeRegex(GATE_SELF_FILE)}`));
});

// Round 3 — second sealed cross-family judge FAIL (comment 5088727861):

test("FAIL (round-3 P1): a legitimate but structurally empty PR event under GITHUB_EVENT_NAME=pull_request fails closed", (t) => {
  const { repo } = fixture(t);
  const eventPath = join(repo, "..", "480-empty-pr-event.json");
  writeFileSync(eventPath, "{}");
  const result = spawnSync("node", [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: "pull_request" },
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /money-path-review: FAIL/);
  assert.match(result.stderr, /GITHUB_EVENT_NAME=pull_request but the event payload has no pull_request\.head\/base/);
  assert.match(result.stderr, /failing closed/);
});

test("PASS: the same structurally empty PR event WITHOUT GITHUB_EVENT_NAME=pull_request stays advisory", (t) => {
  const { repo } = fixture(t);
  const eventPath = join(repo, "..", "480-empty-nonpr-event.json");
  writeFileSync(eventPath, "{}");
  const result = spawnSync("node", [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: "push" },
  });
  // A genuine push event (or any non-pull_request event) legitimately has no pull_request
  // field — this must stay on the open, local-advisory path, not be swept up by the P1 fix.
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("FAIL (round-3 P1): a token comment authored by the PR's own author does not qualify", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const comments = [comment({ login: PR_AUTHOR_LOGIN, body: `[MONEY-SAFETY-REVIEWED: self @ ${headSha}]` })];
  const { status, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 1, stderr);
  assert.match(stderr, /only authored by the PR's own author/);
});

test("FAIL (round-3 P1): a token comment from a non-author without OWNER\\/MEMBER\\/COLLABORATOR standing does not qualify", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const comments = [
    comment({ login: "random-outside-account", association: "NONE", body: `[MONEY-SAFETY-REVIEWED: mallory @ ${headSha}]` }),
  ];
  const { status, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 1, stderr);
  assert.match(stderr, /no OWNER\/MEMBER\/COLLABORATOR standing/);
  assert.match(stderr, /author_association=NONE/);
});

test("PASS: an OWNER-association reviewer distinct from the author qualifies", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const comments = [comment({ login: "founder-account", association: "OWNER", body: `[MONEY-SAFETY-REVIEWED: founder @ ${headSha}]` })];
  const { status, stdout, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 0, stdout + stderr);
  assert.match(stdout, /money-path-review: PASS money path reviewed by founder \(@founder-account\)/);
});

test("PASS: scans past a self-authored decoy comment to find a real qualifying one", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const comments = [
    comment({ login: PR_AUTHOR_LOGIN, body: `[MONEY-SAFETY-REVIEWED: fake @ ${headSha}]` }),
    comment({ login: REVIEWER_LOGIN, body: `[MONEY-SAFETY-REVIEWED: real reviewer @ ${headSha}]` }),
  ];
  const { status, stdout, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 0, stdout + stderr);
  assert.match(stdout, /money-path-review: PASS money path reviewed by real reviewer/);
});

test("FAIL (round-3 P1): an unreachable comments check fails closed, not open", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const { status, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments: "unreadable" });
  assert.equal(status, 1, stderr);
  assert.match(stderr, /could not verify PR review comments/);
  assert.match(stderr, /failing closed/);
});

// Round 3, judge P1 "自保护可被同一提交自删名单解除": a SEPARATE, independent assertion that
// does not import or execute the gate script (it has no entry-point guard — importing it would
// re-run main() as a side effect). It reads the CURRENT SOURCE TEXT of check-money-path-review.mjs
// and asserts each of these 5 hard-coded paths still appears as a MONEY_PATH_FILES entry. This
// list is intentionally NOT derived from anything inside the script itself — deleting the
// self-protection line there does not touch this hard-coded expectation, so the two silently
// drift apart and THIS assertion goes red, in the same `check` CI job, regardless of what
// money-path-review itself would now (incorrectly) report.
const REQUIRED_GATE_MECHANISM_FILES = [
  ".github/workflows/ci.yml",
  "scripts/ci/run-job.sh",
  "scripts/ci/check-money-path-review.mjs",
  ".claude/skills/money-safety-review/SKILL.md",
  "scripts/__tests__/check-money-path-review.test.mjs",
];

test("red: the gate's self-protection list cannot shrink without this independent test noticing", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");
  for (const path of REQUIRED_GATE_MECHANISM_FILES) {
    assert.ok(
      source.includes(`"${path}"`),
      `check-money-path-review.mjs must list "${path}" in MONEY_PATH_FILES (gate self-protection) — ` +
        "if this fails, someone removed the entry without restoring it; this test's own expected " +
        "list lives here, independent of the script, on purpose (see comment above)",
    );
  }
});
