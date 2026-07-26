import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  AuthorityError,
  checkProjectAuthority,
  OVERLAY_CLAIM_ANCHOR,
  RETIRED_PATHS,
} from "../check-project-authority.mjs";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "fikirtive-authority-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "Authority Test"]);
  git(repo, ["config", "user.email", "authority@example.test"]);
  write(
    join(repo, ".claude", "CLAUDE.md"),
    "stable project law\nevery repository-mutating task must acquire one task-linked `ACTIVE` claim\n",
  );
  symlinkSync(".claude/CLAUDE.md", join(repo, "AGENTS.md"));
  write(
    join(repo, ".claude", "skills", "fikirtive-orchestration-overlay", "SKILL.md"),
    `bounded overlay\n${OVERLAY_CLAIM_ANCHOR}\n` +
      "Claim 政策以项目法第 12 条与 `docs/runbooks/task-ownership.md` 为准:" +
      "每个 repo-mutating task 必须在首次 mutation 前取得自己的 task-linked `ACTIVE` claim。\n",
  );
  write(join(repo, "README.md"), "repository navigation\n");
  write(join(repo, "docs", "INDEX.md"), "documentation navigation\n");
  write(
    join(repo, "docs", "ops", "ROUTE-B-MASTER-PLAN-2026-07-12.md"),
    "所有 repo mutation 都按项目法执行 task ownership lifecycle。\n",
  );
  write(
    join(repo, "docs", "runbooks", "task-ownership.md"),
    "node task-ownership init\nnode task-ownership claim args\nnode task-ownership check --claim-id id\nnode task-ownership close args\n",
  );
  for (const base of ["apps/web", "packages/otto/src/skills"]) {
    write(join(repo, base, "AGENTS.md"), `local rules for ${base}\n`);
    write(join(repo, base, "CLAUDE.md"), "@AGENTS.md\n");
  }
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "authority fixture"]);
  return { root, repo };
}

function expectRed(repo, pattern) {
  assert.throws(
    () => checkProjectAuthority(repo),
    (error) => error instanceof AuthorityError && pattern.test(error.message),
  );
}

test("green: canonical symlink and nested loader adapters pass in main and linked worktrees", (t) => {
  const value = fixture(t);
  assert.equal(checkProjectAuthority(value.repo).canonicalLaw, ".claude/CLAUDE.md");
  const linked = join(value.root, "linked");
  git(value.repo, ["worktree", "add", "-b", "linked", linked]);
  assert.equal(checkProjectAuthority(linked).localPairs, 2);
});

test("red: a regular root copy cannot replace the tracked symlink", (t) => {
  const { repo } = fixture(t);
  unlinkSync(join(repo, "AGENTS.md"));
  writeFileSync(join(repo, "AGENTS.md"), readFileSync(join(repo, ".claude", "CLAUDE.md")));
  git(repo, ["add", "AGENTS.md"]);
  expectRed(repo, /symbolic link|mode 120000/);
});

test("red: wrong, outside, or broken root symlink targets fail", async (t) => {
  for (const mode of ["wrong", "outside", "broken"]) {
    await t.test(mode, (child) => {
      const { root, repo } = fixture(child);
      unlinkSync(join(repo, "AGENTS.md"));
      if (mode === "wrong") {
        write(join(repo, "OTHER.md"), "other\n");
        symlinkSync("OTHER.md", join(repo, "AGENTS.md"));
      } else if (mode === "outside") {
        write(join(root, "outside.md"), "outside\n");
        symlinkSync(join(root, "outside.md"), join(repo, "AGENTS.md"));
      } else {
        symlinkSync("missing.md", join(repo, "AGENTS.md"));
      }
      expectRed(repo, /point exactly|missing or broken|canonical in-repository/);
    });
  }
});

test("red: the canonical law itself cannot be a symlink", (t) => {
  const { root, repo } = fixture(t);
  const realLaw = join(root, "real-law.md");
  write(realLaw, "law\n");
  unlinkSync(join(repo, ".claude", "CLAUDE.md"));
  symlinkSync(realLaw, join(repo, ".claude", "CLAUDE.md"));
  expectRed(repo, /real regular file/);
});

test("red: nested Claude adapters and local-law duplication fail", async (t) => {
  await t.test("adapter", (child) => {
    const { repo } = fixture(child);
    writeFileSync(join(repo, "apps", "web", "CLAUDE.md"), "copied rules\n");
    expectRed(repo, /exact one-line/);
  });
  await t.test("duplicate", (child) => {
    const { repo } = fixture(child);
    writeFileSync(
      join(repo, "apps", "web", "AGENTS.md"),
      readFileSync(join(repo, ".claude", "CLAUDE.md")),
    );
    expectRed(repo, /must not duplicate/);
  });
});

test("red: retired files and retired bootstrap references cannot return", async (t) => {
  await t.test("path", (child) => {
    const { repo } = fixture(child);
    for (const path of RETIRED_PATHS) {
      const target = path === "docs/ops/route-b/execution" ? join(path, "old-control.md") : path;
      write(join(repo, target), "retired\n");
    }
    git(repo, ["add", "."]);
    assert.throws(
      () => checkProjectAuthority(repo),
      (error) =>
        error instanceof AuthorityError &&
        RETIRED_PATHS.every((path) => error.message.includes(path)),
    );
  });
  await t.test("reference", (child) => {
    const { repo } = fixture(child);
    appendFileSync(
      join(repo, ".claude", "skills", "fikirtive-orchestration-overlay", "SKILL.md"),
      "load docs/ops/ORCHESTRATOR-STATE.md\n",
    );
    expectRed(repo, /references retired authority/);
  });
  await t.test("short reference", (child) => {
    const { repo } = fixture(child);
    appendFileSync(join(repo, "docs", "INDEX.md"), "Load PRD.md and DECISION-LOG.md.\n");
    expectRed(repo, /references retired authority: (?:PRD|DECISION-LOG)\.md/);
  });
  await t.test("non-bootstrap tracked reference", (child) => {
    const { repo } = fixture(child);
    write(join(repo, "docs", "notes.md"), "Load docs/ops/MODEL-DOSSIER-2026-07.md.\n");
    git(repo, ["add", "docs/notes.md"]);
    expectRed(repo, /tracked surface docs\/notes\.md references retired authority/);
  });
  await t.test("relative retired reference", (child) => {
    const { repo } = fixture(child);
    write(
      join(repo, "docs", "notes.md"),
      "Load ../coverage-audit/adjudication.json and 2026-06-28-SESSION-HANDOFF.md.\n",
    );
    git(repo, ["add", "docs/notes.md"]);
    assert.throws(
      () => checkProjectAuthority(repo),
      (error) =>
        error instanceof AuthorityError &&
        error.message.includes("coverage-audit/") &&
        error.message.includes("2026-06-28-SESSION-HANDOFF.md"),
    );
  });
  await t.test("application-side retired reference", (child) => {
    const { repo } = fixture(child);
    write(
      join(repo, "apps", "web", "lib", "consumer.ts"),
      'import "../../../../scripts/execution-harness-check.mjs";\n',
    );
    git(repo, ["add", "apps/web/lib/consumer.ts"]);
    expectRed(
      repo,
      /tracked surface apps\/web\/lib\/consumer\.ts references retired authority: execution-harness-check\.mjs/,
    );
  });
  await t.test("retired workflow concepts", (child) => {
    const { repo } = fixture(child);
    write(
      join(repo, "docs", "notes.md"),
      "Run ledger-sync, write the 决策日志/风险账/证据台账, then 由总指挥放行.\n",
    );
    git(repo, ["add", "docs/notes.md"]);
    assert.throws(
      () => checkProjectAuthority(repo),
      (error) =>
        error instanceof AuthorityError &&
        error.message.includes("ledger-sync") &&
        error.message.includes("决策日志") &&
        error.message.includes("由总指挥") &&
        error.message.includes("风险账") &&
        error.message.includes("证据台账"),
    );
  });
});

test("red: task ownership cannot become optional in law, overlay, or Route-B", async (t) => {
  const cases = [
    ["law", ".claude/CLAUDE.md", "optional ownership claim\n"],
    ["overlay", ".claude/skills/fikirtive-orchestration-overlay/SKILL.md", "可选 ownership claim\n"],
    ["plan", "docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md", "可选 task claim\n"],
  ];
  for (const [name, path, source] of cases) {
    await t.test(name, (child) => {
      const { repo } = fixture(child);
      appendFileSync(join(repo, path), source);
      expectRed(repo, /makes task ownership optional/);
    });
  }
});

test("red: dropping the overlay claim-policy anchor fails", (t) => {
  const { repo } = fixture(t);
  const overlay = join(
    repo,
    ".claude",
    "skills",
    "fikirtive-orchestration-overlay",
    "SKILL.md",
  );
  writeFileSync(overlay, "bounded overlay without the anchor\n");
  expectRed(repo, /claim-policy anchor/);
});

test("red: an overlay carrying the anchor but no claim policy fails too", async (t) => {
  // Review round 2: anchoring the check on a machine comment was called "no relaxation",
  // but an overlay containing ONLY the comment passed while the Chinese substring it
  // replaced would have failed. The anchor now has to introduce an actual policy.
  const cases = [
    ["anchor alone", `${OVERLAY_CLAIM_ANCHOR}\n`, /missing the mandatory/],
    [
      "no law clause",
      `${OVERLAY_CLAIM_ANCHOR}\nsee \`docs/runbooks/task-ownership.md\` for the \`ACTIVE\` claim\n`,
      /missing the project-law clause/,
    ],
    [
      "no runbook pointer",
      `${OVERLAY_CLAIM_ANCHOR}\n项目法第 12 条:必须取得 \`ACTIVE\` claim\n`,
      /missing the task-ownership runbook pointer/,
    ],
    [
      "policy text sits ABOVE the anchor",
      "项目法第 12 条 `docs/runbooks/task-ownership.md` `ACTIVE` claim\n" +
        `${OVERLAY_CLAIM_ANCHOR}\n`,
      /missing the mandatory/,
    ],
  ];
  for (const [name, source, pattern] of cases) {
    await t.test(name, (child) => {
      const { repo } = fixture(child);
      writeFileSync(
        join(repo, ".claude", "skills", "fikirtive-orchestration-overlay", "SKILL.md"),
        source,
      );
      expectRed(repo, pattern);
    });
  }
});

test("red: canonical law rejects machine paths, frozen IDs/state, old tool config, and deploy commands", async (t) => {
  const cases = [
    ["machine path", "Use /Users/alice/FIKIRTIVE as authority.\n", /absolute machine path/],
    ["artifact id", "Current approval is PR (#338).\n", /specific GitHub #ID/],
    ["sha", "Current head is abcdef1234567890.\n", /specific Git SHA/],
    ["old tool config", "GBrain Configuration: /sync-gbrain.\n", /retired CodeGraph\/GBrain/],
    ["state marker", "## Current status\n\nACTIVE issue: 336\n", /current-state/],
    ["deploy", "Run railway up -s web -e production.\n", /deployment command/],
  ];
  for (const [name, source, pattern] of cases) {
    await t.test(name, (child) => {
      const { repo } = fixture(child);
      appendFileSync(join(repo, ".claude", "CLAUDE.md"), source);
      expectRed(repo, pattern);
    });
  }
});
