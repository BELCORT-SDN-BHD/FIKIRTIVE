#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const PHASES = new Set(["startup", "prewrite", "boundary", "delivery"]);
const CONTROL_FILES = ["BOOTSTRAP.md", "WORK-ORDER.md", "INPUTS.lock.json", "OWNERSHIP.json"];
const CHECKER_PATH = "scripts/execution-harness-check.mjs";
const REQUIRED_HASHES = [...CONTROL_FILES, CHECKER_PATH];
const WORK_ORDER_HEADINGS = ["OBJECTIVE", "SCOPE", "OUTPUT", "ACCEPTANCE", "BUDGET"];
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const CLAIM_STATUSES = new Set(["ACTIVE", "REVOKED", "SUPERSEDED", "STALE"]);

const FORBIDDEN_EXACT = new Map([
  [CHECKER_PATH, "execution checker"],
  ["docs/BLUEPRINT.md", "Blueprint"],
  ["scripts/blueprint.sha256", "Blueprint hash authority"],
  ["docs/ops/route-b/DEPENDENCY-STATUS.md", "Route-B dependency ledger"],
  ["docs/ops/route-b/DECISION-LOG.md", "Route-B decision ledger"],
  ["docs/ops/route-b/RISKS-PENDING.md", "Route-B risk ledger"],
  ["docs/ops/route-b/EVIDENCE-LEDGER.md", "Route-B evidence ledger"],
  ["docs/ops/ORCHESTRATOR-STATE.md", "global orchestrator state"],
  ["docs/ops/route-b/B0-CONTRACT.md", "Route-B Gate 0 contract"],
  ["docs/ops/route-b/STANDING-DELEGATION.md", "Route-B standing delegation"],
  ["packages/db/prisma/schema.prisma", "database schema"],
  ["packages/core/src/spend.ts", "pricing authority"],
  ["packages/otto/src/registry.ts", "shared skill registry"],
  ["packages/otto/src/parity-manifest.ts", "shared parity manifest"],
  ["packages/otto/src/parity-manifest.test.ts", "shared parity manifest"],
  ["packages/otto/src/skills/CATALOG.md", "shared skill catalog"],
  ["scripts/parity-debt-baseline.json", "shared parity baseline"],
  ["docs/ops/route-b/parity-debt.md", "shared Route-B parity ledger"],
  ["package.json", "root configuration"],
  ["pnpm-lock.yaml", "root configuration"],
  ["pnpm-workspace.yaml", "root configuration"],
  ["tsconfig.base.json", "root configuration"],
  ["docker-compose.yml", "root configuration"],
  ["AGENTS.md", "root law/configuration"],
  [".mcp.json", "root configuration"],
  [".gitignore", "root configuration"],
  [".dockerignore", "root configuration"],
  [".railwayignore", "root configuration"],
]);

const FORBIDDEN_PREFIXES = new Map([
  [".git/", "Git metadata"],
  [".claude/", "agent law/configuration"],
  ["docs/ops/route-b/execution/", "execution control plane"],
  ["docs/ops/route-b/matrix/", "Route-B scope ledger"],
  ["packages/db/prisma/migrations/", "database migrations"],
  [".github/", "CI configuration"],
  [".githooks/", "CI/root hooks"],
  [".secrets/", "secrets"],
  ["secrets/", "secrets"],
]);

class CheckFailure extends Error {
  constructor(messages) {
    super(messages.join("\n"));
    this.messages = messages;
  }
}

function add(errors, condition, message) {
  if (!condition) errors.push(message);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value, { nonEmpty = false } = {}) {
  return (
    Array.isArray(value) &&
    (!nonEmpty || value.length > 0) &&
    value.every((item) => nonEmptyString(item))
  );
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function isSortedUnique(values) {
  return isDeepStrictEqual(values, sortedUnique(values));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path, errors, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${label} is missing or invalid JSON: ${error.message}`);
    return {};
  }
}

function readMarkedJson(path, errors, label) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    errors.push(`${label} is missing: ${error.message}`);
    return { source: "", data: {} };
  }
  const match = source.match(
    /<!-- execution-harness:json -->\s*```json\s*\n([\s\S]*?)\n```/,
  );
  if (!match) {
    errors.push(`${label} is missing its execution-harness JSON block`);
    return { source, data: {} };
  }
  try {
    return { source, data: JSON.parse(match[1]) };
  } catch (error) {
    errors.push(`${label} has invalid execution-harness JSON: ${error.message}`);
    return { source, data: {} };
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!new Set(["--phase", "--control-dir", "--claims"]).has(flag)) {
      throw new CheckFailure([`unknown argument: ${flag}`]);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new CheckFailure([`missing value for ${flag}`]);
    }
    args[flag.slice(2)] = value;
    index += 1;
  }
  const errors = [];
  add(errors, PHASES.has(args.phase), `unknown phase: ${args.phase ?? "<missing>"}`);
  add(errors, isAbsolute(args["control-dir"] ?? ""), "--control-dir must be an absolute path");
  add(errors, isAbsolute(args.claims ?? ""), "--claims must be an absolute path");
  if (errors.length) throw new CheckFailure(errors);
  return { phase: args.phase, controlDir: resolve(args["control-dir"]), claimsPath: resolve(args.claims) };
}

function normalizeRepoPath(value, kind, errors, label) {
  if (!nonEmptyString(value)) {
    errors.push(`${label} must be a non-empty repository-relative path`);
    return "<invalid>";
  }
  if (value.includes("\\") || isAbsolute(value) || value.startsWith("./")) {
    errors.push(`${label} must use normalized repository-relative POSIX syntax: ${value}`);
    return "<invalid>";
  }
  const wantsDirectory = kind === "directory";
  const raw = wantsDirectory ? value.slice(0, -1) : value;
  if ((wantsDirectory && !value.endsWith("/")) || raw.length === 0) {
    errors.push(`${label} directory prefixes must be non-empty and end in '/': ${value}`);
    return "<invalid>";
  }
  const parts = raw.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    errors.push(`${label} is not normalized: ${value}`);
    return "<invalid>";
  }
  return value;
}

function validatePathSet(value, errors, label) {
  if (!plainObject(value)) {
    errors.push(`${label} must be an object`);
    return { exact_files: [], directory_prefixes: [] };
  }
  const exact = Array.isArray(value.exact_files) ? value.exact_files : [];
  const prefixes = Array.isArray(value.directory_prefixes) ? value.directory_prefixes : [];
  add(errors, Array.isArray(value.exact_files), `${label}.exact_files must be an array`);
  add(errors, Array.isArray(value.directory_prefixes), `${label}.directory_prefixes must be an array`);
  const normalized = {
    exact_files: exact.map((path, index) =>
      normalizeRepoPath(path, "file", errors, `${label}.exact_files[${index}]`),
    ),
    directory_prefixes: prefixes.map((path, index) =>
      normalizeRepoPath(path, "directory", errors, `${label}.directory_prefixes[${index}]`),
    ),
  };
  add(errors, isSortedUnique(normalized.exact_files), `${label}.exact_files must be sorted and unique`);
  add(
    errors,
    isSortedUnique(normalized.directory_prefixes),
    `${label}.directory_prefixes must be sorted and unique`,
  );
  return normalized;
}

function pathSetEntries(pathSet) {
  return [
    ...pathSet.exact_files.map((path) => ({ kind: "file", path })),
    ...pathSet.directory_prefixes.map((path) => ({ kind: "directory", path })),
  ];
}

function entriesOverlap(left, right) {
  if (left.kind === "file" && right.kind === "file") return left.path === right.path;
  if (left.kind === "directory" && right.kind === "directory") {
    return left.path.startsWith(right.path) || right.path.startsWith(left.path);
  }
  const file = left.kind === "file" ? left.path : right.path;
  const directory = left.kind === "directory" ? left.path : right.path;
  return file.startsWith(directory);
}

function setsOverlap(left, right) {
  for (const leftEntry of pathSetEntries(left)) {
    for (const rightEntry of pathSetEntries(right)) {
      if (entriesOverlap(leftEntry, rightEntry)) return [leftEntry.path, rightEntry.path];
    }
  }
  return null;
}

function pathCovered(path, pathSet) {
  return pathSet.exact_files.includes(path) || pathSet.directory_prefixes.some((prefix) => path.startsWith(prefix));
}

function pathInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function pathsDisjoint(left, right) {
  return !pathInside(left, right) && !pathInside(right, left);
}

function canonicalExistingPath(path, errors, label, kind) {
  try {
    const canonical = realpathSync(path);
    const stats = statSync(canonical);
    add(errors, kind !== "file" || stats.isFile(), `${label} must resolve to a regular file`);
    add(errors, kind !== "directory" || stats.isDirectory(), `${label} must resolve to a directory`);
    return canonical;
  } catch (error) {
    errors.push(`${label} cannot be canonicalized: ${error.message}`);
    return resolve(path);
  }
}

function validateContainedFile(path, root, errors, label, { directRegular = false } = {}) {
  try {
    if (directRegular) {
      add(errors, lstatSync(path).isFile(), `${label} must be a regular file, not a symlink`);
    }
    const canonical = realpathSync(path);
    add(errors, statSync(canonical).isFile(), `${label} must resolve to a regular file`);
    add(errors, pathInside(root, canonical), `${label} escapes its canonical root`);
    return canonical;
  } catch (error) {
    errors.push(`${label} cannot be canonicalized: ${error.message}`);
    return resolve(path);
  }
}

function asRepoPath(worktree, absolutePath) {
  if (!pathInside(worktree, absolutePath)) return null;
  return relative(worktree, absolutePath).split(sep).join("/");
}

function forbiddenReason(path, dynamicExact = new Map()) {
  if (!path.includes("/")) return "root configuration";
  if (FORBIDDEN_EXACT.has(path)) return FORBIDDEN_EXACT.get(path);
  if (dynamicExact.has(path)) return dynamicExact.get(path);
  for (const [prefix, reason] of FORBIDDEN_PREFIXES) {
    if (path.startsWith(prefix)) return reason;
  }
  const basename = path.split("/").at(-1);
  if (basename === ".env" || basename.startsWith(".env.")) return "secrets";
  if (path.endsWith("/schema.prisma") || path.includes("/migrations/")) return "schema/migrations";
  return null;
}

function validateForbiddenWriteSet(pathSet, errors, label, dynamicExact) {
  for (const entry of pathSetEntries(pathSet)) {
    const directReason = forbiddenReason(entry.path, dynamicExact);
    if (directReason) errors.push(`${label} includes forbidden ${directReason}: ${entry.path}`);

    if (entry.kind !== "directory") continue;
    for (const [path, reason] of [...FORBIDDEN_EXACT, ...dynamicExact]) {
      if (path.startsWith(entry.path)) {
        errors.push(`${label} directory covers forbidden ${reason}: ${entry.path} -> ${path}`);
      }
    }
    for (const [prefix, reason] of FORBIDDEN_PREFIXES) {
      if (prefix.startsWith(entry.path) || entry.path.startsWith(prefix)) {
        errors.push(`${label} directory overlaps forbidden ${reason}: ${entry.path} <> ${prefix}`);
      }
    }
  }
}

function git(worktree, args) {
  const result = spawnSync("git", args, { cwd: worktree, encoding: "utf8" });
  if (result.status !== 0) {
    throw new CheckFailure([`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`]);
  }
  return result.stdout.trim();
}

function gitZ(worktree, args) {
  const result = spawnSync("git", args, { cwd: worktree, encoding: "buffer" });
  if (result.status !== 0) {
    throw new CheckFailure([`git ${args.join(" ")} failed: ${result.stderr.toString("utf8").trim()}`]);
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => path.split(sep).join("/"));
}

function gitPathIsIgnored(worktree, path, directory = false) {
  const candidate = path.endsWith("/") ? path.slice(0, -1) : path;
  const candidates = directory ? [candidate, `${candidate}/__execution_harness_probe__`] : [candidate];
  for (const probe of candidates) {
    const result = spawnSync("git", ["check-ignore", "--no-index", "--quiet", "--", probe], {
      cwd: worktree,
      encoding: "utf8",
    });
    if (result.status === 0) return true;
    if (result.status !== 1) {
      throw new CheckFailure([
        `git check-ignore failed for ${path}: ${(result.stderr || result.stdout).trim()}`,
      ]);
    }
  }
  return false;
}

function validateIgnoredWriteSet(pathSet, worktree, errors, label) {
  for (const entry of pathSetEntries(pathSet)) {
    if (entry.path === "<invalid>") continue;
    try {
      if (gitPathIsIgnored(worktree, entry.path, entry.kind === "directory")) {
        errors.push(`${label} includes ignored write target: ${entry.path}`);
      }
      if (entry.kind === "directory") {
        const ignoredWithin = sortedUnique([
          ...gitZ(worktree, [
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "-z",
            "--",
            entry.path,
          ]),
          ...gitZ(worktree, [
            "ls-files",
            "--cached",
            "--ignored",
            "--exclude-standard",
            "-z",
            "--",
            entry.path,
          ]),
        ]);
        if (ignoredWithin.length > 0) {
          errors.push(`${label} directory contains ignored write target: ${entry.path} -> ${ignoredWithin[0]}`);
        }
      }
    } catch (error) {
      if (error instanceof CheckFailure) errors.push(...error.messages);
      else errors.push(error.message);
    }
  }
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function validatePhysicalWriteSet(pathSet, worktree, errors, label) {
  for (const entry of pathSetEntries(pathSet)) {
    if (entry.path === "<invalid>") continue;
    const repoPath = entry.kind === "directory" ? entry.path.slice(0, -1) : entry.path;
    const absolutePath = join(worktree, repoPath);
    let current = worktree;
    let nearestExisting = worktree;
    let hasSymlink = false;
    try {
      for (const component of repoPath.split("/")) {
        current = join(current, component);
        const stats = lstatIfPresent(current);
        if (!stats) break;
        nearestExisting = current;
        if (stats.isSymbolicLink()) {
          errors.push(`${label} write target contains a symlink component: ${entry.path}`);
          hasSymlink = true;
          break;
        }
      }
      const canonicalAncestor = realpathSync(nearestExisting);
      add(
        errors,
        pathInside(worktree, canonicalAncestor),
        `${label} write target escapes the canonical worktree: ${entry.path}`,
      );
      if (hasSymlink) continue;

      const targetStats = lstatIfPresent(absolutePath);
      if (entry.kind === "file" && targetStats) {
        add(errors, targetStats.isFile(), `${label} exact write target must be a regular file: ${entry.path}`);
      }
      if (entry.kind === "directory" && targetStats) {
        add(errors, targetStats.isDirectory(), `${label} directory prefix must resolve to a directory: ${entry.path}`);
        if (!targetStats.isDirectory()) continue;
        const pending = [absolutePath];
        while (pending.length > 0) {
          const directory = pending.pop();
          for (const child of readdirSync(directory, { withFileTypes: true })) {
            const childPath = join(directory, child.name);
            if (child.isSymbolicLink()) {
              errors.push(
                `${label} directory prefix has a symlink descendant: ${entry.path} -> ${asRepoPath(worktree, childPath)}`,
              );
            } else if (child.isDirectory()) {
              pending.push(childPath);
            }
          }
        }
      }
    } catch (error) {
      errors.push(`${label} cannot validate physical write target ${entry.path}: ${error.message}`);
    }
  }
}

function changedPaths(worktree, baseSha) {
  return sortedUnique([
    ...gitZ(worktree, ["diff", "--name-only", "-z", baseSha, "HEAD"]),
    ...gitZ(worktree, ["diff", "--name-only", "-z", "HEAD"]),
    ...gitZ(worktree, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
}

function actualPathHasSymlinkEntry(worktree, baseSha, path) {
  try {
    if (lstatSync(join(worktree, path)).isSymbolicLink()) return true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const args of [
    ["ls-tree", baseSha, "--", path],
    ["ls-tree", "HEAD", "--", path],
    ["ls-files", "--stage", "--", path],
  ]) {
    const output = git(worktree, args);
    if (output.split("\n").some((line) => line.startsWith("120000 "))) return true;
  }
  return false;
}

function requireMatching(errors, label, values) {
  const [first, ...rest] = values;
  add(errors, rest.every((value) => isDeepStrictEqual(value, first)), `${label} does not match across control files/claim`);
}

function validateWorkOrderSections(source, acceptanceIds, errors) {
  const matches = [...source.matchAll(/^##\s+(.+?)\s*$/gm)];
  const headings = matches.map((match) => match[1]);
  add(
    errors,
    isDeepStrictEqual(headings, WORK_ORDER_HEADINGS),
    `WORK-ORDER.md headings must be exactly ${WORK_ORDER_HEADINGS.join(" / ")}`,
  );
  const sections = new Map();
  for (const [index, match] of matches.entries()) {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? source.length;
    sections.set(match[1], source.slice(bodyStart, bodyEnd).trim());
  }
  for (const heading of WORK_ORDER_HEADINGS) {
    const body = sections.get(heading) ?? "";
    const normalized = body.replace(/\s+/g, " ").trim();
    const placeholder =
      /^<[^>]+>$/.test(normalized) ||
      /^\[[^\]]+\]$/.test(normalized) ||
      /^(?:todo|tbd|placeholder|fill(?: me| this)? in|none|n\/a)[.!]?$/i.test(normalized);
    add(
      errors,
      normalized.length >= 12 && !placeholder,
      `WORK-ORDER.md ${heading} section must contain substantive non-placeholder content`,
    );
  }
  const acceptanceBody = sections.get("ACCEPTANCE") ?? "";
  if (Array.isArray(acceptanceIds)) {
    for (const acceptanceId of acceptanceIds) {
      if (!nonEmptyString(acceptanceId)) continue;
      const escaped = acceptanceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`, "m");
      add(
        errors,
        pattern.test(acceptanceBody),
        `acceptance_id ${acceptanceId} is absent from the ACCEPTANCE section`,
      );
    }
  }
}

function validateInputList(value, worktree, errors, label) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must contain at least one pinned input`);
    return [];
  }
  const entries = [];
  for (const [index, input] of value.entries()) {
    if (!plainObject(input)) {
      errors.push(`${label}[${index}] must be an object`);
      continue;
    }
    const path = normalizeRepoPath(input.path, "file", errors, `${label}[${index}].path`);
    add(errors, SHA256.test(input.sha256 ?? ""), `${label}[${index}].sha256 must be lowercase SHA-256`);
    const absolutePath = join(worktree, path);
    if (!existsSync(absolutePath)) {
      errors.push(`${label}[${index}] does not exist: ${path}`);
    } else {
      const canonical = validateContainedFile(
        absolutePath,
        worktree,
        errors,
        `${label}[${index}] pinned input in the canonical worktree`,
      );
      if (SHA256.test(input.sha256 ?? "")) {
        add(errors, sha256File(canonical) === input.sha256, `${label}[${index}] hash mismatch: ${path}`);
      }
    }
    entries.push({ path, sha256: input.sha256 });
  }
  add(errors, isSortedUnique(entries.map((entry) => entry.path)), `${label} paths must be sorted and unique`);
  return entries;
}

function validateClaimPathSets(claim, errors, label) {
  return {
    writeSet: validatePathSet(claim.write_set, errors, `${label}.write_set`),
    lockedInputs: validatePathSet(claim.locked_inputs, errors, `${label}.locked_inputs`),
  };
}

function validateClaimsRegistry(registry, context, errors) {
  const { bootstrap, ownership, controlHashes, dynamicExact, worktree } = context;
  add(errors, registry.schema_version === 1, "claims registry schema_version must be 1");
  add(errors, Number.isInteger(registry.generation) && registry.generation >= 1, "claims registry generation must be a positive integer");
  add(errors, Array.isArray(registry.claims), "claims registry claims must be an array");
  const claims = Array.isArray(registry.claims) ? registry.claims : [];
  const claimIds = claims.map((claim) => claim?.claim_id);
  for (const [index, claimId] of claimIds.entries()) {
    add(errors, nonEmptyString(claimId), `claims[${index}].claim_id must be non-empty`);
  }
  add(
    errors,
    new Set(claimIds).size === claimIds.length,
    "claim_id values must be globally unique across every registry status",
  );
  const matches = claims.filter((claim) => claim?.claim_id === bootstrap.claim_id);
  add(errors, matches.length === 1, `claim ${bootstrap.claim_id} must appear exactly once (found ${matches.length})`);
  const current = matches[0] ?? {};

  add(errors, current.status === "ACTIVE", `claim ${bootstrap.claim_id} must be ACTIVE (found ${current.status ?? "absent"})`);
  add(errors, current.claim_type === "scoped", "current claim must have claim_type=scoped");
  add(errors, current.issuer_role === "global-control-plane", "current scoped claim must be minted by global-control-plane");
  add(errors, current.parent_claim_id === null, "nested scoped claims are forbidden");
  add(errors, current.role === "scoped-orchestrator", "scoped identity cannot promote to a global role");
  add(errors, current.no_global_claim === true, "current claim must preserve NO_GLOBAL_CLAIM");
  add(errors, current.generation === registry.generation, "current claim generation is stale");
  add(errors, bootstrap.claim_generation === registry.generation, "bootstrap claim generation is stale");

  for (const field of ["parent_epoch", "scope_epoch", "revision", "base_sha", "token_digest"]) {
    add(errors, current[field] === bootstrap[field], `claim ${field} does not match bootstrap`);
  }
  add(errors, current.program_id === bootstrap.program_id, "claim program_id does not match bootstrap");
  add(errors, current.work_order_id === bootstrap.work_order_id, "claim work_order_id does not match bootstrap");

  add(errors, plainObject(current.hashes), "current claim hashes must be an object");
  const claimHashes = plainObject(current.hashes) ? current.hashes : {};
  add(errors, isDeepStrictEqual(Object.keys(claimHashes).sort(), [...REQUIRED_HASHES].sort()), "claim hashes must contain exactly all four control files plus checker");
  for (const path of REQUIRED_HASHES) {
    add(errors, SHA256.test(claimHashes[path] ?? ""), `claim hash is missing/invalid for ${path}`);
    add(errors, claimHashes[path] === controlHashes[path], `claim hash mismatch for ${path}`);
  }

  const currentSets = validateClaimPathSets(current, errors, "current claim");
  add(errors, isDeepStrictEqual(currentSets.writeSet, ownership.writeSet), "claim write_set does not match OWNERSHIP.json");
  add(errors, isDeepStrictEqual(currentSets.lockedInputs, ownership.lockedInputs), "claim locked_inputs does not match OWNERSHIP.json");
  add(errors, isDeepStrictEqual(current.exclusive_groups, ownership.exclusiveGroups), "claim exclusive_groups do not match OWNERSHIP.json");
  add(errors, current.author_identity === ownership.authorIdentity, "claim author_identity does not match OWNERSHIP.json");
  add(errors, current.merger_identity === ownership.mergerIdentity, "claim merger_identity does not match OWNERSHIP.json");

  const activeScoped = [];
  for (const [index, claim] of claims.entries()) {
    add(errors, plainObject(claim), `claims[${index}] must be an object`);
    if (!plainObject(claim)) continue;
    add(errors, CLAIM_STATUSES.has(claim.status), `claims[${index}] has unknown status ${claim.status}`);
    if (claim.status !== "ACTIVE" || claim.claim_type !== "scoped") continue;
    add(errors, claim.issuer_role === "global-control-plane", `active scoped claim ${claim.claim_id} is descendant-minted`);
    add(errors, claim.parent_claim_id === null, `active scoped claim ${claim.claim_id} is nested`);
    add(errors, claim.role === "scoped-orchestrator", `active scoped claim ${claim.claim_id} promoted its role`);
    add(errors, claim.no_global_claim === true, `active scoped claim ${claim.claim_id} lost NO_GLOBAL_CLAIM`);
    add(errors, claim.generation === registry.generation, `active scoped claim ${claim.claim_id} has stale generation`);
    for (const field of ["program_id", "work_order_id", "parent_epoch", "scope_epoch", "revision"]) {
      add(errors, nonEmptyString(claim[field]), `active scoped claim ${claim.claim_id} ${field} is required`);
    }
    add(errors, GIT_SHA.test(claim.base_sha ?? ""), `active scoped claim ${claim.claim_id} base_sha must be a full lowercase Git SHA`);
    add(errors, SHA256.test(claim.token_digest ?? ""), `active scoped claim ${claim.claim_id} token_digest must be lowercase SHA-256`);
    add(errors, plainObject(claim.hashes), `active scoped claim ${claim.claim_id} hashes must be an object`);
    if (plainObject(claim.hashes)) {
      add(
        errors,
        isDeepStrictEqual(Object.keys(claim.hashes).sort(), [...REQUIRED_HASHES].sort()),
        `active scoped claim ${claim.claim_id} must anchor all control/checker hashes`,
      );
      for (const path of REQUIRED_HASHES) {
        add(errors, SHA256.test(claim.hashes[path] ?? ""), `active scoped claim ${claim.claim_id} has invalid hash for ${path}`);
      }
    }
    const sets = validateClaimPathSets(claim, errors, `claim ${claim.claim_id}`);
    validateForbiddenWriteSet(sets.writeSet, errors, `claim ${claim.claim_id} write_set`, dynamicExact);
    validateIgnoredWriteSet(sets.writeSet, worktree, errors, `claim ${claim.claim_id} write_set`);
    validatePhysicalWriteSet(sets.writeSet, worktree, errors, `claim ${claim.claim_id} write_set`);
    const selfLockOverlap = setsOverlap(sets.writeSet, sets.lockedInputs);
    add(errors, !selfLockOverlap, `claim ${claim.claim_id} writes locked input ${selfLockOverlap?.join(" <> ")}`);
    add(errors, stringArray(claim.exclusive_groups), `claim ${claim.claim_id} exclusive_groups must be a string array`);
    if (Array.isArray(claim.exclusive_groups)) {
      add(errors, isSortedUnique(claim.exclusive_groups), `claim ${claim.claim_id} exclusive_groups must be sorted and unique`);
    }
    add(errors, nonEmptyString(claim.author_identity), `claim ${claim.claim_id} author_identity is required`);
    add(
      errors,
      claim.merger_identity === null || nonEmptyString(claim.merger_identity),
      `claim ${claim.claim_id} merger_identity must be null or a non-empty string`,
    );
    add(
      errors,
      claim.merger_identity === null || claim.merger_identity !== claim.author_identity,
      `claim ${claim.claim_id} has an author/merger conflict`,
    );
    activeScoped.push({ claim, ...sets });
  }

  for (let leftIndex = 0; leftIndex < activeScoped.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < activeScoped.length; rightIndex += 1) {
      const left = activeScoped[leftIndex];
      const right = activeScoped[rightIndex];
      add(
        errors,
        left.claim.scope_epoch !== right.claim.scope_epoch,
        `active scoped claim scope_epoch values must be unique: ${left.claim.claim_id}/${right.claim.claim_id}`,
      );
      add(
        errors,
        left.claim.token_digest !== right.claim.token_digest,
        `active scoped claim token_digest values must be unique: ${left.claim.claim_id}/${right.claim.claim_id}`,
      );
      const leftIdentity = [left.claim.program_id, left.claim.parent_epoch, left.claim.scope_epoch];
      const rightIdentity = [right.claim.program_id, right.claim.parent_epoch, right.claim.scope_epoch];
      add(
        errors,
        !isDeepStrictEqual(leftIdentity, rightIdentity),
        `active scoped claim {program_id,parent_epoch,scope_epoch} identities must be unique: ${left.claim.claim_id}/${right.claim.claim_id}`,
      );
      const writeOverlap = setsOverlap(left.writeSet, right.writeSet);
      add(errors, !writeOverlap, `active claims ${left.claim.claim_id}/${right.claim.claim_id} have overlapping writers: ${writeOverlap?.join(" <> ")}`);
      const leftWriteLock = setsOverlap(left.writeSet, right.lockedInputs);
      const rightWriteLock = setsOverlap(right.writeSet, left.lockedInputs);
      add(errors, !leftWriteLock, `claim ${left.claim.claim_id} writes locked input of ${right.claim.claim_id}: ${leftWriteLock?.join(" <> ")}`);
      add(errors, !rightWriteLock, `claim ${right.claim.claim_id} writes locked input of ${left.claim.claim_id}: ${rightWriteLock?.join(" <> ")}`);
      const commonGroups = (left.claim.exclusive_groups ?? []).filter((group) =>
        (right.claim.exclusive_groups ?? []).includes(group),
      );
      add(errors, commonGroups.length === 0, `active claims ${left.claim.claim_id}/${right.claim.claim_id} share exclusive group(s): ${commonGroups.join(", ")}`);
    }
  }
  return current;
}

function validateGit(context, phase, errors) {
  const { bootstrap, ownership, dynamicExact, worktree } = context;
  let head = "";
  let branch = "";
  try {
    head = git(worktree, ["rev-parse", "HEAD"]);
    branch = git(worktree, ["branch", "--show-current"]);
    git(worktree, ["cat-file", "-e", `${bootstrap.base_sha}^{commit}`]);
  } catch (error) {
    if (error instanceof CheckFailure) errors.push(...error.messages);
    else errors.push(error.message);
    return { head, branch, paths: [] };
  }
  add(errors, branch === bootstrap.branch, `branch mismatch: expected ${bootstrap.branch}, found ${branch}`);
  if (phase === "startup" || phase === "prewrite") {
    add(errors, head === bootstrap.base_sha, `${phase} requires HEAD to equal frozen base_sha`);
  } else {
    const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", bootstrap.base_sha, "HEAD"], {
      cwd: worktree,
    });
    add(errors, ancestor.status === 0, "base_sha is not an ancestor of HEAD");
  }
  try {
    const mergeCommits = git(worktree, [
      "rev-list",
      "--min-parents=2",
      `${bootstrap.base_sha}..HEAD`,
    ]);
    add(errors, mergeCommits.length === 0, `merge commits are forbidden in base_sha..HEAD: ${mergeCommits}`);
  } catch (error) {
    if (error instanceof CheckFailure) errors.push(...error.messages);
    else errors.push(error.message);
  }

  let paths = [];
  try {
    paths = changedPaths(worktree, bootstrap.base_sha);
  } catch (error) {
    if (error instanceof CheckFailure) errors.push(...error.messages);
    else errors.push(error.message);
  }
  if (phase === "startup" || phase === "prewrite") {
    add(errors, paths.length === 0, `${phase} requires a clean frozen worktree; found: ${paths.join(", ")}`);
  }
  if (phase === "boundary" || phase === "delivery") {
    for (const path of paths) {
      const reason = forbiddenReason(path, dynamicExact);
      if (reason) errors.push(`actual diff touches forbidden ${reason}: ${path}`);
      try {
        if (actualPathHasSymlinkEntry(worktree, bootstrap.base_sha, path)) {
          errors.push(`actual diff contains a forbidden symlink entry: ${path}`);
        }
      } catch (error) {
        if (error instanceof CheckFailure) errors.push(...error.messages);
        else errors.push(`cannot inspect actual diff path ${path}: ${error.message}`);
      }
      try {
        if (gitPathIsIgnored(worktree, path)) errors.push(`actual diff touches ignored write target: ${path}`);
      } catch (error) {
        if (error instanceof CheckFailure) errors.push(...error.messages);
        else errors.push(error.message);
      }
      if (!pathCovered(path, ownership.writeSet)) errors.push(`actual diff is outside ownership: ${path}`);
    }
  }
  return { head, branch, paths };
}

function validateGitObject(actual, expected, errors, label) {
  add(errors, plainObject(actual), `${label} must be an object`);
  if (!plainObject(actual)) return;
  for (const field of ["branch", "base_sha", "head_sha"]) {
    add(errors, actual[field] === expected[field], `${label}.${field} does not match current Git state`);
  }
}

function validateDelivery(context, gitState, registry, workOrder, errors) {
  const { bootstrap, ownership, mailbox } = context;
  const evidenceRoot = canonicalExistingPath(join(mailbox, "EVIDENCE"), errors, "runtime EVIDENCE directory", "directory");
  add(errors, pathInside(mailbox, evidenceRoot), "runtime EVIDENCE directory escapes the canonical mailbox");
  const reportPath = validateContainedFile(
    join(mailbox, "REPORT.md"),
    mailbox,
    errors,
    "runtime REPORT.md",
  );
  const evidenceManifestPath = validateContainedFile(
    join(mailbox, "EVIDENCE", "manifest.json"),
    evidenceRoot,
    errors,
    "runtime EVIDENCE/manifest.json",
  );
  const statePath = validateContainedFile(
    join(mailbox, "STATE.json"),
    mailbox,
    errors,
    "runtime STATE.json",
  );
  const report = readMarkedJson(reportPath, errors, "runtime REPORT.md").data;
  const evidence = readJson(evidenceManifestPath, errors, "runtime EVIDENCE/manifest.json");
  const state = readJson(statePath, errors, "runtime STATE.json");
  const expectedGit = { branch: gitState.branch, base_sha: bootstrap.base_sha, head_sha: gitState.head };

  for (const [label, value] of [
    ["report", report],
    ["evidence manifest", evidence],
    ["state", state],
  ]) {
    add(errors, value.schema_version === 1, `${label} schema_version must be 1`);
    add(errors, value.program_id === bootstrap.program_id, `${label} program_id mismatch`);
    add(errors, value.work_order_id === bootstrap.work_order_id, `${label} work_order_id mismatch`);
    add(errors, value.revision === bootstrap.revision, `${label} revision mismatch`);
  }

  add(errors, report.result === "READY_FOR_VERIFY", "report result must be READY_FOR_VERIFY");
  add(errors, stringArray(report.changed_facts), "report changed_facts must be a string array");
  add(errors, stringArray(report.changed_files), "report changed_files must be a string array");
  if (Array.isArray(report.changed_files)) {
    add(errors, isDeepStrictEqual(report.changed_files, gitState.paths), "report changed_files must exactly match committed/uncommitted/untracked paths");
  }
  add(errors, stringArray(report.failures), "report failures must be a string array");
  add(errors, stringArray(report.unknowns), "report unknowns must be a string array");
  add(errors, Array.isArray(report.failures) && report.failures.length === 0, "READY_FOR_VERIFY report cannot contain failures");
  add(errors, Array.isArray(report.unknowns) && report.unknowns.length === 0, "READY_FOR_VERIFY report cannot contain unknowns");
  add(errors, report.no_out_of_scope_changes === true, "report must declare no_out_of_scope_changes=true");
  validateGitObject(report.git, expectedGit, errors, "report.git");

  add(errors, plainObject(report.actors), "report actors must be an object");
  if (plainObject(report.actors)) {
    add(errors, report.actors.author_identity === ownership.authorIdentity, "report author_identity mismatch");
    add(errors, report.actors.merger_identity === ownership.mergerIdentity, "report merger_identity mismatch");
    add(errors, report.actors.merge_executed === false, "scoped delivery must not execute a merge");
    add(
      errors,
      report.actors.merger_identity === null || report.actors.merger_identity !== report.actors.author_identity,
      "report has an author/merger conflict",
    );
  }

  add(errors, evidence.result === "READY_FOR_VERIFY", "evidence result must be READY_FOR_VERIFY");
  add(errors, evidence.no_out_of_scope_changes === true, "evidence must declare no_out_of_scope_changes=true");
  validateGitObject(evidence.git, expectedGit, errors, "evidence.git");
  const evidenceEntries = Array.isArray(evidence.entries) ? evidence.entries : [];
  add(errors, evidenceEntries.length > 0, "evidence entries must be non-empty");
  const evidenceIds = [];
  const evidenceHashes = {};
  const evidenceChangedPaths = [];
  const evidenceCommands = [];
  const acceptanceCoverage = new Set();
  const evidenceAcceptance = new Map();
  for (const [index, entry] of evidenceEntries.entries()) {
    const label = `evidence.entries[${index}]`;
    if (!plainObject(entry)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    add(errors, nonEmptyString(entry.id), `${label}.id is required`);
    add(errors, stringArray(entry.acceptance_ids, { nonEmpty: true }), `${label}.acceptance_ids must be non-empty`);
    add(errors, nonEmptyString(entry.command), `${label}.command is required`);
    add(errors, Number.isInteger(entry.exit_code), `${label}.exit_code must be an integer`);
    add(errors, entry.exit_code === 0, `${label}.exit_code must be zero for READY_FOR_VERIFY`);
    add(errors, stringArray(entry.changed_paths), `${label}.changed_paths must be a string array`);
    if (Array.isArray(entry.changed_paths)) {
      add(errors, isSortedUnique(entry.changed_paths), `${label}.changed_paths must be sorted and unique`);
      for (const path of entry.changed_paths) {
        normalizeRepoPath(path, "file", errors, `${label}.changed_paths`);
        add(errors, gitState.paths.includes(path), `${label}.changed_paths contains non-diff path ${path}`);
        evidenceChangedPaths.push(path);
      }
    }
    const outputPath = normalizeRepoPath(entry.output_path, "file", errors, `${label}.output_path`);
    add(errors, outputPath.startsWith("EVIDENCE/") && outputPath !== "EVIDENCE/manifest.json", `${label}.output_path must name an evidence file under EVIDENCE/`);
    add(errors, SHA256.test(entry.sha256 ?? ""), `${label}.sha256 must be lowercase SHA-256`);
    const absoluteOutput = join(mailbox, outputPath);
    if (!existsSync(absoluteOutput)) errors.push(`${label}.output_path is missing: ${outputPath}`);
    else {
      const canonicalOutput = validateContainedFile(
        absoluteOutput,
        evidenceRoot,
        errors,
        `${label} evidence output`,
        { directRegular: true },
      );
      add(errors, sha256File(canonicalOutput) === entry.sha256, `${label} evidence hash mismatch: ${outputPath}`);
    }
    if (nonEmptyString(entry.id)) evidenceIds.push(entry.id);
    if (nonEmptyString(entry.output_path)) evidenceHashes[entry.output_path] = entry.sha256;
    if (Array.isArray(entry.acceptance_ids)) {
      for (const acceptanceId of entry.acceptance_ids) acceptanceCoverage.add(acceptanceId);
    }
    if (nonEmptyString(entry.id) && Array.isArray(entry.acceptance_ids)) {
      evidenceAcceptance.set(entry.id, new Set(entry.acceptance_ids));
    }
    evidenceCommands.push({ id: entry.id, command: entry.command, exit_code: entry.exit_code });
  }
  add(errors, isSortedUnique(evidenceIds), "evidence entry ids must be sorted and unique");
  add(errors, isDeepStrictEqual(sortedUnique(evidenceChangedPaths), gitState.paths), "evidence changed_paths union must exactly match actual diff paths");
  add(errors, plainObject(report.evidence_hashes), "report evidence_hashes must be an object");
  if (plainObject(report.evidence_hashes)) {
    add(errors, isDeepStrictEqual(report.evidence_hashes, evidenceHashes), "report evidence_hashes must match the evidence manifest");
  }
  add(errors, Array.isArray(report.commands), "report commands must be an array");
  if (Array.isArray(report.commands)) {
    add(errors, isDeepStrictEqual(report.commands, evidenceCommands), "report commands must match evidence ids/commands/exit codes");
  }

  const acceptanceIds = workOrder.acceptance_ids;
  add(errors, stringArray(acceptanceIds, { nonEmpty: true }) && isSortedUnique(acceptanceIds), "work order acceptance_ids must be sorted, unique, and non-empty");
  const mappings = Array.isArray(report.acceptance_mapping) ? report.acceptance_mapping : [];
  add(errors, mappings.length > 0, "report acceptance_mapping must be non-empty");
  const mappedIds = [];
  for (const [index, mapping] of mappings.entries()) {
    const label = `report.acceptance_mapping[${index}]`;
    if (!plainObject(mapping)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    add(errors, nonEmptyString(mapping.acceptance_id), `${label}.acceptance_id is required`);
    add(errors, mapping.status === "PASS", `${label}.status must be PASS`);
    add(errors, stringArray(mapping.evidence_ids, { nonEmpty: true }), `${label}.evidence_ids must be non-empty`);
    if (Array.isArray(mapping.evidence_ids)) {
      for (const id of mapping.evidence_ids) {
        add(errors, evidenceIds.includes(id), `${label} references unknown evidence id ${id}`);
        if (evidenceAcceptance.has(id)) {
          add(
            errors,
            evidenceAcceptance.get(id).has(mapping.acceptance_id),
            `evidence edge ${id} does not declare acceptance ${mapping.acceptance_id}`,
          );
        }
      }
    }
    mappedIds.push(mapping.acceptance_id);
  }
  add(errors, isDeepStrictEqual(mappedIds, acceptanceIds), "acceptance_mapping must cover work-order acceptance_ids exactly and in order");
  add(errors, isDeepStrictEqual([...acceptanceCoverage].sort(), acceptanceIds), "evidence entries must cover every acceptance id exactly as a set");

  add(errors, state.status === "READY_FOR_VERIFY", "STATE.json status must be READY_FOR_VERIFY");
  add(errors, state.phase === "delivery", "STATE.json phase must be delivery");
  add(errors, state.last_validated_generation === registry.generation, "STATE.json generation is stale");
  add(errors, state.base_sha === bootstrap.base_sha, "STATE.json base_sha mismatch");
  add(errors, state.head_sha === gitState.head, "STATE.json head_sha mismatch");
}

export function checkExecutionHarness({ phase, controlDir, claimsPath }) {
  const errors = [];
  const canonicalControlDir = canonicalExistingPath(
    controlDir,
    errors,
    "control directory",
    "directory",
  );
  const controlPaths = Object.fromEntries(
    CONTROL_FILES.map((name) => {
      const path = canonicalExistingPath(join(controlDir, name), errors, `control file ${name}`, "file");
      add(
        errors,
        pathInside(canonicalControlDir, path),
        `control file ${name} escapes the canonical control directory`,
      );
      return [name, path];
    }),
  );
  const canonicalClaimsDirectory = canonicalExistingPath(
    dirname(claimsPath),
    errors,
    "claims registry directory",
    "directory",
  );
  const canonicalClaimsPath = canonicalExistingPath(
    claimsPath,
    errors,
    "claims registry",
    "file",
  );
  add(
    errors,
    pathInside(canonicalClaimsDirectory, canonicalClaimsPath),
    "claims registry escapes its canonical registry directory",
  );
  const bootstrapDoc = readMarkedJson(controlPaths["BOOTSTRAP.md"], errors, "BOOTSTRAP.md");
  const workOrderDoc = readMarkedJson(controlPaths["WORK-ORDER.md"], errors, "WORK-ORDER.md");
  const lock = readJson(controlPaths["INPUTS.lock.json"], errors, "INPUTS.lock.json");
  const ownershipRaw = readJson(controlPaths["OWNERSHIP.json"], errors, "OWNERSHIP.json");
  const bootstrap = bootstrapDoc.data;
  const workOrder = workOrderDoc.data;

  add(errors, bootstrap.schema_version === 1, "BOOTSTRAP schema_version must be 1");
  add(errors, bootstrap.role === "scoped-orchestrator", "BOOTSTRAP role must be scoped-orchestrator");
  add(errors, bootstrap.no_global_claim === true, "BOOTSTRAP must set no_global_claim=true");
  add(errors, plainObject(bootstrap.identity_lock), "BOOTSTRAP identity_lock is required");
  if (plainObject(bootstrap.identity_lock)) {
    add(errors, bootstrap.identity_lock.promotion === "forbidden", "identity promotion must be forbidden");
    add(errors, bootstrap.identity_lock.descendant_claims === "forbidden", "descendant claims must be forbidden");
  }
  for (const field of ["program_id", "work_order_id", "revision", "parent_epoch", "scope_epoch", "claim_id", "branch", "founder_intent_snapshot"]) {
    add(errors, nonEmptyString(bootstrap[field]), `BOOTSTRAP ${field} is required`);
  }
  add(errors, GIT_SHA.test(bootstrap.base_sha ?? ""), "BOOTSTRAP base_sha must be a full lowercase Git SHA");
  add(errors, SHA256.test(bootstrap.token_digest ?? ""), "BOOTSTRAP token_digest must be lowercase SHA-256");
  add(errors, Number.isInteger(bootstrap.claim_generation) && bootstrap.claim_generation >= 1, "BOOTSTRAP claim_generation must be positive");
  add(errors, isAbsolute(bootstrap.worktree ?? ""), "BOOTSTRAP worktree must be absolute");
  add(errors, isAbsolute(bootstrap.runtime_mailbox ?? ""), "BOOTSTRAP runtime_mailbox must be absolute");
  add(errors, isAbsolute(bootstrap.claims_registry ?? ""), "BOOTSTRAP claims_registry must be absolute");
  add(errors, resolve(bootstrap.claims_registry ?? "/") === claimsPath, "--claims must be the exact registry pinned by BOOTSTRAP");
  add(errors, bootstrap.checker_path === CHECKER_PATH, `BOOTSTRAP checker_path must be ${CHECKER_PATH}`);
  add(errors, bootstrap.hash_authority === "global_claim_registry", "BOOTSTRAP hash_authority must be global_claim_registry");
  add(errors, isDeepStrictEqual(bootstrap.required_hashes, REQUIRED_HASHES), "BOOTSTRAP required_hashes must list all four controls plus checker in canonical order");
  add(errors, stringArray(bootstrap.stop_conditions, { nonEmpty: true }), "BOOTSTRAP stop_conditions must be non-empty");
  add(errors, stringArray(bootstrap.escalate_conditions, { nonEmpty: true }), "BOOTSTRAP escalate_conditions must be non-empty");

  add(errors, workOrder.schema_version === 1, "WORK-ORDER schema_version must be 1");
  add(
    errors,
    stringArray(workOrder.acceptance_ids, { nonEmpty: true }) && isSortedUnique(workOrder.acceptance_ids),
    "WORK-ORDER acceptance_ids must be sorted, unique, and non-empty",
  );
  validateWorkOrderSections(workOrderDoc.source, workOrder.acceptance_ids, errors);
  add(errors, lock.schema_version === 1, "INPUTS.lock schema_version must be 1");
  add(errors, ownershipRaw.schema_version === 1, "OWNERSHIP schema_version must be 1");
  for (const field of ["program_id", "work_order_id", "revision", "parent_epoch", "scope_epoch", "base_sha"]) {
    requireMatching(errors, field, [bootstrap[field], workOrder[field], lock[field], ownershipRaw[field]]);
  }
  add(errors, lock.claim?.id === bootstrap.claim_id, "INPUTS.lock claim.id mismatch");
  add(errors, lock.claim?.token_digest === bootstrap.token_digest, "INPUTS.lock claim.token_digest mismatch");
  add(errors, lock.claim?.generation === bootstrap.claim_generation, "INPUTS.lock claim.generation mismatch");
  add(errors, lock.hashing?.algorithm === "sha256", "INPUTS.lock hashing.algorithm must be sha256");
  add(errors, lock.hashing?.authority === "global_claim_registry", "INPUTS.lock hashing.authority must be global_claim_registry");
  add(errors, isDeepStrictEqual(lock.hashing?.required_artifacts, REQUIRED_HASHES), "INPUTS.lock must require hashes for all controls plus checker");

  const worktree = canonicalExistingPath(
    resolve(bootstrap.worktree ?? "/invalid"),
    errors,
    "scoped worktree",
    "directory",
  );
  try {
    const repoTop = realpathSync(git(worktree, ["rev-parse", "--show-toplevel"]));
    add(errors, repoTop === worktree, "scoped worktree must be the canonical Git repository top level");
  } catch (error) {
    if (error instanceof CheckFailure) errors.push(...error.messages);
    else errors.push(`cannot verify scoped worktree repository top level: ${error.message}`);
  }
  const mailbox = canonicalExistingPath(
    resolve(bootstrap.runtime_mailbox ?? "/invalid"),
    errors,
    "runtime_mailbox",
    "directory",
  );
  add(errors, !pathInside(worktree, canonicalControlDir), "control directory must resolve outside the scoped worktree");
  add(errors, !pathInside(worktree, canonicalClaimsPath), "claims registry must resolve outside the scoped worktree");
  add(errors, !pathInside(worktree, mailbox), "runtime_mailbox must resolve outside the canonical worktree");
  add(
    errors,
    pathsDisjoint(canonicalControlDir, mailbox),
    "control directory must be mutually disjoint from the runtime mailbox",
  );
  add(
    errors,
    pathsDisjoint(canonicalClaimsPath, mailbox),
    "claims registry must be mutually disjoint from the runtime mailbox",
  );
  try {
    add(
      errors,
      realpathSync(bootstrap.claims_registry) === canonicalClaimsPath,
      "BOOTSTRAP claims_registry does not resolve to the canonical --claims registry",
    );
  } catch (error) {
    errors.push(`BOOTSTRAP claims_registry cannot be canonicalized: ${error.message}`);
  }
  const authoritativeInputs = validateInputList(lock.authoritative_inputs, worktree, errors, "authoritative_inputs");
  const sharedInputs = validateInputList(lock.shared_contract_inputs, worktree, errors, "shared_contract_inputs");
  const writeSet = validatePathSet(ownershipRaw.write_set, errors, "OWNERSHIP.write_set");
  const lockedInputs = validatePathSet(ownershipRaw.locked_inputs, errors, "OWNERSHIP.locked_inputs");
  add(errors, ownershipRaw.role === "scoped-orchestrator", "OWNERSHIP role must be scoped-orchestrator");
  add(errors, ownershipRaw.no_global_claim === true, "OWNERSHIP must set no_global_claim=true");
  add(errors, stringArray(ownershipRaw.exclusive_groups), "OWNERSHIP exclusive_groups must be a string array");
  if (Array.isArray(ownershipRaw.exclusive_groups)) {
    add(errors, isSortedUnique(ownershipRaw.exclusive_groups), "OWNERSHIP exclusive_groups must be sorted and unique");
  }
  add(errors, nonEmptyString(ownershipRaw.author_identity), "OWNERSHIP author_identity is required");
  add(errors, ownershipRaw.merger_identity === null || nonEmptyString(ownershipRaw.merger_identity), "OWNERSHIP merger_identity must be null or non-empty");
  add(errors, ownershipRaw.merger_identity === null || ownershipRaw.merger_identity !== ownershipRaw.author_identity, "OWNERSHIP has an author/merger conflict");
  for (const input of [...authoritativeInputs, ...sharedInputs]) {
    add(errors, pathCovered(input.path, lockedInputs), `pinned input is not in OWNERSHIP.locked_inputs: ${input.path}`);
  }

  const dynamicExact = new Map();
  for (const [name, path] of Object.entries(controlPaths)) {
    const repoPath = asRepoPath(worktree, path);
    if (repoPath) dynamicExact.set(repoPath, `control file ${name}`);
  }
  const claimsRepoPath = asRepoPath(worktree, canonicalClaimsPath);
  if (claimsRepoPath) dynamicExact.set(claimsRepoPath, "claims registry");
  validateForbiddenWriteSet(writeSet, errors, "OWNERSHIP.write_set", dynamicExact);
  validateIgnoredWriteSet(writeSet, worktree, errors, "OWNERSHIP.write_set");
  validatePhysicalWriteSet(writeSet, worktree, errors, "OWNERSHIP.write_set");
  const writeLockOverlap = setsOverlap(writeSet, lockedInputs);
  add(errors, !writeLockOverlap, `OWNERSHIP writes a locked input: ${writeLockOverlap?.join(" <> ")}`);

  const ownership = {
    writeSet,
    lockedInputs,
    exclusiveGroups: Array.isArray(ownershipRaw.exclusive_groups) ? ownershipRaw.exclusive_groups : [],
    authorIdentity: ownershipRaw.author_identity,
    mergerIdentity: ownershipRaw.merger_identity,
  };
  const controlHashes = {};
  for (const [name, path] of Object.entries(controlPaths)) {
    if (existsSync(path)) controlHashes[name] = sha256File(path);
  }
  const expectedChecker = join(worktree, CHECKER_PATH);
  add(errors, existsSync(expectedChecker), `checker is missing at ${CHECKER_PATH}`);
  if (existsSync(expectedChecker)) {
    const canonicalChecker = validateContainedFile(
      expectedChecker,
      worktree,
      errors,
      "scoped execution checker",
    );
    controlHashes[CHECKER_PATH] = sha256File(canonicalChecker);
  }
  try {
    add(errors, realpathSync(fileURLToPath(import.meta.url)) === realpathSync(expectedChecker), "executed checker is not the checker pinned in the scoped worktree");
  } catch (error) {
    errors.push(`cannot resolve executed checker: ${error.message}`);
  }

  const registry = readJson(canonicalClaimsPath, errors, "claims registry");
  const context = { bootstrap, ownership, controlHashes, dynamicExact, worktree, mailbox };
  validateClaimsRegistry(registry, context, errors);
  const gitState = validateGit(context, phase, errors);
  if (phase === "delivery") validateDelivery(context, gitState, registry, workOrder, errors);
  if (errors.length) throw new CheckFailure(sortedUnique(errors));
  return { phase, generation: registry.generation, head: gitState.head, changed_paths: gitState.paths };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = checkExecutionHarness(args);
    console.log(
      `execution-harness-check: PASS phase=${result.phase} generation=${result.generation} changed=${result.changed_paths.length}`,
    );
  } catch (error) {
    const messages = error instanceof CheckFailure ? error.messages : [error.stack ?? error.message];
    console.error("execution-harness-check: FAIL");
    for (const message of messages) console.error(`- ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
