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
// Round 3 (#480 rework, second sealed cross-family judge FAIL — comment 5088727861,
// "凭证署名不认证可伪造"): the token used to be read out of the PR BODY, which the PR's own
// author can edit freely — so the original design note here said plainly "it is an
// unauthenticated self-declaration... anyone who can edit the PR body can type it." That is no
// longer true. The token must now appear in a PR COMMENT — never the body, which is no longer
// read at all — authored by someone OTHER than the PR author, with OWNER/MEMBER/COLLABORATOR
// standing on this repo (not just any GitHub account: forecloses the "two throwaway accounts"
// version of self-approval). Comments are read LIVE from the GitHub REST API on every run using
// the workflow's own default GITHUB_TOKEN — a GitHub login is not something the PR author can
// forge without controlling that other account. If the API call fails for ANY reason (missing
// token, network error, non-2xx, malformed response) the gate fails closed: an unreachable
// review-comment check can no more prove an independent review happened than an unreadable diff
// can prove the spend path is untouched. What the token STILL is not: it does not check that the
// reviewer read the diff carefully, only that a qualifying human distinct from the author typed
// it — that boundary is held by project law, the independent cross-family review, and the human
// who merges. Do not cite a green gate as evidence that a careful review was performed.
//
// Why comments-over-API instead of a new `issue_comment` trigger: an `issue_comment` trigger
// would need its own checkout-security handling (resolving and trusting a head SHA from a
// comment-triggered context is the classic pwn-request vector) for no real benefit — the
// comments endpoint is a LIVE call made every time THIS job runs, not a value cached in the
// stored event payload, so an ordinary `pull_request` re-run (a new commit, or a plain "Re-run
// jobs" click, which replays the OLD cached payload) still sees a comment posted in between,
// because only pr.number/pr.user.login/pr.head.sha/pr.base.sha come from that cached payload —
// none of which is "the thing being updated" when a reviewer comments.
//
// Fail direction: closed in CI (a pull_request event with money files and no qualifying
// review comment is a hard FAIL; a GITHUB_EVENT_PATH that IS set but unreadable/unparseable is
// ALSO a hard FAIL; GITHUB_EVENT_NAME=pull_request with a payload that parses but has no
// pull_request.head/base structure is ALSO a hard FAIL; an unreachable/erroring comments API
// call is ALSO a hard FAIL), open only when GITHUB_EVENT_NAME does not claim a pull_request run
// at all (a genuine local run, or a legitimate non-PR event like `push`) — advisory notice and
// PASS, so the local runner stays runnable.
//
// The workflow keeps `edited` in its pull_request `types:` for general responsiveness (editing
// title/body/base still re-runs this job); it is no longer load-bearing for THIS token mechanism
// specifically, since the comments check is always a live call, not a replay of a cached body.

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
  // Round 2 (#480 rework, sealed cross-family judge FAIL on PR #482 — comment 5087841805):
  // the judge independently re-derived the spend graph and found the round-1 list stopped one
  // hop short of the client in several chains, and missed two whole authorities (RefGen's type
  // gate, the approval/consent layer) plus the model/margin gate gen-actions.ts calls before it
  // spends. Every addition below is a hop the judge named, individually re-verified by reading
  // the cited line ranges before adding.
  "packages/core/src/refgen.ts",
  "packages/core/src/gen-from-card.ts",
  "packages/core/src/model-config.ts",
  "packages/otto/src/skill.ts",
  "packages/otto/src/approval-tools.ts",
  "apps/web/lib/approval-content-hash.ts",
  "packages/otto/src/skills/run-factory-batch.ts",
  "apps/web/lib/factory-actions.ts",
  "packages/otto/src/skills/generate-references.ts",
  "apps/web/lib/otto-refgen-port.ts",
  "apps/web/components/asset/DetailPanel.tsx",
  "apps/web/components/otto/TemplateModal.tsx",
  "apps/web/components/canvas/useCanvasGen.ts",
  "apps/web/components/otto/OttoPlanCard.tsx",
  "apps/web/components/otto/PackCard.tsx",
  "apps/web/components/otto/StoryboardCard.tsx",
  "apps/web/components/otto/stuff/AddAssetDialog.tsx",
  // Real-money verification/dev scripts (judge P0 #2): these are not the product's spend path,
  // but they ARE code that can move real money the instant someone runs them — a diff that
  // removes their interlock() guard, points them at a live key by default, or otherwise widens
  // what they do unattended is exactly the class of change this gate exists to catch. Verified
  // by reading each file's own `interlock({ spends: … })` declaration (the shared guard prints
  // and refuses unless I_UNDERSTAND_THIS_SPENDS=yes is set) or, for the two without an interlock
  // call, by confirming they enqueue directly into the live GEN_QUEUE/REFGEN_QUEUE the real
  // worker consumes.
  "scripts/tools/_interlock.mjs",
  "scripts/tools/prod-real-fal-verify.mjs",
  "scripts/tools/refgen-moneysafe.mjs",
  "scripts/tools/test-veo3-sound.mjs",
  "scripts/tools/i2v-tracer.mjs",
  "scripts/tools/refgen-tracer.mjs",
  "apps/web/scripts/verify-reference-video.mjs",
  "scripts/archive/prod-enhance-draft-verify.mjs",
  "scripts/archive/prod-pass1-careful.mjs",
  "scripts/archive/prod-pass2-sloppy.mjs",
  "scripts/archive/prod-pass3-brute.mjs",
  "scripts/archive/prod-pass4-power.mjs",
  "scripts/archive/prod-pass5-mobile.mjs",
  "scripts/archive/prod-quality-sampler.mjs",
  "scripts/archive/prod-refgen-verify.mjs",
  "scripts/archive/cowork-e2e-real.mjs",
  "scripts/archive/test-cowork-llm.mjs",
  // Round 3 (#480 rework, second sealed cross-family judge FAIL — comment 5088727861): these
  // four only refuse `GENERATION_PROVIDER === "fal"`, but apps/worker/src/generation.ts documents
  // BOTH fal AND byteplus as real-money providers ("byteplus when … (prod, real money); fal when
  // … (legacy fallback, real money)") — the judge ran one with GENERATION_PROVIDER=byteplus and
  // confirmed the guard's `rejects` stayed false. All four import handleGen/handleRefGen directly
  // and drive a real job through it, so a provider-check that only excludes ONE of the two real
  // providers leaves the other wide open.
  "scripts/archive/verify-gen-character-no-refs-worker.mjs",
  "scripts/archive/verify-phaseA-base-worker.mjs",
  "scripts/archive/verify-phaseB-variant-worker.mjs",
  "scripts/archive/verify-phaseC-gen-variant-worker.mjs",
  // Gate self-protection (judge P1 #3): the gate's own mechanism — the workflow trigger, the
  // runner that dispatches to it, this script, and the human-facing skill doc it mirrors — must
  // itself be a money-path file. Otherwise a single commit can quietly narrow the list, flip the
  // fail direction, or drop the job from CI, and that same commit clears itself unreviewed.
  ".github/workflows/ci.yml",
  "scripts/ci/run-job.sh",
  "scripts/ci/check-money-path-review.mjs",
  ".claude/skills/money-safety-review/SKILL.md",
  // Round 3 (#480 rework, judge P1 "自保护可被同一提交自删名单解除"): the gate's OWN test file
  // joins the protected set too — editing it also requires a review token. This closes half of
  // the self-delete loop; the other half is a SEPARATE, independent assertion that lives ONLY in
  // that test file (scripts/__tests__/check-money-path-review.test.mjs), not duplicated here on
  // purpose: the judge's exact probe was "delete the self-protection line from MONEY_PATH_FILES
  // in the same commit that does the risky thing." A second copy of this list INSIDE this same
  // file would be defeated by the exact same one-file edit. The independent copy has to live in
  // a file this deletion does not touch, checking THIS FILE'S SOURCE TEXT rather than importing
  // it (importing would also re-run main() — this script has no entry-point guard by design).
  "scripts/__tests__/check-money-path-review.test.mjs",
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
// Round-2 additions (#480 rework), by cluster — each hop confirmed by reading the file, not
// just trusting the judge's line citation:
//   Approval authority — deriveNeedsApproval (skill.ts) is the ONE place cost==="spend" turns
//     into "must ask a human first"; APPROVAL_TOOL_NAMES (approval-tools.ts) is the closed set
//     of tool names the approve/reject matcher will act on, machine-derived so a new gated skill
//     can't be silently un-approvable OR silently skip approval; approval-content-hash.ts binds
//     the SHA-256 of what was actually shown to what gets executed — without it, a card minted
//     for content A could be re-pointed at content B between propose and approve.
//   RefGen type gate — refgen.ts (packages/core) defines the RefGenJob request boundary and the
//     paid queue's retry/expiry policy; nothing downstream re-validates a request this rejects.
//   Factory entrypoints — run-factory-batch.ts declares cost:"spend" (Otto skill classification);
//     factory-actions.ts is the server action that actually wires `startGen` into the per-cell
//     batch loop (`orchestrateBatch({ startGen, prisma }, …)`).
//   Otto RefGen chain — generate-references.ts declares cost:"spend" and is the ONLY skill path
//     into RefGen; otto-refgen-port.ts forwards straight to startRefGen (already listed) with no
//     re-validation of its own; AddAssetDialog.tsx (below) is the client that calls startRefGen
//     directly for the "quick-create from asset" flow, bypassing the Otto skill layer entirely.
//   Client exactly-once entry points — these generate the idempotencyKey and own the
//     outcome-unknown retry/replay decision BEFORE the paid server action ever runs; a bug here
//     (e.g. a re-render that mints a fresh key, or a retry that doesn't preserve one) creates a
//     real double-charge the server-side dedup can't see because it never receives a duplicate
//     key to catch. DetailPanel.tsx (regen/animate), TemplateModal.tsx (template runs),
//     useCanvasGen.ts (canvas gen: freshCanvasActionId + the outcome-unknown replay rule +
//     startCanvasGen's own call site), OttoPlanCard.tsx / PackCard.tsx / StoryboardCard.tsx (the
//     three places `coworkGenerate` is actually invoked from a card the user clicked).
//   gen-from-card.ts (packages/core) — the pure builder `coworkGenerate` uses to turn a
//     persisted card into the exact genRequest object; already covered indirectly through
//     cowork-actions.ts, but a change here changes what EVERY cowork spend actually requests.
//   model-config.ts — assertSpendableModel is the margin-floor / active-model gate `gen-actions.ts`
//     calls immediately before spending; a model that fails this must never be charged for.
// Deliberately NOT listed (checked, not assumed): OttoPlanCard's `ottoApprove` companion call is
// covered because ottoApprove itself lives in otto-actions.ts (already listed); the parking/park
// side of a card (Otto turns before a human clicks) stays $0 and out of scope, same as cowork's
// propose side.
//
// Money-IN: the only CreditAccount/CreditLedger minting call sites, plus the Stripe Checkout /
// pricing entry points that start or define a real payment. The skill's Step 1 defers these to
// the reviewer playbook, so the message points there — but the gate is the same: a money-in diff
// does not merge unreviewed either.
const MONEY_IN_FILES = [
  "apps/web/app/api/stripe/webhook/route.ts",
  "apps/web/lib/credit-actions.ts",
  "apps/web/lib/tenant-actions.ts",
  "apps/web/lib/auth-guard.ts",
  "apps/web/lib/billing-actions.ts",
  // Round 2 (#480 rework): the client entry points that actually START a money-in action, and
  // the Stripe pricing script that DEFINES what customers can buy. Confirmed by reading each —
  // BuyPackButton.tsx calls createTopupCheckout (already listed) directly; TenantDetail.tsx and
  // AdminDashboardV2.tsx are the two admin credit-grant forms, each minting its own
  // `admin-*-grant:<uuid>` idempotency key client-side before calling the server grant action.
  "apps/web/components/billing/BuyPackButton.tsx",
  "apps/web/components/admin/TenantDetail.tsx",
  "apps/web/components/admin/AdminDashboardV2.tsx",
  // create-credit-packs.mjs (#480 rework): under ALLOW_LIVE=1 with a live Stripe key this
  // creates REAL Products/Prices — i.e. it defines what a real customer can buy for real money.
  "apps/web/scripts/create-credit-packs.mjs",
  // seed-local-qa-data.mjs (round 3, judge P0 "直接 creditAccount.upsert + creditLedger.
  // createMany"): a direct CreditLedger writer, the skill's own catch-all category. Its
  // "DATABASE_URL must point at localhost" guard is NOT a code-level guarantee against a real
  // write — packages/db/src/index.ts builds the actual Prisma connection from
  // `DATABASE_URL_POOLED || DATABASE_URL`, so a shell that happens to export a real
  // DATABASE_URL_POOLED (e.g. inherited from a deploy/staging profile) bypasses this script's
  // check entirely and mints real credits against a real database.
  "scripts/tools/seed-local-qa-data.mjs",
];
// billing-actions.ts (#480) — createTopupCheckout starts the real Stripe Checkout session a
// customer pays through; listCreditPacks reads the live Stripe Price catalog that prices it.
// apps/web/lib/stripe.ts (the Stripe SDK client construction) is deliberately NOT listed — it
// makes no spend decision, same reasoning as the barrel-export exclusion above.
const MONEY_PATH_PREFIXES = ["packages/db/prisma/migrations/"];
// The SHA group requires exactly 40 hex chars (#480 rework, judge P1 #1): a 7-40 char range
// combined with startsWith() let a stale-but-correct 7-char PREFIX of a LATER head keep passing
// forever, and let a reviewer type a short token that just happens to prefix whatever head comes
// next. The stamp must name the exact head, not a prefix of it — see the equality check below.
const TOKEN = /\[MONEY-SAFETY-REVIEWED:\s*([^\]@]+?)\s*@\s*([0-9a-f]{40})\s*\]/i;
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
//
// --no-renames is load-bearing (#480 rework, judge P0 #3): with Git's rename detection ON,
// `--name-only` reports ONLY the destination path of a rename — renaming a listed file
// (e.g. gen-actions.ts) to any unlisted path made the gate print "no money-path file in this
// pull request" (verified: PASS, exit 0) while the diff still carried the full old content
// under the new name. Turning detection off makes Git report a rename as a plain delete of the
// old path + a plain add of the new path; the 'D' entry for the OLD path still trips a listed
// file, and the 'A' entry for the new path is exactly what a genuinely new file's diff would be.
function changedFiles(base, head) {
  const mergeBase = git(["merge-base", base, head], { allowFailure: true });
  const from = mergeBase ? mergeBase.trim() : base;
  const diff = git(["diff", "--no-renames", "--name-only", "--diff-filter=ACDMRT", from, head]);
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
// diff touches; both sides need the same token in a qualifying PR comment.
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

// A comment only counts as a review if the commenter has real standing on this repo — not just
// any GitHub account, which forecloses an attacker using a second, throwaway account to "review"
// their own PR (round 3, judge P1 "凭证署名不认证可伪造"). GitHub returns author_association on
// every comment for free (no second API call).
const QUALIFYING_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

// Test-only escape hatch: when set, PR comments are read from this JSON fixture file (an array
// shaped like the GitHub comments API response) instead of the live API. This is the ONLY way to
// exercise findQualifyingComment()'s logic and the fail-closed API-error path offline — it is
// never referenced by ci.yml, so it is never set in the real workflow. Point it at a missing/
// unparseable path to simulate "the API was unreachable" through the exact same catch block a
// real network failure hits.
const COMMENTS_FIXTURE_ENV = "MONEY_PATH_REVIEW_COMMENTS_FIXTURE";

// Fetches the PR's top-level (issue) comments — where a human reviewer posts, as opposed to
// inline review comments on a specific diff line — authenticated with the job's own default
// GITHUB_TOKEN. Throws on ANY failure; the caller treats every throw identically: fail closed.
async function fetchPrComments({ repo, prNumber }) {
  const fixturePath = process.env[COMMENTS_FIXTURE_ENV];
  if (fixturePath) {
    const parsed = JSON.parse(readFileSync(fixturePath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error(`${COMMENTS_FIXTURE_ENV} must contain a JSON array`);
    return parsed;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set — cannot verify PR comments");
  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} ${response.statusText} for ${url}`);
  }
  const parsed = await response.json();
  if (!Array.isArray(parsed)) throw new Error("GitHub API returned a non-array comments payload");
  return parsed;
}

// Scans every comment for one that clears every bar: matches TOKEN, names a non-blank reviewer,
// binds the exact current head SHA, and comes from someone OTHER than the PR author who has
// OWNER/MEMBER/COLLABORATOR standing. Returns the first fully-qualifying match, or the most
// specific rejection reason found across every syntactically-matching comment (priority: stale
// SHA > blank reviewer > insufficient standing > self-authored > nothing found at all) so the
// FAIL message is actionable instead of generic.
function findQualifyingComment(comments, { head, prAuthorLogin }) {
  let sawSelfAuthored = false;
  let sawInsufficientStanding = null;
  let sawBlankReviewer = false;
  let sawStaleSha = null;
  for (const comment of comments) {
    const body = typeof comment?.body === "string" ? comment.body : "";
    const match = body.match(TOKEN);
    if (!match) continue;
    const [, reviewer, stampedSha] = match;
    const commenterLogin = comment?.user?.login;
    if (!commenterLogin || commenterLogin === prAuthorLogin) {
      sawSelfAuthored = true;
      continue;
    }
    if (!QUALIFYING_ASSOCIATIONS.has(comment?.author_association)) {
      sawInsufficientStanding = { commenterLogin, association: comment?.author_association ?? "NONE" };
      continue;
    }
    if (!reviewer.trim()) {
      sawBlankReviewer = true;
      continue;
    }
    if (head.toLowerCase() !== stampedSha.toLowerCase()) {
      sawStaleSha = { commenterLogin, stampedSha };
      continue;
    }
    return { ok: true, reviewer: reviewer.trim(), commenterLogin };
  }
  if (sawStaleSha) {
    return {
      ok: false,
      reason: `@${sawStaleSha.commenterLogin} stamped ${sawStaleSha.stampedSha}, but the current head is ${head} — re-review the new commits and re-stamp`,
    };
  }
  if (sawBlankReviewer) {
    return { ok: false, reason: "a qualifying reviewer's comment names a blank reviewer — name a real reviewer" };
  }
  if (sawInsufficientStanding) {
    return {
      ok: false,
      reason: `@${sawInsufficientStanding.commenterLogin} posted a review token but has no OWNER/MEMBER/COLLABORATOR standing on this repo (author_association=${sawInsufficientStanding.association})`,
    };
  }
  if (sawSelfAuthored) {
    return {
      ok: false,
      reason: "a review token was found, but only authored by the PR's own author — someone other than the author must post it",
    };
  }
  return { ok: false, reason: null };
}

// Distinguishes "no GITHUB_EVENT_PATH at all" (a genuine local run — advisory is correct) from
// "GITHUB_EVENT_PATH IS set but the file could not be read or parsed" (#480 rework, judge P1
// #2: this used to collapse both into `null` and fall through to the same open, advisory-only
// path — a truncated/corrupt event in CI silently cleared the gate instead of failing closed).
// hasEventFile=true + event=null is now the ONE shape main() treats as a hard failure.
function readEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return { hasEventFile: false, path: null, event: null };
  try {
    return { hasEventFile: true, path, event: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { hasEventFile: true, path, event: null, error };
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

// The ONLY sequence that clears this gate. Order matters: the token names the head SHA, so it
// can only be written after the last commit is pushed. Unlike the old body-token mechanism, no
// special re-run trick is needed to pick up a new comment — comments are read LIVE from the API
// on every run, so a plain "Re-run jobs" (which replays the cached event payload) still sees it.
function stampInstructions(head) {
  return [
    "clear it in this order — any other order cannot go green:",
    "  1. commit and push every change you still intend to make (a later push voids the token)",
    "  2. read the new head SHA:  git rev-parse HEAD",
    `  3. have someone OTHER than the PR's author post a PR COMMENT (not the body, not an inline review comment) containing: [MONEY-SAFETY-REVIEWED: <reviewer> @ ${head}]`,
    "  4. that reviewer needs OWNER/MEMBER/COLLABORATOR standing on this repo — an outside contributor's comment does not qualify",
    "  5. re-run the job (or push again, or just wait for the next scheduled trigger) — comments are checked live, no special replay handling needed",
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

async function main() {
  const { hasEventFile, path, event, error: readError } = readEvent();
  // hasEventFile means we ARE in an automated context (GITHUB_EVENT_PATH is set by the runner);
  // event===null there means the file could not be read or parsed. That is never "no PR
  // context" — it is a broken CI event, and an unreadable event cannot prove the spend path is
  // untouched. Fail closed instead of falling through to the open, local-only advisory path.
  if (hasEventFile && event === null) {
    fail([
      `GITHUB_EVENT_PATH is set (${path}) but the event payload could not be read or parsed${readError ? `: ${readError.message}` : ""}`,
      "failing closed: a broken CI event cannot prove the spend path is untouched",
    ]);
    return;
  }

  const pr = event?.pull_request;
  // Round 3 (#480 rework, judge P1 "合法空 JSON 事件仍劝告放行"): a well-formed JSON event that
  // simply lacks the pull_request.head/base structure used to fall straight through to the open,
  // local-only advisory path — indistinguishable from "not a PR run at all." GITHUB_ACTIONS sets
  // GITHUB_EVENT_NAME to the actual triggering event unconditionally; if it says "pull_request"
  // but the payload can't produce head/base SHAs, that is a structurally broken PR event (a
  // truncated payload, an unexpected schema change, a synthetic/malformed replay), not the
  // absence of PR context — and an unreadable structure cannot prove the spend path is untouched
  // any more than unparseable JSON could. Only fall through to localAdvisory() when
  // GITHUB_EVENT_NAME does not claim this is a pull_request run at all (unset local run, or a
  // genuine non-PR event like `push`).
  if (!pr?.head?.sha || !pr?.base?.sha) {
    if (process.env.GITHUB_EVENT_NAME === "pull_request") {
      fail([
        "GITHUB_EVENT_NAME=pull_request but the event payload has no pull_request.head/base SHAs",
        "failing closed: a structurally incomplete pull_request event cannot prove the spend path is untouched",
      ]);
      return;
    }
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

  // Round 3 (#480 rework, judge P1 "凭证署名不认证可伪造"): the token is no longer read from
  // pr.body (self-editable by the PR author) — it must appear in a qualifying PR comment,
  // verified live against the GitHub API. See findQualifyingComment() for the exact bar.
  const prAuthorLogin = pr.user?.login;
  const prNumber = pr.number;
  const repo = process.env.GITHUB_REPOSITORY || event?.repository?.full_name;
  if (!prAuthorLogin || !prNumber || !repo) {
    fail([
      ...touched.map((file) => `money-path file changed: ${file}`),
      "cannot verify an independent reviewer comment: the PR event is missing author login, PR number, or repository",
      "failing closed: an incomplete PR identity cannot prove an independent review happened",
    ]);
    return;
  }

  let comments;
  try {
    comments = await fetchPrComments({ repo, prNumber });
  } catch (error) {
    fail([
      ...touched.map((file) => `money-path file changed: ${file}`),
      `could not verify PR review comments: ${error.message}`,
      "failing closed: an unreachable review-comment check cannot prove an independent review happened",
    ]);
    return;
  }

  const verdict = findQualifyingComment(comments, { head, prAuthorLogin });
  if (!verdict.ok) {
    fail([
      ...touched.map((file) => `money-path file changed: ${file}`),
      ...(verdict.reason ? [verdict.reason] : reviewPointers(touched)),
      ...stampInstructions(head),
    ]);
    return;
  }
  pass(`money path reviewed by ${verdict.reviewer} (@${verdict.commenterLogin}) at ${head.slice(0, 12)} (${touched.length} file(s))`);
}

main().catch((error) => {
  fail([
    error?.stack ?? String(error),
    "failing closed: an unexpected error cannot prove the spend path is untouched",
  ]);
});
