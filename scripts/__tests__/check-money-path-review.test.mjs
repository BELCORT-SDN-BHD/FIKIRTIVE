import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Black-box (subprocess) tests: check-money-path-review.mjs is a CLI script that reads
// GITHUB_EVENT_PATH and runs `git` relative to its own cwd, exactly as GitHub Actions
// invokes it — so a real `node <script>` subprocess against a throwaway git fixture is
// the most faithful way to test it (no script changes needed to make it importable).
const SCRIPT = fileURLToPath(new URL("../ci/check-money-path-review.mjs", import.meta.url));

// One representative path from each of the three MONEY_PATH_FILES / MONEY_IN_FILES /
// MONEY_PATH_PREFIXES lists in the script — proves all three membership branches of
// moneyPaths() actually trigger the gate, not just the first one.
const MONEY_OUT_FILE = "apps/web/lib/billing-actions.ts";
const MONEY_IN_FILE = "apps/web/lib/credit-actions.ts";
const MONEY_PREFIX_FILE = "packages/db/prisma/migrations/20260101000000_x/migration.sql";
const UNRELATED_FILE = "apps/web/lib/unrelated-feature.ts";

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
  const root = mkdtempSync(join(tmpdir(), "fikirtive-money-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "Money Gate Test"]);
  git(repo, ["config", "user.email", "money-gate@example.test"]);
  write(repo, MONEY_OUT_FILE, "export async function createTopupCheckout() {}\n");
  write(repo, MONEY_IN_FILE, "export async function grantCredits() {}\n");
  write(repo, MONEY_PREFIX_FILE, "-- base migration\n");
  write(repo, UNRELATED_FILE, "export const label = \"base\";\n");
  const baseSha = commit(repo, "base");
  return { repo, baseSha };
}

// Runs the gate as CI does: GITHUB_EVENT_PATH pointing at a pull_request payload, cwd
// set to the fixture repo. Returns { status, stdout, stderr }.
function runGate(repo, event) {
  const eventPath = join(repo, "..", "event.json");
  writeFileSync(eventPath, JSON.stringify(event));
  const result = spawnSync("node", [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function prEvent(base, head, body = "") {
  return { pull_request: { base: { sha: base }, head: { sha: head }, body } };
}

test("FAIL: a money-path file changed with no review token, for every list branch", async (t) => {
  const cases = [
    ["MONEY_PATH_FILES", MONEY_OUT_FILE],
    ["MONEY_IN_FILES", MONEY_IN_FILE],
    ["MONEY_PATH_PREFIXES", MONEY_PREFIX_FILE],
  ];
  for (const [label, path] of cases) {
    await t.test(label, (child) => {
      const { repo, baseSha } = fixture(child);
      write(repo, path, "// changed\n");
      const headSha = commit(repo, `touch ${path}`);
      const { status, stderr } = runGate(repo, prEvent(baseSha, headSha));
      assert.equal(status, 1, stderr);
      assert.match(stderr, /money-path-review: FAIL/);
      assert.match(stderr, new RegExp(`money-path file changed: ${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.match(stderr, /MONEY-SAFETY-REVIEWED/);
    });
  }
});

test("PASS: a money-path file changed with a valid token bound to the head SHA", (t) => {
  const { repo, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// changed\n");
  const headSha = commit(repo, "touch money-out file");
  const body = `Fixes #480.\n\n[MONEY-SAFETY-REVIEWED: alice @ ${headSha}]\n`;
  const { status, stdout, stderr } = runGate(repo, prEvent(baseSha, headSha, body));
  assert.equal(status, 0, stderr);
  assert.match(stdout, /money-path-review: PASS money path reviewed by alice/);
});

test("FAIL: a stale token bound to an earlier SHA does not clear a later commit", (t) => {
  const { repo, baseSha } = fixture(t);
  write(repo, MONEY_OUT_FILE, "// first change\n");
  const staleHeadSha = commit(repo, "first money-out change");
  write(repo, MONEY_OUT_FILE, "// second change, unreviewed\n");
  const headSha = commit(repo, "second money-out change");
  const body = `[MONEY-SAFETY-REVIEWED: alice @ ${staleHeadSha}]\n`;
  const { status, stderr } = runGate(repo, prEvent(baseSha, headSha, body));
  assert.equal(status, 1, stderr);
  assert.match(stderr, /the review token names/);
  assert.match(stderr, /re-review the new commits and re-stamp/);
});

test("not triggered: only an out-of-list file changed", (t) => {
  const { repo, baseSha } = fixture(t);
  write(repo, UNRELATED_FILE, "export const label = \"changed\";\n");
  const headSha = commit(repo, "touch unrelated file only");
  const { status, stdout } = runGate(repo, prEvent(baseSha, headSha));
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
  assert.match(result.stdout, new RegExp(MONEY_OUT_FILE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.stdout, /local run is advisory; the same check is fail-closed on the pull request/);
});
