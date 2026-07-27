import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const JOBS = ["check", "test", "web-build", "lint", "money-path-review"];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function jobBlocks(workflow) {
  const lines = workflow.split("\n");
  const jobsLine = lines.findIndex((line) => line === "jobs:");
  if (jobsLine === -1) return new Map();
  const jobsLines = [];
  for (const line of lines.slice(jobsLine + 1)) {
    if (line.trim() && !line.startsWith(" ") && !line.startsWith("#")) break;
    jobsLines.push(line);
  }
  const jobsSource = jobsLines.join("\n");
  const blocks = new Map();
  const pattern = /^  ([A-Za-z0-9_-]+):\s*\n([\s\S]*?)(?=^  [A-Za-z0-9_-]+:\s*$|(?![\s\S]))/gm;
  for (const match of jobsSource.matchAll(pattern)) blocks.set(match[1], match[2]);
  return blocks;
}

function fencedLines(markdown) {
  const lines = [];
  for (const match of markdown.matchAll(/```(?:bash|sh)?\s*\n([\s\S]*?)\n```/g)) {
    lines.push(...match[1].split("\n").map((line) => line.trim()).filter(Boolean));
  }
  return lines;
}

export function parityErrors({ workflow, runbook, runner }) {
  const errors = [];
  const blocks = jobBlocks(workflow);
  if (!assertSetsEqual([...blocks.keys()], JOBS)) {
    errors.push("workflow jobs must be the closed check/test/web-build/lint/money-path-review set");
  }
  for (const job of JOBS) {
    const block = blocks.get(job);
    if (!block) {
      errors.push(`workflow is missing job ${job}`);
      continue;
    }
    const runLines = [...block.matchAll(/^\s*- run:\s*(.*?)\s*$/gm)].map((match) => match[1]);
    const expected = `bash scripts/ci/run-job.sh ${job}`;
    if (runLines.length !== 1 || runLines[0] !== expected) {
      errors.push(`workflow job ${job} must have exactly one run step: ${expected}`);
    }
  }

  const runbookLines = fencedLines(runbook);
  const invocations = runbookLines.filter((line) => line.startsWith("bash scripts/ci/run-job.sh "));
  const expectedInvocations = JOBS.map((job) => `bash scripts/ci/run-job.sh ${job}`);
  if (!assertSetsEqual(invocations, expectedInvocations)) {
    errors.push("runbook must list each canonical runner invocation exactly once");
  }
  for (const line of runbookLines) {
    if (
      (/^pnpm\s+/.test(line) && line !== "pnpm --version") ||
      /^node\s+scripts\//.test(line) ||
      /^bash\s+scripts\/(?:check-|verify-|route-b-)/.test(line)
    ) {
      errors.push(`runbook duplicates an inner CI recipe: ${line}`);
    }
  }

  const caseLabels = [...runner.matchAll(/^\s{2}([a-z][a-z0-9-]*)\)\s*$/gm)].map(
    (match) => match[1],
  );
  if (!assertSetsEqual(caseLabels, JOBS)) {
    errors.push("runner case arms must be the closed check/test/web-build/lint/money-path-review set");
  }
  const guard = runner.match(/^\s{2}([a-z][a-z0-9|_-]*)\) ;;\s*$/m);
  const guardedJobs = guard ? guard[1].split("|") : [];
  if (!assertSetsEqual(guardedJobs, JOBS)) {
    errors.push("runner argument guard must accept only check/test/web-build/lint/money-path-review");
  }
  return errors;
}

function assertSetsEqual(actual, expected) {
  return (
    actual.length === expected.length &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  );
}

const actual = {
  workflow: readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8"),
  runbook: readFileSync(join(ROOT, "docs", "runbooks", "local-ci.md"), "utf8"),
  runner: readFileSync(join(ROOT, "scripts", "ci", "run-job.sh"), "utf8"),
};

test("green: workflow and runbook share the five canonical runner commands", () => {
  assert.deepEqual(parityErrors(actual), []);
});

test("red: a missing or misspelled workflow invocation fails", () => {
  for (const workflow of [
    actual.workflow.replace("      - run: bash scripts/ci/run-job.sh lint\n", ""),
    actual.workflow.replace("run-job.sh web-build", "run-job.sh webbuild"),
  ]) {
    assert.notDeepEqual(parityErrors({ ...actual, workflow }), []);
  }
});

test("red: a second workflow recipe or duplicated runbook recipe fails", () => {
  const workflow = actual.workflow.replace(
    "      - run: bash scripts/ci/run-job.sh check",
    "      - run: bash scripts/ci/run-job.sh check\n      - run: pnpm -r typecheck",
  );
  assert.match(parityErrors({ ...actual, workflow }).join("\n"), /exactly one run step/);

  const runbook = `${actual.runbook}\n\`\`\`bash\npnpm -r typecheck\n\`\`\`\n`;
  assert.match(parityErrors({ ...actual, runbook }).join("\n"), /duplicates an inner CI recipe/);
});

test("red: changing the runner closed set fails", () => {
  const runner = actual.runner.replace(/^  lint\)$/m, "  lint-extra)");
  assert.match(parityErrors({ ...actual, runner }).join("\n"), /closed/);
  const widenedGuard = actual.runner.replace(
    "check|test|web-build|lint|money-path-review) ;;",
    "check|test|web-build|lint|money-path-review|surprise) ;;",
  );
  assert.match(parityErrors({ ...actual, runner: widenedGuard }).join("\n"), /argument guard/);
});

test("red: adding an unknown workflow job fails", () => {
  const workflow = `${actual.workflow}\n  surprise:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo surprise\n`;
  assert.match(
    parityErrors({ ...actual, workflow }).join("\n"),
    /workflow jobs must be the closed/,
  );
});

test("red: missing and unknown CLI job names exit with usage status 64", () => {
  for (const args of [[], ["surprise"]]) {
    const result = spawnSync("bash", [join(ROOT, "scripts", "ci", "run-job.sh"), ...args], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 64);
    assert.match(result.stderr, /usage:/);
  }
});

test("red: test job rejects a non-_test database without echoing its URL", () => {
  const secret = "PARITY_SECRET_MUST_NOT_PRINT";
  const result = spawnSync(
    "bash",
    [join(ROOT, "scripts", "ci", "run-job.sh"), "test"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://user:${secret}@localhost:5432/production`,
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refuses a non-_test database/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(secret));
});
