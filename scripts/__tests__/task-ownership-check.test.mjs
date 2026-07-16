import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  discoverRepository,
  loadOwnershipRegistry,
  OwnershipError,
  validateOwnershipRegistry,
} from "../task-ownership-check.mjs";

const CHECKER = fileURLToPath(new URL("../task-ownership-check.mjs", import.meta.url));
const NOW = new Date("2026-07-16T00:00:00.000Z");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function makeFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "fikirtive-ownership-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const linked = join(root, "linked");
  mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "Ownership Test"]);
  git(repo, ["config", "user.email", "ownership@example.test"]);
  git(repo, ["remote", "add", "origin", "https://github.com/BELCORT-SDN-BHD/FIKIRTIVE.git"]);
  writeFileSync(join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "fixture base"]);
  const base = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["worktree", "add", "-b", "task", linked, base]);
  const mainContext = discoverRepository(repo);
  const linkedContext = discoverRepository(linked);
  return { root, repo, linked, base, mainContext, linkedContext };
}

function emptyRegistry(generation = 1) {
  return { schema_version: 1, generation, claims: [] };
}

function claim(fixture, overrides = {}) {
  return {
    claim_id: "claim-1",
    issue_url: "https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/336",
    scope: ["docs/owned.md"],
    base_sha: fixture.base,
    revision: "r001",
    session_id: "session-1",
    worktree: fixture.linkedContext.root,
    claimed_at: "2026-07-15T00:00:00.000Z",
    expires_at: "2026-07-17T00:00:00.000Z",
    status: "ACTIVE",
    ...overrides,
  };
}

function writeRegistry(context, registry) {
  mkdirSync(context.registryDir, { recursive: true, mode: 0o700 });
  chmodSync(context.registryDir, 0o700);
  writeFileSync(context.registryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  chmodSync(context.registryPath, 0o600);
}

function run(cwd, args) {
  return spawnSync(process.execPath, [CHECKER, ...args], { cwd, encoding: "utf8" });
}

function expectOwnershipError(callback, pattern) {
  assert.throws(callback, (error) => error instanceof OwnershipError && pattern.test(error.message));
}

test("green: main and linked worktrees discover one shared Git common-dir", (t) => {
  const fixture = makeFixture(t);
  assert.equal(fixture.mainContext.commonDir, fixture.linkedContext.commonDir);
  assert.equal(fixture.mainContext.registryPath, fixture.linkedContext.registryPath);
});

test("green: an empty registry and one bounded ACTIVE claim validate", (t) => {
  const fixture = makeFixture(t);
  assert.equal(
    validateOwnershipRegistry(emptyRegistry(), {
      context: fixture.linkedContext,
      now: NOW,
    }).active.length,
    0,
  );
  const registry = { ...emptyRegistry(), claims: [claim(fixture)] };
  assert.equal(
    validateOwnershipRegistry(registry, {
      context: fixture.linkedContext,
      now: NOW,
    }).active.length,
    1,
  );
});

test("red: exact, file-prefix, and prefix-prefix ACTIVE overlaps fail", (t) => {
  const fixture = makeFixture(t);
  for (const [left, right] of [
    [["docs/a.md"], ["docs/a.md"]],
    [["docs/a.md"], ["docs/"]],
    [["docs/"], ["docs/sub/"]],
  ]) {
    const registry = {
      ...emptyRegistry(),
      claims: [
        claim(fixture, { claim_id: "left", issue_url: "https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1", session_id: "left", scope: left }),
        claim(fixture, { claim_id: "right", issue_url: "https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/2", session_id: "right", scope: right }),
      ],
    };
    expectOwnershipError(
      () => validateOwnershipRegistry(registry, { context: fixture.linkedContext, now: NOW }),
      /overlap/,
    );
  }
});

test("red: duplicate ACTIVE issue, session, or worktree facts fail", (t) => {
  const fixture = makeFixture(t);
  const second = claim(fixture, {
    claim_id: "claim-2",
    issue_url: "https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/337",
    scope: ["other/file.md"],
    session_id: "session-2",
  });
  for (const [field, value] of [
    ["issue_url", claim(fixture).issue_url],
    ["session_id", claim(fixture).session_id],
    ["worktree", claim(fixture).worktree],
  ]) {
    const registry = { ...emptyRegistry(), claims: [claim(fixture), { ...second, [field]: value }] };
    expectOwnershipError(
      () => validateOwnershipRegistry(registry, { context: fixture.linkedContext, now: NOW }),
      new RegExp(`ACTIVE ${field}`),
    );
  }
});

test("red: legacy fields and malformed scope or issue URLs fail closed", (t) => {
  const fixture = makeFixture(t);
  for (const legacy of ["parent_epoch", "token_digest", "controller", "pid", "mailbox", "hashes", "write_set"]) {
    const registry = { ...emptyRegistry(), claims: [{ ...claim(fixture), [legacy]: "old" }] };
    expectOwnershipError(
      () => validateOwnershipRegistry(registry, { context: fixture.linkedContext, now: NOW }),
      /closed task-ownership fields/,
    );
  }
  for (const scope of [["../escape"], ["/absolute"], ["docs/*.md"], ["docs\\file.md"], ["docs/a.md", "docs/a.md"]]) {
    const registry = { ...emptyRegistry(), claims: [claim(fixture, { scope })] };
    expectOwnershipError(
      () => validateOwnershipRegistry(registry, { context: fixture.linkedContext, now: NOW }),
      /scope/,
    );
  }
  const badIssue = { ...emptyRegistry(), claims: [claim(fixture, { issue_url: "https://github.com/other/repo/issues/1" })] };
  expectOwnershipError(
    () => validateOwnershipRegistry(badIssue, { context: fixture.linkedContext, now: NOW }),
    /issue_url/,
  );
});

test("red: expiry remains blocking and does not transfer ownership", (t) => {
  const fixture = makeFixture(t);
  const registry = {
    ...emptyRegistry(),
    claims: [claim(fixture, { expires_at: "2026-07-15T12:00:00.000Z" })],
  };
  expectOwnershipError(
    () => validateOwnershipRegistry(registry, { context: fixture.linkedContext, now: NOW }),
    /expired and remains blocking/,
  );
  assert.equal(registry.claims[0].status, "ACTIVE");
});

test("red: wrong base, worktree, or repository fails physical validation", (t) => {
  const fixture = makeFixture(t);
  const missingBase = { ...emptyRegistry(), claims: [claim(fixture, { base_sha: "f".repeat(40) })] };
  expectOwnershipError(
    () => validateOwnershipRegistry(missingBase, { context: fixture.linkedContext, now: NOW }),
    /base_sha/,
  );

  const alias = join(fixture.root, "linked-alias");
  symlinkSync(fixture.linked, alias, "dir");
  const aliased = { ...emptyRegistry(), claims: [claim(fixture, { worktree: alias })] };
  expectOwnershipError(
    () => validateOwnershipRegistry(aliased, { context: fixture.linkedContext, now: NOW }),
    /does not exist as a directory|not canonical/,
  );

  git(fixture.linked, ["remote", "set-url", "origin", "https://github.com/other/repo.git"]);
  const wrongRepo = { ...emptyRegistry(), claims: [claim(fixture)] };
  expectOwnershipError(
    () => validateOwnershipRegistry(wrongRepo, { context: fixture.linkedContext, now: NOW }),
    /wrong repository/,
  );
});

test("green: an ACTIVE claim covers committed, index, worktree, and untracked paths in scope", (t) => {
  const fixture = makeFixture(t);
  const docs = join(fixture.linked, "docs");
  mkdirSync(docs);
  writeFileSync(join(docs, "committed.md"), "committed\n");
  git(fixture.linked, ["add", "docs/committed.md"]);
  git(fixture.linked, ["commit", "-m", "in-scope commit"]);
  writeFileSync(join(docs, "committed.md"), "worktree\n");
  writeFileSync(join(docs, "staged.md"), "staged\n");
  git(fixture.linked, ["add", "docs/staged.md"]);
  writeFileSync(join(docs, "untracked.md"), "untracked\n");

  const registry = {
    ...emptyRegistry(),
    claims: [claim(fixture, { scope: ["docs/"] })],
  };
  assert.equal(
    validateOwnershipRegistry(registry, {
      context: fixture.linkedContext,
      now: NOW,
    }).active.length,
    1,
  );
});

test("red: committed, index, worktree, untracked, and rename destinations are scope-fenced", (t) => {
  const cases = [
    {
      label: "committed",
      mutate(fixture) {
        writeFileSync(join(fixture.linked, "outside.md"), "outside\n");
        git(fixture.linked, ["add", "outside.md"]);
        git(fixture.linked, ["commit", "-m", "outside commit"]);
        return fixture.base;
      },
    },
    {
      label: "index",
      mutate(fixture) {
        writeFileSync(join(fixture.linked, "outside.md"), "outside\n");
        git(fixture.linked, ["add", "outside.md"]);
        return fixture.base;
      },
    },
    {
      label: "worktree",
      mutate(fixture) {
        writeFileSync(join(fixture.linked, "README.md"), "outside\n");
        return fixture.base;
      },
    },
    {
      label: "untracked",
      mutate(fixture) {
        writeFileSync(join(fixture.linked, "outside.md"), "outside\n");
        return fixture.base;
      },
    },
    {
      label: "rename",
      mutate(fixture) {
        mkdirSync(join(fixture.linked, "docs"));
        writeFileSync(join(fixture.linked, "docs/owned.md"), "owned\n");
        git(fixture.linked, ["add", "docs/owned.md"]);
        git(fixture.linked, ["commit", "-m", "owned base"]);
        const base = git(fixture.linked, ["rev-parse", "HEAD"]);
        git(fixture.linked, ["mv", "docs/owned.md", "outside.md"]);
        return base;
      },
    },
  ];

  for (const { label, mutate } of cases) {
    const fixture = makeFixture(t);
    const base = mutate(fixture);
    const registry = {
      ...emptyRegistry(),
      claims: [claim(fixture, { base_sha: base, scope: ["docs/"] })],
    };
    assert.throws(
      () => validateOwnershipRegistry(registry, { context: fixture.linkedContext, now: NOW }),
      (error) =>
        error instanceof OwnershipError &&
        /out-of-scope committed\/index\/worktree\/untracked path/.test(error.message),
      label,
    );
  }
});

test("red: registry directory and file symlinks are rejected", (t) => {
  const fixture = makeFixture(t);
  const outside = join(fixture.root, "outside-registry");
  mkdirSync(outside, { mode: 0o700 });
  writeFileSync(join(outside, "ownership.json"), `${JSON.stringify(emptyRegistry())}\n`, { mode: 0o600 });
  symlinkSync(outside, fixture.mainContext.registryDir, "dir");
  expectOwnershipError(() => loadOwnershipRegistry(fixture.mainContext), /real directory/);
});

test("green/red: CLI init is create-only, private, and enables the first claim", async (t) => {
  await t.test("create, refuse second init, then claim", (child) => {
    const fixture = makeFixture(child);
    const initialized = run(fixture.linked, ["init"]);
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.deepEqual(loadOwnershipRegistry(fixture.mainContext), emptyRegistry());
    assert.equal(lstatSync(fixture.mainContext.registryDir).mode & 0o777, 0o700);
    assert.equal(lstatSync(fixture.mainContext.registryPath).mode & 0o777, 0o600);

    const second = run(fixture.linked, ["init"]);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /already exists; init never overwrites or resets/);
    assert.deepEqual(loadOwnershipRegistry(fixture.mainContext), emptyRegistry());

    const claimed = run(fixture.linked, [
      "claim",
      "--expect-generation", "1",
      "--claim-id", "first-claim",
      "--issue-url", "https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/336",
      "--scope", "docs/",
      "--base-sha", fixture.base,
      "--revision", "r001",
      "--session-id", "first-session",
      "--expires-at", "2999-01-01T00:00:00.000Z",
    ]);
    assert.equal(claimed.status, 0, claimed.stderr);
    assert.equal(loadOwnershipRegistry(fixture.mainContext).claims[0].claim_id, "first-claim");
  });

  await t.test("refuse an existing malformed registry", (child) => {
    const fixture = makeFixture(child);
    mkdirSync(fixture.mainContext.registryDir, { mode: 0o700 });
    writeFileSync(fixture.mainContext.registryPath, "not-json\n", { mode: 0o600 });
    const result = run(fixture.linked, ["init"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists; init never overwrites or resets/);
    assert.equal(readFileSync(fixture.mainContext.registryPath, "utf8"), "not-json\n");
  });

  await t.test("refuse a registry symlink", (child) => {
    const fixture = makeFixture(child);
    const outside = join(fixture.root, "outside.json");
    mkdirSync(fixture.mainContext.registryDir, { mode: 0o700 });
    writeFileSync(outside, "outside\n", { mode: 0o600 });
    symlinkSync(outside, fixture.mainContext.registryPath);
    const result = run(fixture.linked, ["init"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists; init never overwrites or resets/);
    assert.equal(readFileSync(outside, "utf8"), "outside\n");
  });

  await t.test("refuse an existing lock", (child) => {
    const fixture = makeFixture(child);
    mkdirSync(fixture.mainContext.registryDir, { mode: 0o700 });
    writeFileSync(fixture.mainContext.lockPath, "locked\n", { mode: 0o600 });
    const result = run(fixture.linked, ["init"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /locked; fail closed/);
    assert.equal(lstatSync(fixture.mainContext.lockPath).isFile(), true);
  });
});

test("green/red: CLI claim, check, close, CAS, and lock behavior", (t) => {
  const fixture = makeFixture(t);
  writeRegistry(fixture.mainContext, emptyRegistry());
  const claimArgs = [
    "claim",
    "--expect-generation", "1",
    "--claim-id", "cli-claim",
    "--issue-url", "https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/336",
    "--scope", "docs/",
    "--base-sha", fixture.base,
    "--revision", "r001",
    "--session-id", "cli-session",
    "--expires-at", "2999-01-01T00:00:00.000Z",
  ];
  assert.equal(run(fixture.linked, claimArgs).status, 0);
  assert.equal(run(fixture.linked, ["check", "--claim-id", "cli-claim"]).status, 0);

  writeFileSync(fixture.mainContext.lockPath, "locked\n", { mode: 0o600 });
  for (const args of [
    ["check"],
    ["check", "--claim-id", "cli-claim"],
    ["check", "--require-zero"],
  ]) {
    const checked = run(fixture.linked, args);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /locked; fail closed/);
  }
  rmSync(fixture.mainContext.lockPath);

  const stale = run(fixture.linked, claimArgs);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /generation changed/);

  assert.equal(
    run(fixture.linked, [
      "close",
      "--expect-generation", "2",
      "--claim-id", "cli-claim",
      "--session-id", "cli-session",
      "--status", "RELEASED",
    ]).status,
    0,
  );
  assert.equal(run(fixture.linked, ["check", "--require-zero"]).status, 0);
  assert.equal(JSON.parse(readFileSync(fixture.mainContext.registryPath, "utf8")).generation, 3);

  writeFileSync(fixture.mainContext.lockPath, "locked\n", { mode: 0o600 });
  const locked = run(fixture.linked, [
    ...claimArgs.slice(0, 1),
    "--expect-generation", "3",
    ...claimArgs.slice(3),
  ]);
  assert.notEqual(locked.status, 0);
  assert.match(locked.stderr, /locked; fail closed/);
});
