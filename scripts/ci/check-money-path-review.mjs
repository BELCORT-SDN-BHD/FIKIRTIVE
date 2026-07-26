#!/usr/bin/env node
// Lock 3 — a diff that can move money does not merge without a named review.
//
// 改一处必须改两处: MONEY_PATH_FILES / MONEY_PATH_PREFIXES below are the machine
// mirror of Step 1 in .claude/skills/money-safety-review/SKILL.md. Adding a paid
// call site, a ledger writer or a new spend seam means editing BOTH — the skill
// (so the human review knows to look) and this list (so CI can tell it did not).
//
// The token is bound to the head SHA on purpose: `[MONEY-SAFETY-REVIEWED: <who> @
// <head-sha>]` stops being valid the moment another commit is pushed, which is
// exactly the "stamp it first, add the risky commit after" move the gate exists
// to prevent. Re-review, re-stamp.
//
// Fail direction: closed in CI (a pull_request event with money files and no
// valid token is a hard FAIL), open locally (no PR context = advisory notice and
// PASS, so the local runner stays runnable).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MONEY_PATH_FILES = [
  "packages/core/src/gen.ts",
  "packages/core/src/llm-prices.ts",
  "apps/web/lib/gen-actions.ts",
  "apps/web/lib/refgen-actions.ts",
  "apps/worker/src/jobs/gen.ts",
  "apps/worker/src/jobs/refgen.ts",
  "apps/worker/src/jobs/llm-reservation-reaper.ts",
  "packages/generation/src/byteplus.ts",
  "packages/generation/src/index.ts",
  "packages/db/src/credits.ts",
  "packages/otto/src/meter.ts",
];
const MONEY_PATH_PREFIXES = ["packages/db/prisma/migrations/"];
const TOKEN = /\[MONEY-SAFETY-REVIEWED:\s*([^\]@]+?)\s*@\s*([0-9a-f]{7,40})\s*\]/i;
const SKILL = ".claude/skills/money-safety-review/SKILL.md";

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || "").trim()}`);
  }
  return result.stdout;
}

function hasCommit(sha) {
  return git(["cat-file", "-e", `${sha}^{commit}`], { allowFailure: true }) !== null;
}

// A pull_request checkout is shallow by default, so the base and head commits may
// not exist locally. Deepen by SHA before giving up; report honestly if that fails.
function ensureCommits(shas) {
  const missing = shas.filter((sha) => !hasCommit(sha));
  if (missing.length === 0) return true;
  git(["fetch", "--no-tags", "--depth=50", "origin", ...missing], { allowFailure: true });
  return shas.every((sha) => hasCommit(sha));
}

function changedFiles(base, head) {
  const mergeBase = git(["merge-base", base, head], { allowFailure: true });
  const from = mergeBase ? mergeBase.trim() : base;
  const diff = git(["diff", "--name-only", "--diff-filter=ACMRT", from, head]);
  return diff.split("\n").map((line) => line.trim()).filter(Boolean);
}

function moneyPaths(files) {
  return files.filter(
    (file) =>
      MONEY_PATH_FILES.includes(file) ||
      MONEY_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
}

function readEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function pass(message) {
  console.log(`money-path-review: PASS ${message}`);
}

function fail(lines) {
  console.error("money-path-review: FAIL");
  for (const line of lines) console.error(`- ${line}`);
  process.exitCode = 1;
}

function localAdvisory() {
  const base = git(["merge-base", "origin/main", "HEAD"], { allowFailure: true });
  if (!base) {
    pass("no pull-request context and no origin/main baseline — CI re-runs this gate closed");
    return;
  }
  let touched = [];
  try {
    touched = moneyPaths(changedFiles(base.trim(), "HEAD"));
  } catch {
    pass("no pull-request context — CI re-runs this gate closed");
    return;
  }
  if (touched.length === 0) {
    pass("no money-path file in this branch");
    return;
  }
  console.log("money-path-review: NOTICE this branch touches the spend path:");
  for (const file of touched) console.log(`- ${file}`);
  console.log(`money-path-review: run ${SKILL}, then put the token in the PR body:`);
  console.log("money-path-review:   [MONEY-SAFETY-REVIEWED: <reviewer> @ <head-sha>]");
  pass("local run is advisory; the same check is fail-closed on the pull request");
}

function main() {
  const event = readEvent();
  const pr = event?.pull_request;
  if (!pr?.head?.sha || !pr?.base?.sha) {
    localAdvisory();
    return;
  }

  const head = String(pr.head.sha);
  const base = String(pr.base.sha);
  if (!ensureCommits([base, head])) {
    fail([
      `cannot resolve the pull-request range ${base.slice(0, 12)}..${head.slice(0, 12)} locally`,
      "the checkout is too shallow — set fetch-depth: 0 on the checkout step, or grant the fetch network access",
      "failing closed: an unreadable diff cannot prove the spend path is untouched",
    ]);
    return;
  }

  let touched;
  try {
    touched = moneyPaths(changedFiles(base, head));
  } catch (error) {
    fail([error.message, "failing closed: an unreadable diff cannot prove the spend path is untouched"]);
    return;
  }
  if (touched.length === 0) {
    pass("no money-path file in this pull request");
    return;
  }

  const body = typeof pr.body === "string" ? pr.body : "";
  const match = body.match(TOKEN);
  if (!match) {
    fail([
      ...touched.map((file) => `money-path file changed: ${file}`),
      `run ${SKILL} on the full spend diff, then add to the PR body:`,
      `  [MONEY-SAFETY-REVIEWED: <reviewer> @ ${head}]`,
    ]);
    return;
  }
  const [, reviewer, stampedSha] = match;
  if (!head.toLowerCase().startsWith(stampedSha.toLowerCase())) {
    fail([
      ...touched.map((file) => `money-path file changed: ${file}`),
      `the review token names ${stampedSha}, but the current head is ${head}`,
      "the stamp is bound to the head SHA — re-review the new commits and re-stamp",
    ]);
    return;
  }
  pass(`spend path reviewed by ${reviewer.trim()} at ${head.slice(0, 12)} (${touched.length} file(s))`);
}

main();
