// Shape matrix for the two harness locks (.claude/hooks/). Every row here is a shape that
// a sealed review actually walked through by hand; pinning them means the same class of
// failure comes back red instead of silently.
//
// Both directions are load-bearing and both have already failed in production review:
//   * a shape that must be BLOCKED and was allowed = the lock is decoration
//     (round 2: `env FOO=1 gh pr merge`, `./gh pr merge`, `command gh pr merge`, and
//      `env FOO=1 tee docs/BLUEPRINT.md` all exited 0);
//   * a shape that must be ALLOWED and was blocked = the whole project stops
//     (round 2: a worker writing to a path containing a newline exited 2).
// So do not delete an "allow" row to make a stricter guard pass. A guard that fires on the
// normal push→open-PR flow gets switched off, and then it guards nothing.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  argvOf,
  basenameOf,
  clausesOf,
  commandIndexes,
  ghVerdict,
  headIndexOf,
  pushArgsOf,
  pushVerdict,
  writeTargets,
  isWorkerTranscript as bashIsWorkerTranscript,
} from "../../.claude/hooks/bash-guard.mjs";
import {
  isWorkerTranscript as writeIsWorkerTranscript,
  nearestExistingDir,
  targetOf,
  verdict as writeVerdict,
} from "../../.claude/hooks/write-guard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WRITE_HOOK = join(ROOT, ".claude", "hooks", "pretooluse-write-guard.sh");
const BASH_HOOK = join(ROOT, ".claude", "hooks", "pretooluse-bash-guard.sh");

const TOP_TRANSCRIPT = "/Users/x/.claude/projects/p/f7b1.jsonl";
const WORKER_TRANSCRIPT = "/Users/x/.claude/projects/p/f7b1/subagents/agent-9.jsonl";

// A repo file that certainly exists, and one that certainly does not but whose parent does.
const REPO_FILE = join(ROOT, "packages", "core", "src", "gen.ts");
const REPO_NEW_FILE = join(ROOT, "packages", "core", "src", "no-such-dir", "new.ts");

function runHook(hook, payload, env = {}) {
  const result = spawnSync("sh", [hook], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, ...env },
  });
  return result.status;
}

const writePayload = (filePath, transcript, key = "file_path") => ({
  tool_name: "Write",
  tool_input: { [key]: filePath },
  transcript_path: transcript,
});

const bashPayload = (command, transcript, cwd = ROOT) => ({
  tool_name: "Bash",
  tool_input: { command },
  transcript_path: transcript,
  cwd,
});

// ─────────────────────────────────────────────────────────────────────────────
// Lock 1 — the orchestrator does not write code
// ─────────────────────────────────────────────────────────────────────────────

test("lock 1 allows every shape a worker or an out-of-repo write can take", () => {
  const allowed = [
    ["worker writes a repository file", writePayload(REPO_FILE, WORKER_TRANSCRIPT)],
    ["worker writes a file that does not exist yet", writePayload(REPO_NEW_FILE, WORKER_TRANSCRIPT)],
    [
      "worker transcript identified by the agent- prefix, not by depth",
      writePayload(REPO_FILE, "/Users/x/subagents/a/b/agent-2.jsonl"),
    ],
    // The round-2 P1: file_path is a MODEL-AUTHORED field. A newline inside it used to shift
    // the transcript out of line 2 and blocked the worker — a project-wide outage.
    [
      "worker writes a path containing a newline",
      writePayload(`${REPO_FILE}\nstray fragment`, WORKER_TRANSCRIPT),
    ],
    ["orchestrator writes outside the repository", writePayload("/tmp/scratch/notes.md", TOP_TRANSCRIPT)],
    // Fail-open family: absent evidence must never block anyone.
    ["no transcript field at all", { tool_input: { file_path: REPO_FILE } }],
    ["empty transcript", writePayload(REPO_FILE, "")],
    ["null transcript", { tool_input: { file_path: REPO_FILE }, transcript_path: null }],
    ["missing file_path", { transcript_path: TOP_TRANSCRIPT, tool_input: {} }],
    ["null file_path", { transcript_path: TOP_TRANSCRIPT, tool_input: { file_path: null } }],
    ["empty file_path", writePayload("", TOP_TRANSCRIPT)],
    ["no tool_input at all", { transcript_path: TOP_TRANSCRIPT }],
  ];
  for (const [label, payload] of allowed) {
    assert.equal(runHook(WRITE_HOOK, payload), 0, `must ALLOW: ${label}`);
  }
  assert.equal(runHook(WRITE_HOOK, "not json at all"), 0, "must ALLOW: unparseable payload");
  assert.equal(runHook(WRITE_HOOK, ""), 0, "must ALLOW: empty payload");
});

test("lock 1 blocks every shape of a top-level write into this repository", () => {
  const blocked = [
    ["orchestrator writes a repository file", writePayload(REPO_FILE, TOP_TRANSCRIPT)],
    ["orchestrator creates a file in a directory that does not exist yet", writePayload(REPO_NEW_FILE, TOP_TRANSCRIPT)],
    ["notebook_path is the same lock", writePayload(REPO_FILE, TOP_TRANSCRIPT, "notebook_path")],
    ["camelCase filePath is the same lock", writePayload(REPO_FILE, TOP_TRANSCRIPT, "filePath")],
    // CLAUDE_CONFIG_DIR=/tmp/subagents/… must not hand a top-level session worker rights.
    [
      "a config directory that merely contains the word subagents",
      writePayload(REPO_FILE, "/tmp/subagents/projects/p/f7b1.jsonl"),
    ],
    // The other half of the round-2 P1: file_path smuggling a fake worker transcript into
    // the second line of what used to be a shared newline-separated stream.
    [
      "orchestrator smuggles a worker transcript through a newline in file_path",
      writePayload(`${REPO_FILE}\n/s/subagents/agent-1.jsonl`, TOP_TRANSCRIPT),
    ],
  ];
  for (const [label, payload] of blocked) {
    assert.equal(runHook(WRITE_HOOK, payload), 2, `must BLOCK: ${label}`);
  }
});

test("lock 1 kill switches are the only documented escape", () => {
  const payload = writePayload(REPO_FILE, TOP_TRANSCRIPT);
  assert.equal(runHook(WRITE_HOOK, payload), 2);
  assert.equal(runHook(WRITE_HOOK, payload, { FIKIRTIVE_ORCH_WRITE_OK: "1" }), 0);
  assert.equal(runHook(WRITE_HOOK, payload, { FIKIRTIVE_HOOKS_OFF: "1" }), 0);
});

test("lock 1 unit: tier evidence, target extraction and ancestor resolution", () => {
  assert.equal(writeIsWorkerTranscript("/a/b/subagents/agent-1.jsonl"), true);
  assert.equal(writeIsWorkerTranscript("/a/b/subagents/anything.jsonl"), true);
  assert.equal(writeIsWorkerTranscript("/tmp/subagents/p/s.jsonl"), false);
  assert.equal(writeIsWorkerTranscript("/a/b/s.jsonl"), false);
  // The two guards must agree on who a worker is, or one of them is wrong about tier.
  for (const path of [
    "/a/b/subagents/agent-1.jsonl",
    "/a/b/subagents/anything.jsonl",
    "/tmp/subagents/p/s.jsonl",
    "/a/b/s.jsonl",
  ]) {
    assert.equal(writeIsWorkerTranscript(path), bashIsWorkerTranscript(path), path);
  }

  assert.equal(targetOf({ file_path: "/a" }), "/a");
  assert.equal(targetOf({ notebookPath: "/a" }), "/a");
  assert.equal(targetOf({ file_path: 7 }), "");
  assert.equal(targetOf({}), "");
  assert.equal(nearestExistingDir(REPO_NEW_FILE), join(ROOT, "packages", "core", "src"));

  // Repository resolution failing is an allow, never a block.
  assert.equal(
    writeVerdict({
      filePath: REPO_FILE,
      transcript: TOP_TRANSCRIPT,
      projectDir: ROOT,
      resolveCommonDir: () => null,
    }),
    null,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Lock 2 — commands nobody in this project may run
// ─────────────────────────────────────────────────────────────────────────────

// The merge lock has NO server-side backstop: the protect-main ruleset requires 0 approving
// reviews and declares no required status checks, so this hook is the only machine gate on
// `gh pr merge`. Every prefix form below was ALLOW before the command-head unification.
const MERGE_SHAPES = [
  "gh pr merge 471",
  "gh pr merge 471 --squash --auto",
  "./gh pr merge 471",
  "/usr/local/bin/gh pr merge 471",
  "env FOO=1 gh pr merge 471",
  "env -i FOO=1 gh pr merge 471",
  "command gh pr merge 471",
  "sudo gh pr merge 471",
  "xargs gh pr merge",
  "timeout 30 gh pr merge 471",
  "GH_TOKEN=x gh pr merge 471",
  "gh api --method PUT repos/o/r/pulls/471/merge",
  "gh api -X POST repos/o/r/merges",
  "env FOO=1 gh api --method=PUT repos/o/r/pulls/471/merge",
  "git status && gh pr merge 471",
];

// The Blueprint lock binds EVERYONE, workers included (project law clause 8).
const BLUEPRINT_SHAPES = [
  "tee docs/BLUEPRINT.md",
  "env FOO=1 tee docs/BLUEPRINT.md",
  "command tee -a docs/BLUEPRINT.md",
  "./tee docs/BLUEPRINT.md",
  "sudo tee docs/BLUEPRINT.md",
  "sed -i '' 's/a/b/' docs/BLUEPRINT.md",
  "env FOO=1 sed -i '' 's/a/b/' docs/BLUEPRINT.md",
  "cat > docs/BLUEPRINT.md <<EOF",
  "echo x >> scripts/blueprint.sha256",
  "node scripts/update-blueprint-hash.mjs",
];

// Push shapes: destination comes from the refspec, or from the branch the push inherits.
const PUSH_SHAPES = [
  "git push origin main",
  "git push origin HEAD:main",
  "git push origin refs/heads/main",
  "git push origin +claude/x",
  "git push --force origin claude/x",
  "git push -f origin claude/x",
  "git push origin claude/x --force-with-lease",
  "env FOO=1 git push origin main",
  "xargs git push origin main",
  // A branch literally called gh must not make the clause look like a gh command and
  // skip the push matcher — found while unifying the command-head resolver.
  "git push origin main gh",
];

// The orchestrator's shell write lock — worker side of the SAME command must stay open.
const ORCH_WRITE_SHAPES = [
  `tee ${REPO_FILE}`,
  `env FOO=1 tee ${REPO_FILE}`,
  `command tee ${REPO_FILE}`,
  `sudo tee ${REPO_FILE}`,
  `sed -i '' 's/a/b/' ${REPO_FILE}`,
  `env FOO=1 sed -i '' 's/a/b/' ${REPO_FILE}`,
  `echo x > ${REPO_FILE}`,
];

// Legitimate work. Round 1 blocked the first two of these, which is how a guard gets
// switched off; they are pinned so no future tightening can take them out again.
const ALLOWED_SHAPES = [
  "git push -u origin claude/task && gh pr create --base main --title x",
  "git push origin claude/x; git log origin/main..HEAD",
  "git push origin HEAD",
  "git push",
  "gh pr view 471",
  "gh pr comment 471 --body 'evidence'",
  "gh pr diff 471",
  "git commit -m 'merge main into this branch'",
  "git checkout -b claude/main-ish",
  "echo notes > /tmp/scratch.txt",
  "bash scripts/ci/run-job.sh check > /dev/null",
  "node scripts/task-ownership-check.mjs check",
];

test("lock 2 blocks the merge lock under every command-head prefix, for every tier", () => {
  for (const command of MERGE_SHAPES) {
    for (const [tier, transcript] of [["worker", WORKER_TRANSCRIPT], ["orchestrator", TOP_TRANSCRIPT]]) {
      assert.equal(runHook(BASH_HOOK, bashPayload(command, transcript)), 2, `must BLOCK (${tier}): ${command}`);
    }
  }
});

test("lock 2 blocks Blueprint writes for every tier, including workers", () => {
  for (const command of BLUEPRINT_SHAPES) {
    for (const [tier, transcript] of [["worker", WORKER_TRANSCRIPT], ["orchestrator", TOP_TRANSCRIPT]]) {
      assert.equal(runHook(BASH_HOOK, bashPayload(command, transcript)), 2, `must BLOCK (${tier}): ${command}`);
    }
  }
  // The Founder's amendment flow is the one documented escape — and it opens ONLY the
  // Blueprint clause. An orchestrator amending still meets the write lock and needs the
  // second switch too; that layering is deliberate, so pin all three outcomes.
  assert.equal(
    runHook(BASH_HOOK, bashPayload("tee docs/BLUEPRINT.md", WORKER_TRANSCRIPT), { FIKIRTIVE_BLUEPRINT_AMEND: "1" }),
    0,
  );
  assert.equal(
    runHook(BASH_HOOK, bashPayload("tee docs/BLUEPRINT.md", TOP_TRANSCRIPT), { FIKIRTIVE_BLUEPRINT_AMEND: "1" }),
    2,
  );
  assert.equal(
    runHook(BASH_HOOK, bashPayload("tee docs/BLUEPRINT.md", TOP_TRANSCRIPT), {
      FIKIRTIVE_BLUEPRINT_AMEND: "1",
      FIKIRTIVE_ORCH_WRITE_OK: "1",
    }),
    0,
  );
});

test("lock 2 blocks direct-to-main and force pushes for every tier", () => {
  for (const command of PUSH_SHAPES) {
    for (const [tier, transcript] of [["worker", WORKER_TRANSCRIPT], ["orchestrator", TOP_TRANSCRIPT]]) {
      assert.equal(runHook(BASH_HOOK, bashPayload(command, transcript)), 2, `must BLOCK (${tier}): ${command}`);
    }
  }
});

test("lock 2 blocks the orchestrator's shell writes and leaves the worker's alone", () => {
  for (const command of ORCH_WRITE_SHAPES) {
    assert.equal(runHook(BASH_HOOK, bashPayload(command, TOP_TRANSCRIPT)), 2, `must BLOCK (orchestrator): ${command}`);
    assert.equal(runHook(BASH_HOOK, bashPayload(command, WORKER_TRANSCRIPT)), 0, `must ALLOW (worker): ${command}`);
  }
  assert.equal(
    runHook(BASH_HOOK, bashPayload(`tee ${REPO_FILE}`, TOP_TRANSCRIPT), { FIKIRTIVE_ORCH_WRITE_OK: "1" }),
    0,
  );
  assert.equal(runHook(BASH_HOOK, bashPayload(`tee ${REPO_FILE}`, TOP_TRANSCRIPT), { FIKIRTIVE_HOOKS_OFF: "1" }), 0);
});

test("lock 2 leaves the normal push → open-PR flow alone", () => {
  for (const command of ALLOWED_SHAPES) {
    for (const [tier, transcript] of [["worker", WORKER_TRANSCRIPT], ["orchestrator", TOP_TRANSCRIPT]]) {
      assert.equal(runHook(BASH_HOOK, bashPayload(command, transcript)), 0, `must ALLOW (${tier}): ${command}`);
    }
  }
  // Fail-open family.
  assert.equal(runHook(BASH_HOOK, "not json"), 0);
  assert.equal(runHook(BASH_HOOK, ""), 0);
  assert.equal(runHook(BASH_HOOK, { tool_input: { command: "   " }, transcript_path: TOP_TRANSCRIPT }), 0);
});

test("lock 2 reads the branch from git -C, not from the session's cwd", (t) => {
  // A bare `git push` inherits its destination from the checkout git actually runs in.
  // Reading it from cwd judged `git -C <a checkout sitting on main> push` against the
  // WRONG branch — the guard already parsed -C to skip arguments, then ignored it.
  const root = mkdtempSync(join(tmpdir(), "fikirtive-hooks-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const onMain = join(root, "on-main");
  mkdirSync(onMain);
  const git = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" });
  git(["init", "-b", "main"], onMain);
  git(["config", "user.email", "hooks@example.test"], onMain);
  git(["config", "user.name", "Hooks Test"], onMain);
  writeFileSync(join(onMain, "seed.txt"), "seed\n");
  git(["add", "."], onMain);
  git(["commit", "-m", "seed"], onMain);
  const onTask = join(root, "on-task");
  git(["worktree", "add", "-b", "claude/task", onTask], onMain);

  const fromTask = (command) =>
    runHook(BASH_HOOK, bashPayload(command, TOP_TRANSCRIPT, onTask), { CLAUDE_PROJECT_DIR: onTask });

  assert.equal(fromTask("git push"), 0, "a bare push from the task worktree is legitimate");
  assert.equal(fromTask(`git -C ${onMain} push`), 2, "the -C checkout is on main");
  assert.equal(fromTask(`git -C ${onMain} push origin HEAD`), 2, "HEAD in the -C checkout is main");

  assert.deepEqual(pushArgsOf(argvOf(`git -C ${onMain} push`)), { args: [], dir: onMain });
  assert.equal(pushArgsOf(argvOf("git push origin x")).dir, null);
});

test("lock 2 unit: one shared command-head resolver, used by all three matchers", () => {
  assert.equal(basenameOf("/usr/bin/gh"), "gh");
  assert.deepEqual(commandIndexes(argvOf("env FOO=1 gh pr merge"), "gh"), [2]);
  assert.deepEqual(commandIndexes(argvOf("command gh pr merge"), "gh"), [1]);
  assert.deepEqual(commandIndexes(argvOf("./gh pr merge"), "gh"), [0]);
  assert.deepEqual(commandIndexes(argvOf("timeout 30 gh pr merge"), "gh"), [2]);
  assert.deepEqual(commandIndexes(argvOf("ls -la"), "gh"), []);

  // All three matchers must agree that these prefixes name the same program.
  for (const prefix of ["", "./", "env FOO=1 ", "command ", "sudo ", "/usr/bin/"]) {
    assert.ok(ghVerdict(argvOf(`${prefix}gh pr merge 1`)), `gh matcher: ${prefix}`);
    assert.ok(
      writeTargets(`${prefix}tee docs/BLUEPRINT.md`).includes("docs/BLUEPRINT.md"),
      `write matcher: ${prefix}`,
    );
    assert.ok(pushArgsOf(argvOf(`${prefix}git push origin main`)), `push matcher: ${prefix}`);
  }
  assert.equal(ghVerdict(argvOf("gh pr view 1")), null);
  assert.equal(pushArgsOf(argvOf("git status")), null);
  // The strict head is what decides "is this clause a gh call"; the permissive scan is
  // only for finding a program that a wrapper may have hidden.
  assert.equal(headIndexOf(argvOf("env FOO=1 gh pr merge")), 2);
  assert.equal(headIndexOf(argvOf("git push origin main gh")), 0);
  assert.equal(headIndexOf(argvOf("FOO=1")), -1);

  // Clause splitting stays the reason this is not a grep.
  assert.deepEqual(clausesOf("git push origin x && gh pr create"), ["git push origin x", "gh pr create"]);
});
