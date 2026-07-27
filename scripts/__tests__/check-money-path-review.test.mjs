import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
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
// Round 4 (#480 rework): the real, current script source — used both for the independent
// self-protection text assertion (unchanged from round 3) and, new this round, as the literal
// content planted at a fixture's BASE commit for the run-from-base tests below.
const REAL_SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, "utf8");

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
// monitors about itself.
const GATE_SELF_FILE = "scripts/ci/check-money-path-review.mjs";
// Round 3 (#480 rework, second sealed judge FAIL — comment 5088727861, P0): the four archive
// worker-guard scripts that only reject GENERATION_PROVIDER=fal (byteplus is real money too),
// and the direct CreditLedger writer whose DATABASE_URL guard is bypassed by
// DATABASE_URL_POOLED's priority in packages/db/src/index.ts.
const WORKER_GUARD_FILE = "scripts/archive/verify-gen-character-no-refs-worker.mjs";
const CREDIT_LEDGER_SCRIPT_FILE = "scripts/tools/seed-local-qa-data.mjs";
// Round 4 (#480 rework, third sealed judge FAIL — comment 5089318805, P0): the search-API
// cluster (real provider keys + the skill that calls the search port).
const SEARCH_CLUSTER_FILE = "packages/core/src/websearch.ts";

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

// Builds a repo with a base commit (one file per list branch + one unrelated file, so diffs can
// touch any single one) and returns { repo, baseSha, root }.
//
// Round 4 (#480 rework): deliberately does NOT plant anything at GATE_SELF_FILE in the base
// commit. Every fixture now naturally exercises run-from-base's BOOTSTRAP path (the base commit
// genuinely lacks the gate script, exactly like real `main` does right now, before this PR
// merges) — which is the faithful, current-reality shape for every test that isn't specifically
// about run-from-base's non-bootstrap behavior. Those dedicated tests plant a real script at
// base themselves (see REAL_SCRIPT_SOURCE above).
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
  write(repo, WORKER_GUARD_FILE, "// stand-in for a fal-only worker guard script\n");
  write(repo, CREDIT_LEDGER_SCRIPT_FILE, "// stand-in for a direct CreditLedger writer\n");
  write(repo, SEARCH_CLUSTER_FILE, "// stand-in for the search-API cluster\n");
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

// A qualifying-shaped [MONEY-SAFETY-REVIEWED: ...] comment binding BOTH head and base (round 4).
function tokenComment({ reviewer = "alice", head, base, login = REVIEWER_LOGIN, association = "COLLABORATOR" }) {
  return comment({ login, association, body: `[MONEY-SAFETY-REVIEWED: ${reviewer} @ ${head} base ${base}]` });
}

// Runs the gate as CI does: GITHUB_EVENT_PATH pointing at a pull_request payload, cwd set to
// the fixture repo, GITHUB_REPOSITORY set (the script falls back to it when the event payload
// lacks repository.full_name). `comments`, when given, is written to a fixture file and wired
// through MONEY_PATH_REVIEW_COMMENTS_FIXTURE — the ONLY way to drive the comment-verification
// logic offline (no real GitHub API access here). `comments: "unreadable"` points the env var at
// a path that does not exist, exercising the exact same catch block a real network failure hits.
// GITHUB_ACTIONS is explicitly cleared here (round 4): this test SUITE may itself be running
// inside real CI, which would otherwise leak GITHUB_ACTIONS=true into every spawned child and
// trip the round-4 "refuse test-only overrides in real CI" guard on every fixture-based test.
function runGate(root, repo, event, { comments, envOverrides } = {}) {
  const eventPath = join(root, "480-event.json");
  writeFileSync(eventPath, JSON.stringify(event));
  const env = { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: GITHUB_REPO, GITHUB_ACTIONS: "" };
  if (comments === "unreadable") {
    env.MONEY_PATH_REVIEW_COMMENTS_FIXTURE = join(root, "480-does-not-exist.json");
  } else if (comments !== undefined) {
    const fixturePath = join(root, "480-comments-fixture.json");
    writeFileSync(fixturePath, JSON.stringify(comments));
    env.MONEY_PATH_REVIEW_COMMENTS_FIXTURE = fixturePath;
  }
  Object.assign(env, envOverrides);
  const result = spawnSync("node", [SCRIPT], { cwd: repo, encoding: "utf8", env });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("FAIL: a money-path file changed with no review comment, for every list branch", async (t) => {
  const cases = [
    ["MONEY_PATH_FILES", MONEY_OUT_FILE],
    ["MONEY_IN_FILES", MONEY_IN_FILE],
    ["MONEY_PATH_PREFIXES", MONEY_PREFIX_FILE],
    ["round-3 worker-guard script", WORKER_GUARD_FILE],
    ["round-3 CreditLedger script", CREDIT_LEDGER_SCRIPT_FILE],
    ["round-4 search-API cluster", SEARCH_CLUSTER_FILE],
  ];
  for (const [label, path] of cases) {
    await t.test(label, (child) => {
      const { repo, root, baseSha } = fixture(child);
      write(repo, path, "// changed\n");
      const headSha = commit(repo, `touch ${path}`);
      const { status, stdout, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments: [] });
      assert.equal(status, 1, stderr);
      assert.match(stdout, /NOTICE bootstrap mode/); // confirms run-from-base was exercised
      assert.match(stderr, /money-path-review: FAIL/);
      assert.match(stderr, new RegExp(`money-path file changed: ${escapeRegex(path)}`));
      assert.match(stderr, /MONEY-SAFETY-REVIEWED/);
    });
  }
});

test("PASS: a money-path file changed with a qualifying reviewer comment bound to head+base", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const comments = [tokenComment({ head: headSha, base: baseSha })];
  const { status, stdout, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 0, stdout + stderr);
  assert.match(stdout, new RegExp(`money-path-review: PASS money path reviewed by alice \\(@${REVIEWER_LOGIN}\\)`));
});

test("FAIL: a token stamped for an earlier head does not clear a later commit", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// first change\n");
  const staleHeadSha = commit(repo, "first money-out change");
  write(repo, MONEY_OUT_FILE, "// second change, unreviewed\n");
  const headSha = commit(repo, "second money-out change");
  const comments = [tokenComment({ head: staleHeadSha, base: baseSha })];
  const { status, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 1, stderr);
  assert.match(stderr, /stamped a mismatched head .* vs current/);
  assert.match(stderr, /re-review the current diff and re-stamp/);
});

// Round 4 (#480 rework, third sealed judge FAIL, "凭证不绑 base"):

test("FAIL (round-4 P1): a token with the right head but the WRONG base does not qualify", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const wrongBase = "0".repeat(40);
  const comments = [tokenComment({ head: headSha, base: wrongBase })];
  const { status, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 1, stderr);
  assert.match(stderr, /stamped a mismatched base .* vs current/);
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
  const result = spawnSync("node", [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_PATH: "", GITHUB_ACTIONS: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NOTICE this branch touches a money path/);
  assert.match(result.stdout, new RegExp(escapeRegex(MONEY_OUT_FILE)));
  assert.match(result.stdout, /base [0-9a-f]{40}\]/); // stampInstructions now names a real base SHA
  assert.match(result.stdout, /local run is advisory; the same check is fail-closed on the pull request/);
});

// #480 rework — sealed cross-family judge findings on PR #482 (comments 5087841805, 5088727861,
// and 5089318805), each with its own red case below:

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
  const comments = [comment({ body: `[MONEY-SAFETY-REVIEWED:  @ ${headSha} base ${baseSha}]` })];
  const { status, stdout, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 1, stdout + stderr);
  assert.match(stderr, /blank reviewer/);
});

test("FAIL (P1): a short SHA prefix does not clear the gate", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const comments = [comment({ body: `[MONEY-SAFETY-REVIEWED: alice @ ${headSha.slice(0, 7)} base ${baseSha}]` })];
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
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_ACTIONS: "" },
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /money-path-review: FAIL/);
  assert.match(result.stderr, /could not be read or parsed/);
  assert.match(result.stderr, /failing closed/);
});

test("FAIL (P1): modifying the gate script itself (head-only, still bootstrap) does not clear the gate", (t) => {
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
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: "pull_request", GITHUB_ACTIONS: "" },
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
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: "push", GITHUB_ACTIONS: "" },
  });
  // A genuine push event (or any non-pull_request event) legitimately has no pull_request
  // field — this must stay on the open, local-advisory path, not be swept up by the P1 fix.
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("FAIL (round-3 P1): a token comment authored by the PR's own author does not qualify", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const comments = [tokenComment({ reviewer: "self", login: PR_AUTHOR_LOGIN, head: headSha, base: baseSha })];
  const { status, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 1, stderr);
  assert.match(stderr, /only authored by the PR's own author/);
});

test("FAIL (round-3 P1): a token comment from a non-author without OWNER\\/MEMBER\\/COLLABORATOR standing does not qualify", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const comments = [
    tokenComment({ reviewer: "mallory", login: "random-outside-account", association: "NONE", head: headSha, base: baseSha }),
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
  const comments = [tokenComment({ reviewer: "founder", login: "founder-account", association: "OWNER", head: headSha, base: baseSha })];
  const { status, stdout, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments });
  assert.equal(status, 0, stdout + stderr);
  assert.match(stdout, /money-path-review: PASS money path reviewed by founder \(@founder-account\)/);
});

test("PASS: scans past a self-authored decoy comment to find a real qualifying one", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const comments = [
    tokenComment({ reviewer: "fake", login: PR_AUTHOR_LOGIN, head: headSha, base: baseSha }),
    tokenComment({ reviewer: "real reviewer", head: headSha, base: baseSha }),
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

// Round 4 (#480 rework, third sealed judge FAIL — comment 5089318805):

test("FAIL (round-4 P1): the comments fixture is refused whenever GITHUB_ACTIONS=true", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  // A comment that WOULD qualify if the fixture were honored — proves the rejection isn't just
  // "no comments found," it's "the override itself was refused."
  const comments = [tokenComment({ head: headSha, base: baseSha })];
  const { status, stderr } = runGate(root, repo, prEvent(baseSha, headSha), {
    comments,
    envOverrides: { GITHUB_ACTIONS: "true" },
  });
  assert.equal(status, 1, stderr);
  assert.match(stderr, /refusing test-only overrides in a real CI run/);
});

test("PASS (round-4 P2): comments spanning multiple pages are all found via a real paginated fetch loop", async (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  // Page 1 is a full 100 (padding) decoy comments the qualifying one is NOT on; page 2 has the
  // one real qualifying comment. A single-page-only fetch would report "not found" (FAIL); the
  // full pagination loop must reach page 2 and PASS.
  const page1 = Array.from({ length: 100 }, (_, i) => comment({ login: `decoy-${i}`, association: "NONE", body: `noise ${i}` }));
  const page2 = [tokenComment({ reviewer: "page-two-reviewer", head: headSha, base: baseSha })];
  const server = await new Promise((resolve) => {
    const s = createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const page = Number(url.searchParams.get("page") || "1");
      const body = JSON.stringify(page === 1 ? page1 : page === 2 ? page2 : []);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const eventPath = join(root, "480-event.json");
  writeFileSync(eventPath, JSON.stringify(prEvent(baseSha, headSha)));
  const result = spawnSync("node", [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: GITHUB_REPO,
      GITHUB_ACTIONS: "",
      GITHUB_TOKEN: "dummy-token-for-local-test-server",
      MONEY_PATH_REVIEW_API_BASE_URL: `http://127.0.0.1:${port}`,
    },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS money path reviewed by page-two-reviewer/);
});

test("FAIL (round-4 P2): a failure on any single comments page still fails closed", async (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const page1 = Array.from({ length: 100 }, (_, i) => comment({ login: `decoy-${i}`, association: "NONE", body: `noise ${i}` }));
  const server = await new Promise((resolve) => {
    const s = createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const page = Number(url.searchParams.get("page") || "1");
      if (page === 1) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(page1));
        return;
      }
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "simulated page-2 outage" }));
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const eventPath = join(root, "480-event.json");
  writeFileSync(eventPath, JSON.stringify(prEvent(baseSha, headSha)));
  const result = spawnSync("node", [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: GITHUB_REPO,
      GITHUB_ACTIONS: "",
      GITHUB_TOKEN: "dummy-token-for-local-test-server",
      MONEY_PATH_REVIEW_API_BASE_URL: `http://127.0.0.1:${port}`,
    },
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /GitHub API returned 503/);
  assert.match(result.stderr, /failing closed/);
});

// Round 4 (#480 rework, third sealed judge FAIL — comment 5089318805, architecture): run-from-base

test("bootstrap mode: base commit genuinely lacks the gate script, output says so, head version runs", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const { status, stdout } = runGate(root, repo, prEvent(baseSha, headSha), { comments: [] });
  assert.equal(status, 1);
  assert.match(stdout, /NOTICE bootstrap mode — scripts\/ci\/check-money-path-review\.mjs does not exist yet/);
  assert.match(stdout, /permanent-until-merge/);
});

test("run-from-base defeats self-judging: a tampered HEAD copy of the gate never runs — the base copy does", async (t) => {
  const { repo, root, baseSha: preBase } = fixture(t);
  // Overwrite the gate script at BASE with the REAL, current, fully-functional script — a
  // faithful stand-in for "this is what main looks like after the gate has shipped." This base
  // commit is what run-from-base will actually extract and execute.
  write(repo, GATE_SELF_FILE, REAL_SCRIPT_SOURCE);
  git(repo, ["add", "."]);
  git(repo, ["commit", "--amend", "--no-edit"]);
  const baseSha = git(repo, ["rev-parse", "HEAD"]);
  assert.notEqual(baseSha, preBase, "amend should produce a new base SHA");
  // HEAD: an attacker gains commit access to the PR and (a) guts the gate script into a
  // maximally-tampered no-op that always claims success, AND (b) sneaks in an unrelated
  // money-path change in the SAME commit — the exact "same-commit atomic cut" shape the round-3
  // judge proved defeats a self-referential-list-only defense.
  const tamperedGate = [
    "// maximally tampered: unconditionally claims success, no matter what the diff contains",
    'console.log("money-path-review: PASS money path reviewed by TAMPERED (@fake-account) at 0000000000 (0 file(s))");',
    "process.exit(0);",
    "",
  ].join("\n");
  write(repo, GATE_SELF_FILE, tamperedGate);
  write(repo, MONEY_OUT_FILE, "// malicious change smuggled in alongside the tampered gate\n");
  const headSha = commit(repo, "tamper with the gate AND sneak in a money-out change, same commit");
  const { status, stdout, stderr } = runGate(root, repo, prEvent(baseSha, headSha), { comments: [] });
  // The tampered head version's fake-success line must NEVER appear — it must never have run.
  assert.doesNotMatch(stdout, /TAMPERED/);
  // The REAL base version's own logic is what actually ran, and correctly failed the diff.
  assert.equal(status, 1, stdout + stderr);
  assert.match(stderr, /money-path-review: FAIL/);
  assert.match(stderr, new RegExp(`money-path file changed: ${escapeRegex(MONEY_OUT_FILE)}`));
  assert.match(stderr, new RegExp(`money-path file changed: ${escapeRegex(GATE_SELF_FILE)}`));
});

test("run-from-base: base commit exists but is unresolvable locally fails closed (not bootstrap)", (t) => {
  const { repo, root, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  // A base SHA that is well-formed but does not exist anywhere in this repo's history — no
  // origin remote to fetch it from either, so ensureCommits-equivalent deepening cannot help.
  // This must NOT be confused with bootstrap (which requires the commit to exist, just not the
  // file in its tree).
  const unresolvableBase = "1234567890abcdef1234567890abcdef12345678";
  const { status, stderr } = runGate(root, repo, prEvent(unresolvableBase, headSha), { comments: [] });
  assert.equal(status, 1, stderr);
  assert.match(stderr, /cannot resolve the merge-base/);
  assert.match(stderr, /failing closed/);
  // must NOT claim bootstrap for an unresolvable commit
  assert.doesNotMatch(stderr, /bootstrap/);
});

// Round 3, judge P1 "自保护可被同一提交自删名单解除": a SEPARATE, independent assertion that
// does not import or execute the gate script (it has no entry-point guard — importing it would
// re-run main() as a side effect). It reads the CURRENT SOURCE TEXT of check-money-path-review.mjs
// and asserts each of these 5 hard-coded paths still appears as a MONEY_PATH_FILES entry. This
// list is intentionally NOT derived from anything inside the script itself — deleting the
// self-protection line there does not touch this hard-coded expectation, so the two silently
// drift apart and THIS assertion goes red, in the same `check` CI job, regardless of what
// money-path-review itself would now (incorrectly) report.
//
// Round 4: this remains defense-in-depth (see the file-header TRUST MODEL comment) — run-from-base
// is now the primary defense against self-judging, but this independent check still catches a
// narrowed list in the committed tree even before/without exercising run-from-base specifically.
const REQUIRED_GATE_MECHANISM_FILES = [
  ".github/workflows/ci.yml",
  "scripts/ci/run-job.sh",
  "scripts/ci/check-money-path-review.mjs",
  ".claude/skills/money-safety-review/SKILL.md",
  "scripts/__tests__/check-money-path-review.test.mjs",
];

test("red: the gate's self-protection list cannot shrink without this independent test noticing", () => {
  for (const path of REQUIRED_GATE_MECHANISM_FILES) {
    assert.ok(
      REAL_SCRIPT_SOURCE.includes(`"${path}"`),
      `check-money-path-review.mjs must list "${path}" in MONEY_PATH_FILES (gate self-protection) — ` +
        "if this fails, someone removed the entry without restoring it; this test's own expected " +
        "list lives here, independent of the script, on purpose (see comment above)",
    );
  }
});
