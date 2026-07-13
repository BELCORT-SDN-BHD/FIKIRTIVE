import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SOURCE_CHECKER = fileURLToPath(new URL("../execution-harness-check.mjs", import.meta.url));
const CONTROL_FILES = ["BOOTSTRAP.md", "WORK-ORDER.md", "INPUTS.lock.json", "OWNERSHIP.json"];
const CHECKER_PATH = "scripts/execution-harness-check.mjs";
const REQUIRED_HASHES = [...CONTROL_FILES, CHECKER_PATH];
const TOKEN = "1".repeat(64);
const OTHER_TOKEN = "2".repeat(64);
const DEFAULT_HEADINGS = ["OBJECTIVE", "SCOPE", "OUTPUT", "ACCEPTANCE", "BUDGET"];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function git(repo, args) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function markedJson(title, value) {
  return `# ${title}\n\n<!-- execution-harness:json -->\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

function makeFixture(t, { writer = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "fikirtive-execution-harness-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const controlDir = join(root, "control", "r001");
  const claimsPath = join(root, "global", "CLAIMS.json");
  const mailbox = join(root, "runtime");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-b", "harness-test"]);
  git(repo, ["config", "user.name", "Harness Test"]);
  git(repo, ["config", "user.email", "harness@example.test"]);

  mkdirSync(dirname(join(repo, CHECKER_PATH)), { recursive: true });
  copyFileSync(SOURCE_CHECKER, join(repo, CHECKER_PATH));
  write(join(repo, "authority", "law.md"), "pinned law\n");
  write(join(repo, "contracts", "shared.md"), "shared contract\n");
  if (writer) write(join(repo, "work", "committed.txt"), "base\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "fixture base"]);
  const baseSha = git(repo, ["rev-parse", "HEAD"]);

  const state = {
    headings: [...DEFAULT_HEADINGS],
    bootstrap: {
      schema_version: 1,
      role: "scoped-orchestrator",
      no_global_claim: true,
      identity_lock: { promotion: "forbidden", descendant_claims: "forbidden" },
      program_id: "program-test",
      work_order_id: writer ? "WO-WRITER" : "WO-READONLY",
      revision: "r001",
      parent_epoch: "global-epoch-1",
      scope_epoch: writer ? "scope-writer" : "scope-readonly",
      base_sha: baseSha,
      claim_id: writer ? "claim-writer" : "claim-readonly",
      token_digest: TOKEN,
      claim_generation: 1,
      runtime_mailbox: mailbox,
      worktree: repo,
      branch: "harness-test",
      claims_registry: claimsPath,
      checker_path: CHECKER_PATH,
      hash_authority: "global_claim_registry",
      required_hashes: REQUIRED_HASHES,
      stop_conditions: ["hash drift", "ownership breach"],
      escalate_conditions: ["acceptance cannot close"],
      founder_intent_snapshot: "Execute only the frozen bounded test work order.",
    },
    workOrder: {
      schema_version: 1,
      program_id: "program-test",
      work_order_id: writer ? "WO-WRITER" : "WO-READONLY",
      revision: "r001",
      parent_epoch: "global-epoch-1",
      scope_epoch: writer ? "scope-writer" : "scope-readonly",
      base_sha: baseSha,
      acceptance_ids: ["A1", "A2"],
    },
    lock: {
      schema_version: 1,
      program_id: "program-test",
      work_order_id: writer ? "WO-WRITER" : "WO-READONLY",
      revision: "r001",
      parent_epoch: "global-epoch-1",
      scope_epoch: writer ? "scope-writer" : "scope-readonly",
      base_sha: baseSha,
      claim: { id: writer ? "claim-writer" : "claim-readonly", token_digest: TOKEN, generation: 1 },
      hashing: {
        algorithm: "sha256",
        authority: "global_claim_registry",
        required_artifacts: REQUIRED_HASHES,
      },
      authoritative_inputs: [{ path: "authority/law.md", sha256: sha256(join(repo, "authority", "law.md")) }],
      shared_contract_inputs: [
        { path: "contracts/shared.md", sha256: sha256(join(repo, "contracts", "shared.md")) },
      ],
    },
    ownership: {
      schema_version: 1,
      role: "scoped-orchestrator",
      no_global_claim: true,
      program_id: "program-test",
      work_order_id: writer ? "WO-WRITER" : "WO-READONLY",
      revision: "r001",
      parent_epoch: "global-epoch-1",
      scope_epoch: writer ? "scope-writer" : "scope-readonly",
      base_sha: baseSha,
      write_set: writer
        ? { exact_files: ["work/committed.txt", "work/untracked.txt"], directory_prefixes: [] }
        : { exact_files: [], directory_prefixes: [] },
      locked_inputs: {
        exact_files: ["authority/law.md", "contracts/shared.md"],
        directory_prefixes: [],
      },
      exclusive_groups: writer ? ["writer-test"] : [],
      author_identity: writer ? "author-writer" : "author-readonly",
      merger_identity: null,
    },
    registry: { schema_version: 1, generation: 1, claims: [] },
    report: null,
    evidence: null,
    runtimeState: null,
  };

  function syncCrossFields() {
    for (const target of [state.workOrder, state.lock, state.ownership]) {
      for (const field of ["program_id", "work_order_id", "revision", "parent_epoch", "scope_epoch", "base_sha"]) {
        target[field] = state.bootstrap[field];
      }
    }
    state.lock.claim = {
      id: state.bootstrap.claim_id,
      token_digest: state.bootstrap.token_digest,
      generation: state.bootstrap.claim_generation,
    };
  }

  function currentClaim(hashes) {
    return {
      claim_id: state.bootstrap.claim_id,
      claim_type: "scoped",
      issuer_role: "global-control-plane",
      parent_claim_id: null,
      role: "scoped-orchestrator",
      no_global_claim: true,
      program_id: state.bootstrap.program_id,
      work_order_id: state.bootstrap.work_order_id,
      parent_epoch: state.bootstrap.parent_epoch,
      scope_epoch: state.bootstrap.scope_epoch,
      revision: state.bootstrap.revision,
      base_sha: state.bootstrap.base_sha,
      token_digest: state.bootstrap.token_digest,
      status: "ACTIVE",
      generation: state.registry.generation,
      write_set: state.ownership.write_set,
      locked_inputs: state.ownership.locked_inputs,
      exclusive_groups: state.ownership.exclusive_groups,
      author_identity: state.ownership.author_identity,
      merger_identity: state.ownership.merger_identity,
      hashes,
    };
  }

  function writeControls() {
    syncCrossFields();
    write(join(controlDir, "BOOTSTRAP.md"), markedJson("Bootstrap", state.bootstrap));
    const sections = state.headings.map((heading) => `## ${heading}\n\nFixture ${heading.toLowerCase()}.\n`).join("\n");
    write(join(controlDir, "WORK-ORDER.md"), `${markedJson("Work order", state.workOrder)}\n${sections}`);
    write(join(controlDir, "INPUTS.lock.json"), `${JSON.stringify(state.lock, null, 2)}\n`);
    write(join(controlDir, "OWNERSHIP.json"), `${JSON.stringify(state.ownership, null, 2)}\n`);
    const hashes = Object.fromEntries(
      REQUIRED_HASHES.map((path) => [path, sha256(path === CHECKER_PATH ? join(repo, path) : join(controlDir, path))]),
    );
    const existingCurrent = state.registry.claims.find((claim) => claim.claim_id === state.bootstrap.claim_id);
    const replacement = currentClaim(hashes);
    if (existingCurrent) Object.assign(existingCurrent, replacement);
    else state.registry.claims.unshift(replacement);
    writeClaims();
  }

  function writeClaims() {
    write(claimsPath, `${JSON.stringify(state.registry, null, 2)}\n`);
  }

  function actualPaths() {
    return writer ? ["work/committed.txt", "work/untracked.txt"] : [];
  }

  function writeRuntime() {
    const headSha = git(repo, ["rev-parse", "HEAD"]);
    const gitFacts = { branch: "harness-test", base_sha: state.bootstrap.base_sha, head_sha: headSha };
    const outputPath = "EVIDENCE/gate.txt";
    write(join(mailbox, outputPath), "fixture gate output\n");
    state.evidence ??= {
      schema_version: 1,
      program_id: state.bootstrap.program_id,
      work_order_id: state.bootstrap.work_order_id,
      revision: state.bootstrap.revision,
      result: "READY_FOR_VERIFY",
      git: gitFacts,
      no_out_of_scope_changes: true,
      entries: [
        {
          id: "gate",
          acceptance_ids: ["A1", "A2"],
          command: "node fixture-gate.mjs",
          exit_code: 0,
          output_path: outputPath,
          sha256: sha256(join(mailbox, outputPath)),
          changed_paths: actualPaths(),
        },
      ],
    };
    state.evidence.git = gitFacts;
    state.report ??= {
      schema_version: 1,
      program_id: state.bootstrap.program_id,
      work_order_id: state.bootstrap.work_order_id,
      revision: state.bootstrap.revision,
      result: "READY_FOR_VERIFY",
      changed_facts: writer ? ["Fixture writer changed its owned files."] : [],
      changed_files: actualPaths(),
      commands: [{ id: "gate", command: "node fixture-gate.mjs", exit_code: 0 }],
      failures: [],
      unknowns: [],
      acceptance_mapping: [
        { acceptance_id: "A1", status: "PASS", evidence_ids: ["gate"] },
        { acceptance_id: "A2", status: "PASS", evidence_ids: ["gate"] },
      ],
      git: gitFacts,
      evidence_hashes: { [outputPath]: state.evidence.entries[0].sha256 },
      no_out_of_scope_changes: true,
      actors: {
        author_identity: state.ownership.author_identity,
        merger_identity: state.ownership.merger_identity,
        merge_executed: false,
      },
    };
    state.report.git = gitFacts;
    state.runtimeState ??= {
      schema_version: 1,
      program_id: state.bootstrap.program_id,
      work_order_id: state.bootstrap.work_order_id,
      revision: state.bootstrap.revision,
      status: "READY_FOR_VERIFY",
      phase: "delivery",
      last_validated_generation: state.registry.generation,
      base_sha: state.bootstrap.base_sha,
      head_sha: headSha,
    };
    write(join(mailbox, "EVIDENCE", "manifest.json"), `${JSON.stringify(state.evidence, null, 2)}\n`);
    write(join(mailbox, "REPORT.md"), markedJson("Report", state.report));
    write(join(mailbox, "STATE.json"), `${JSON.stringify(state.runtimeState, null, 2)}\n`);
  }

  function run(phase) {
    return spawnSync(
      process.execPath,
      [join(repo, CHECKER_PATH), "--phase", phase, "--control-dir", controlDir, "--claims", claimsPath],
      { cwd: repo, encoding: "utf8" },
    );
  }

  writeControls();
  if (writer) {
    write(join(repo, "work", "committed.txt"), "committed change\n");
    git(repo, ["add", "work/committed.txt"]);
    git(repo, ["commit", "-m", "owned committed change"]);
    write(join(repo, "work", "untracked.txt"), "untracked change\n");
  }
  writeRuntime();

  return {
    root,
    repo,
    controlDir,
    claimsPath,
    mailbox,
    state,
    writeControls,
    writeClaims,
    writeRuntime,
    run,
  };
}

function expectPass(result, label) {
  assert.equal(result.status, 0, `${label}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /execution-harness-check: PASS/);
}

function expectFail(result, pattern, label) {
  assert.notEqual(result.status, 0, `${label} unexpectedly passed`);
  assert.match(`${result.stdout}\n${result.stderr}`, pattern, label);
}

function addSecondClaim(fixture, overrides = {}) {
  const current = fixture.state.registry.claims[0];
  fixture.state.registry.claims.push({
    ...structuredClone(current),
    claim_id: "claim-other",
    work_order_id: "WO-OTHER",
    scope_epoch: "scope-other",
    token_digest: OTHER_TOKEN,
    author_identity: "author-other",
    exclusive_groups: [],
    write_set: { exact_files: ["other/file.txt"], directory_prefixes: [] },
    locked_inputs: { exact_files: ["other/input.txt"], directory_prefixes: [] },
    ...overrides,
  });
  fixture.writeClaims();
}

test("green: read-only work order passes all four phases", (t) => {
  const fixture = makeFixture(t);
  for (const phase of ["startup", "prewrite", "boundary", "delivery"]) {
    expectPass(fixture.run(phase), `read-only ${phase}`);
  }
});

test("green: isolated writer delivery includes committed and untracked paths", (t) => {
  const fixture = makeFixture(t, { writer: true });
  expectPass(fixture.run("boundary"), "writer boundary");
  expectPass(fixture.run("delivery"), "writer delivery");
});

test("red: unknown phase fails", (t) => {
  const fixture = makeFixture(t);
  expectFail(fixture.run("surprise"), /unknown phase/, "unknown phase");
});

test("red: wrong, missing, duplicate, or reordered work-order headings fail", async (t) => {
  for (const [name, headings] of [
    ["reordered", ["SCOPE", "OBJECTIVE", "OUTPUT", "ACCEPTANCE", "BUDGET"]],
    ["missing", ["OBJECTIVE", "SCOPE", "OUTPUT", "ACCEPTANCE"]],
    ["duplicate", ["OBJECTIVE", "SCOPE", "OUTPUT", "ACCEPTANCE", "ACCEPTANCE", "BUDGET"]],
  ]) {
    await t.test(name, (child) => {
      const fixture = makeFixture(child);
      fixture.state.headings = headings;
      fixture.writeControls();
      expectFail(fixture.run("startup"), /headings must be exactly/, name);
    });
  }
});

test("red: one-byte authoritative or shared input tampering fails", async (t) => {
  for (const path of ["authority/law.md", "contracts/shared.md"]) {
    await t.test(path, (child) => {
      const fixture = makeFixture(child);
      appendFileSync(join(fixture.repo, path), "x");
      expectFail(fixture.run("boundary"), /hash mismatch/, path);
    });
  }
});

test("red: stale base fails even when re-signed", (t) => {
  const fixture = makeFixture(t);
  fixture.state.bootstrap.base_sha = "f".repeat(40);
  fixture.writeControls();
  expectFail(fixture.run("startup"), /cat-file|base_sha/, "stale base");
});

test("red: absent, duplicate, revoked, superseded, stale, or stale-token claim fails", async (t) => {
  const cases = [
    ["absent", (fixture) => fixture.state.registry.claims.splice(0, 1), /exactly once/],
    ["duplicate", (fixture) => fixture.state.registry.claims.push(structuredClone(fixture.state.registry.claims[0])), /exactly once/],
    ["revoked", (fixture) => (fixture.state.registry.claims[0].status = "REVOKED"), /must be ACTIVE/],
    ["superseded", (fixture) => (fixture.state.registry.claims[0].status = "SUPERSEDED"), /must be ACTIVE/],
    ["stale-status", (fixture) => (fixture.state.registry.claims[0].status = "STALE"), /must be ACTIVE/],
    ["stale-token", (fixture) => (fixture.state.registry.claims[0].token_digest = OTHER_TOKEN), /token_digest/],
    [
      "stale-generation",
      (fixture) => {
        fixture.state.registry.generation = 2;
      },
      /generation is stale/,
    ],
  ];
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, (child) => {
      const fixture = makeFixture(child);
      mutate(fixture);
      fixture.writeClaims();
      expectFail(fixture.run("startup"), pattern, name);
    });
  }
});

test("red: checker and each control file are hash-locked", async (t) => {
  await t.test("checker", (child) => {
    const fixture = makeFixture(child);
    appendFileSync(join(fixture.repo, CHECKER_PATH), "\n// one-byte-equivalent tamper\n");
    expectFail(fixture.run("boundary"), /hash mismatch.*execution-harness-check|forbidden execution checker/s, "checker tamper");
  });
  for (const name of CONTROL_FILES) {
    await t.test(name, (child) => {
      const fixture = makeFixture(child);
      appendFileSync(join(fixture.controlDir, name), " \n");
      expectFail(fixture.run("startup"), new RegExp(`hash mismatch for ${name.replace(".", "\\.")}`), name);
    });
  }
});

test("red: active claims cannot overlap exact files or directory prefixes", async (t) => {
  const cases = [
    ["exact", { write_set: { exact_files: ["work/file.txt"], directory_prefixes: [] } }],
    ["prefix", { write_set: { exact_files: [], directory_prefixes: ["work/"] } }],
  ];
  for (const [name, override] of cases) {
    await t.test(name, (child) => {
      const fixture = makeFixture(child);
      fixture.state.ownership.write_set = { exact_files: ["work/file.txt"], directory_prefixes: [] };
      fixture.writeControls();
      addSecondClaim(fixture, override);
      expectFail(fixture.run("startup"), /overlapping writers/, name);
    });
  }
});

test("red: active claim write-vs-locked-input overlap fails", (t) => {
  const fixture = makeFixture(t);
  addSecondClaim(fixture, {
    write_set: { exact_files: ["authority/law.md"], directory_prefixes: [] },
    locked_inputs: { exact_files: ["other/input.txt"], directory_prefixes: [] },
  });
  expectFail(fixture.run("startup"), /writes locked input/, "write-vs-lock overlap");
});

test("red: active claims cannot share an exclusive group", (t) => {
  const fixture = makeFixture(t);
  fixture.state.ownership.exclusive_groups = ["shared-exclusive"];
  fixture.writeControls();
  addSecondClaim(fixture, { exclusive_groups: ["shared-exclusive"] });
  expectFail(fixture.run("startup"), /share exclusive group/, "exclusive group");
});

test("red: malicious ownership cannot allow a forbidden path", (t) => {
  const fixture = makeFixture(t);
  fixture.state.ownership.write_set = { exact_files: ["docs/BLUEPRINT.md"], directory_prefixes: [] };
  fixture.writeControls();
  expectFail(fixture.run("startup"), /forbidden Blueprint/, "forbidden ownership");
});

test("red: committed and untracked out-of-ownership paths fail delivery", async (t) => {
  await t.test("committed", (child) => {
    const fixture = makeFixture(child);
    write(join(fixture.repo, "outside", "committed.txt"), "bad\n");
    git(fixture.repo, ["add", "outside/committed.txt"]);
    git(fixture.repo, ["commit", "-m", "outside commit"]);
    fixture.writeRuntime();
    expectFail(fixture.run("delivery"), /outside ownership/, "committed outside ownership");
  });
  await t.test("untracked", (child) => {
    const fixture = makeFixture(child);
    write(join(fixture.repo, "outside", "untracked.txt"), "bad\n");
    fixture.writeRuntime();
    expectFail(fixture.run("delivery"), /outside ownership/, "untracked outside ownership");
  });
});

test("red: missing founder-intent snapshot fails", (t) => {
  const fixture = makeFixture(t);
  delete fixture.state.bootstrap.founder_intent_snapshot;
  fixture.writeControls();
  expectFail(fixture.run("startup"), /founder_intent_snapshot is required/, "missing founder intent");
});

test("red: incomplete report or evidence fails delivery", async (t) => {
  await t.test("report", (child) => {
    const fixture = makeFixture(child);
    delete fixture.state.report.unknowns;
    fixture.writeRuntime();
    expectFail(fixture.run("delivery"), /report unknowns must be a string array/, "incomplete report");
  });
  await t.test("evidence", (child) => {
    const fixture = makeFixture(child);
    unlinkSync(join(fixture.mailbox, "EVIDENCE", "gate.txt"));
    expectFail(fixture.run("delivery"), /output_path is missing/, "incomplete evidence");
  });
});

test("red: scoped identity cannot self-promote or mint a nested claim", async (t) => {
  for (const [name, mutate, pattern] of [
    ["promotion", (claim) => (claim.role = "global-control-plane"), /cannot promote/],
    ["nested", (claim) => (claim.parent_claim_id = "claim-parent"), /nested scoped claims|is nested/],
    ["descendant-minted", (claim) => (claim.issuer_role = "scoped-orchestrator"), /minted by global|descendant-minted/],
  ]) {
    await t.test(name, (child) => {
      const fixture = makeFixture(child);
      mutate(fixture.state.registry.claims[0]);
      fixture.writeClaims();
      expectFail(fixture.run("startup"), pattern, name);
    });
  }
});

test("red: author and merger identities cannot conflict", (t) => {
  const fixture = makeFixture(t);
  fixture.state.ownership.merger_identity = fixture.state.ownership.author_identity;
  fixture.writeControls();
  expectFail(fixture.run("startup"), /author\/merger conflict/, "author/merger conflict");
});

console.log("execution-harness-check red/green suite loaded");
