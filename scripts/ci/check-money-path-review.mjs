#!/usr/bin/env node
// Lock 3 — a diff that can move money does not merge without a named review.
//
// 改一处必须改两处: MONEY_PATH_FILES / MONEY_IN_FILES / MONEY_PATH_PREFIXES below
// are the machine mirror of Step 1 in .claude/skills/money-safety-review/SKILL.md.
// Adding a paid call site, a ledger writer or a new spend seam means editing BOTH —
// the skill (so the human review knows to look) and this list (so CI can tell it
// did not). The lists are a FLOOR, not the definition: project law gates any diff
// that can reach spend, and the skill's catch-all outranks this enumeration.
//
// The token is bound to the head SHA on purpose: `[MONEY-SAFETY-REVIEWED: <who> @
// <head-sha>]` stops being valid the moment another commit is pushed, which is
// exactly the "stamp it first, add the risky commit after" move the gate exists
// to prevent. Re-review, re-stamp.
//
// What the token is NOT: it is an unauthenticated self-declaration. Anyone who can
// edit the PR body can type it, and nothing here checks that a review happened or
// that the named reviewer exists. It defends against FORGETTING, not against a
// session (or a person) that decides to skip the review on purpose — that boundary
// is held by project law, by the independent cross-family review, and by the human
// who merges. Do not cite a green gate as evidence that the review was performed.
//
// Fail direction: closed in CI (a pull_request event with money files and no
// valid token is a hard FAIL), open locally (no PR context = advisory notice and
// PASS, so the local runner stays runnable).
//
// The workflow must keep `edited` in its pull_request `types:` — the token is read
// from the event payload's PR body, and a re-run replays the original payload, so
// without `edited` a body edit could never reach this gate.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Money-OUT: paid call sites, the spend authorities they call, the prices they
// reserve on, the keys that keep them exactly-once, and the ledger they write.
const MONEY_PATH_FILES = [
  "packages/core/src/gen.ts",
  "packages/core/src/spend.ts",
  "packages/core/src/llm-prices.ts",
  "packages/core/src/otto-budget.ts",
  "apps/web/lib/gen-actions.ts",
  "apps/web/lib/refgen-actions.ts",
  "apps/web/lib/cowork-actions.ts",
  "apps/web/lib/otto-actions.ts",
  "apps/web/lib/actions.ts",
  "apps/web/lib/factory-batch.ts",
  "apps/web/lib/batch-idempotency.ts",
  "apps/web/lib/campaign-generation-confirm.ts",
  "apps/web/app/api/otto/stream/route.ts",
  "apps/web/lib/research-actions.ts",
  "apps/web/lib/queue.ts",
  "apps/worker/src/jobs/gen.ts",
  "apps/worker/src/jobs/refgen.ts",
  "apps/worker/src/jobs/research.ts",
  "apps/worker/src/jobs/llm-reservation-reaper.ts",
  "apps/worker/src/otto-resume.ts",
  "apps/worker/src/index.ts",
  "packages/generation/src/byteplus.ts",
  "packages/generation/src/index.ts",
  "packages/db/src/credits.ts",
  "packages/otto/src/meter.ts",
  "packages/otto/src/model.ts",
  "packages/otto/src/runtime.ts",
  "packages/otto/src/skills/generate.ts",
  "packages/otto/src/skills/propose-research.helpers.ts",
  "apps/worker/src/generation.ts",
  "apps/web/lib/meta-write-actions.ts",
  "apps/web/lib/meta-action-policy.ts",
  "apps/web/lib/meta-approval.ts",
  "apps/web/lib/meta-propose.ts",
  "apps/web/lib/meta-graph.ts",
];
// Why the Otto spend-PARAMETER layer above is listed (added after review round 2, which
// found the paid call sites covered but this whole layer missing):
//   otto-resume.ts       — a real paid turn: withLlmBudget is passed to runOttoTurn as the
//                          meter, and refId `otto-verdict:<jobId>` is its exactly-once key.
//   runtime.ts           — ottoBudgetArgsFor derives EVERY withLlmBudget argument (paid,
//                          prices, maxSteps). One flipped comparison makes every paid turn
//                          free, or every fixture turn billed.
//   model.ts             — the frozen binding of billableModelId to pricing: llmPricesFor.
//   propose-research.helpers.ts — researchTierBudgetInternal IS the per-tier reserve.
//   research-actions.ts  — the balance pre-check plus the `research:<cardId>` idempotency key.
//   worker index.ts / web queue.ts — the two places RESEARCH_QUEUE_POLICY is spread onto the
//                          live queue; retryLimit:0 there is what stops a failed paid research
//                          run from being redelivered into a second charge.
// Deliberately NOT listed: the barrel re-exports packages/db/src/index.ts and
// packages/otto/src/index.ts. They carry no spend decision, and listing them would money-gate
// every unrelated export change; the skill's catch-all and project law still cover them.
//
// Why the two clusters below are listed (added #480, re-enumerating against the live tree
// rather than copying #471's list, per the skill's Step-1 seams + catch-all):
//   generation.ts (worker) — the ONE chokepoint apps/worker/src/jobs/{gen,refgen}.ts both
//                          import `provider` from. GENERATION_PROVIDER + BYTEPLUS_API_KEY /
//                          FAL_KEY decide mock ($0) vs byteplus/fal (real money) here; a bug
//                          in this selection silently flips every generation job's spend.
//   meta-write-actions.ts — the ONLY code path that writes to Meta (spends real ad budget):
//                          approveMetaActionPlan (human-approve gate) + runApprovedPlan
//                          (executor) + the kill-switch/autonomy toggles live in one file.
//   meta-action-policy.ts — classifyMoneyClass/policyDecision: the ONE place "auto vs ask" is
//                          decided for a Meta write op. Mislabel a spend op "safe" and AUTO
//                          mode fires it without a human ever approving.
//   meta-approval.ts      — the approval paramHash binding + consumedAt exactly-once claim
//                          meta-write-actions.ts checks before calling Meta — the Meta-side
//                          analogue of idempotencyKey/dedup for GenJob.
//   meta-propose.ts       — proposeMetaActionForOwner calls maybeAutoRun (meta-write-actions.ts)
//                          directly on the AUTO path, so — unlike cowork's $0 propose side —
//                          this file itself can trigger real spend, not just display one.
//   meta-graph.ts         — the sole outbound HTTP transport to the Graph API used by both the
//                          $0 build path and the spend path; the provider-implementation
//                          analogue of packages/generation/src/byteplus.ts.
// Deliberately NOT listed: meta-build-actions.ts / meta-build-propose.ts (createAdBuild always
// writes status:"PAUSED", $0 by the module's own invariant — mirrors cowork's $0 propose side;
// its launchAdDraft hands off to meta-propose.ts/meta-write-actions.ts above for the real
// resume, so the actual spend decision is still gated there) and the read-only Meta modules
// (meta-objects.ts, meta-insights.ts, meta-performance*.ts, meta-oauth.ts, meta-actions.ts,
// meta-pages.ts, meta-errors.ts, meta-signed-request.ts, meta-plan-card.ts) — none of them
// write to a real ad account or decide auto-vs-ask; the catch-all still covers them if that
// ever changes. Searched with: `grep -rln "stripe\."`, `grep -rln "BYTEPLUS_API_KEY|FAL_KEY"`,
// `grep -n "approveMetaActionPlan|maybeAutoRun|classifyMoneyClass"` across apps/ and packages/
// (excluding node_modules and *.test.ts), plus reading every file this touched.
//
// Money-IN: the only CreditAccount/CreditLedger minting call sites, plus the Stripe Checkout
// entry point that starts a real payment. The skill's Step 1 defers these to the reviewer
// playbook, so the message points there — but the gate is the same: a money-in diff does not
// merge unreviewed either.
const MONEY_IN_FILES = [
  "apps/web/app/api/stripe/webhook/route.ts",
  "apps/web/lib/credit-actions.ts",
  "apps/web/lib/tenant-actions.ts",
  "apps/web/lib/auth-guard.ts",
  "apps/web/lib/billing-actions.ts",
];
// billing-actions.ts (#480) — createTopupCheckout starts the real Stripe Checkout session a
// customer pays through; listCreditPacks reads the live Stripe Price catalog that prices it.
// apps/web/lib/stripe.ts (the Stripe SDK client construction) is deliberately NOT listed — it
// makes no spend decision, same reasoning as the barrel-export exclusion above.
const MONEY_PATH_PREFIXES = ["packages/db/prisma/migrations/"];
const TOKEN = /\[MONEY-SAFETY-REVIEWED:\s*([^\]@]+?)\s*@\s*([0-9a-f]{7,40})\s*\]/i;
const SKILL = ".claude/skills/money-safety-review/SKILL.md";
const PLAYBOOK = "docs/review/REVIEWER-PLAYBOOK.md";

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

// D (deletion) is in the filter deliberately: deleting credits.ts, a reaper or an
// idempotency migration is at least as consequential as editing it, and an
// ACMRT-only filter would let that class of diff through unreviewed.
function changedFiles(base, head) {
  const mergeBase = git(["merge-base", base, head], { allowFailure: true });
  const from = mergeBase ? mergeBase.trim() : base;
  const diff = git(["diff", "--name-only", "--diff-filter=ACDMRT", from, head]);
  return diff.split("\n").map((line) => line.trim()).filter(Boolean);
}

function moneyPaths(files) {
  return files.filter(
    (file) =>
      MONEY_PATH_FILES.includes(file) ||
      MONEY_IN_FILES.includes(file) ||
      MONEY_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
}

// Which document the reviewer has to open depends on which side of the ledger the
// diff touches; both sides need the same token in the PR body.
function reviewPointers(touched) {
  const pointers = [];
  if (touched.some((file) => !MONEY_IN_FILES.includes(file))) {
    pointers.push(`run ${SKILL} on the full spend diff`);
  }
  if (touched.some((file) => MONEY_IN_FILES.includes(file))) {
    pointers.push(`run the money + admin-auth sections of ${PLAYBOOK} on the money-in diff`);
  }
  return pointers;
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

// The ONLY sequence that clears this gate. Order matters: the token names the head
// SHA, so it can only be written after the last commit is pushed, and the body edit
// is what re-runs CI (the workflow subscribes to the `edited` pull_request action —
// a plain "Re-run jobs" replays the OLD payload and will keep reading the OLD body).
function stampInstructions(head) {
  return [
    "clear it in this order — any other order cannot go green:",
    "  1. commit and push every change you still intend to make (a later push voids the token)",
    "  2. read the new head SHA:  git rev-parse HEAD",
    `  3. edit the PULL REQUEST BODY (not a comment) to contain: [MONEY-SAFETY-REVIEWED: <reviewer> @ ${head}]`,
    "  4. saving the body edit re-runs CI with the new body — do NOT press Re-run jobs, it replays the old payload",
  ];
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
  console.log("money-path-review: NOTICE this branch touches a money path:");
  for (const file of touched) console.log(`- ${file}`);
  for (const pointer of reviewPointers(touched)) console.log(`money-path-review: ${pointer}`);
  for (const line of stampInstructions("<head-sha-after-the-push>")) {
    console.log(`money-path-review: ${line}`);
  }
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
      ...reviewPointers(touched),
      ...stampInstructions(head),
    ]);
    return;
  }
  const [, reviewer, stampedSha] = match;
  if (!head.toLowerCase().startsWith(stampedSha.toLowerCase())) {
    fail([
      ...touched.map((file) => `money-path file changed: ${file}`),
      `the review token names ${stampedSha}, but the current head is ${head}`,
      "the stamp is bound to the head SHA — re-review the new commits and re-stamp",
      ...stampInstructions(head),
    ]);
    return;
  }
  pass(`money path reviewed by ${reviewer.trim()} at ${head.slice(0, 12)} (${touched.length} file(s))`);
}

main();
