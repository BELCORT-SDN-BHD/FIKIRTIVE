#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = "BELCORT-SDN-BHD/FIKIRTIVE";
const TOP_KEYS = ["claims", "generation", "schema_version"];
const CLAIM_KEYS = [
  "base_sha",
  "claim_id",
  "claimed_at",
  "expires_at",
  "issue_url",
  "revision",
  "scope",
  "session_id",
  "status",
  "worktree",
];
const STATUSES = new Set(["ACTIVE", "RELEASED", "SUPERSEDED"]);
const GIT_SHA = /^[a-f0-9]{40}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export class OwnershipError extends Error {
  constructor(messages) {
    const list = Array.isArray(messages) ? messages : [messages];
    super(list.join("\n"));
    this.messages = list;
  }
}

function gitResult(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function git(cwd, args) {
  const result = gitResult(cwd, args);
  if (result.status !== 0) {
    throw new OwnershipError(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

function normalizeRemote(remote) {
  let value = remote.trim();
  if (value.startsWith("git@github.com:")) value = `https://github.com/${value.slice(15)}`;
  if (value.startsWith("ssh://git@github.com/")) {
    value = `https://github.com/${value.slice("ssh://git@github.com/".length)}`;
  }
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    return url.pathname.replace(/^\//, "").replace(/\.git$/, "");
  } catch {
    return null;
  }
}

export function discoverRepository(cwd = process.cwd()) {
  const top = realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]));
  const commonRaw = git(top, ["rev-parse", "--git-common-dir"]);
  const commonDir = realpathSync(isAbsolute(commonRaw) ? commonRaw : resolve(top, commonRaw));
  const remote = git(top, ["remote", "get-url", "origin"]);
  if (normalizeRemote(remote) !== REPOSITORY) {
    throw new OwnershipError(`wrong repository: expected ${REPOSITORY}`);
  }
  return {
    root: top,
    commonDir,
    registryDir: join(commonDir, "fikirtive"),
    registryPath: join(commonDir, "fikirtive", "ownership.json"),
    lockPath: join(commonDir, "fikirtive", "ownership.lock"),
  };
}

function sameKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected)
  );
}

function timestamp(value, label, errors) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    errors.push(`${label} must be an ISO-8601 UTC timestamp`);
    return NaN;
  }
  return Date.parse(value);
}

function normalizeScopeEntry(value, label, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${label} must be a non-empty repository-relative path`);
    return "<invalid>";
  }
  if (
    isAbsolute(value) ||
    value.startsWith("./") ||
    value.includes("\\") ||
    value.includes("\0") ||
    /[*?\[\]{}!]/.test(value)
  ) {
    errors.push(`${label} must be a normalized POSIX path without globs: ${value}`);
    return "<invalid>";
  }
  const raw = value.endsWith("/") ? value.slice(0, -1) : value;
  const parts = raw.split("/");
  if (!raw || parts.some((part) => !part || part === "." || part === "..")) {
    errors.push(`${label} is not normalized: ${value}`);
    return "<invalid>";
  }
  if (raw === ".git" || raw.startsWith(".git/")) {
    errors.push(`${label} cannot name Git metadata: ${value}`);
    return "<invalid>";
  }
  return value;
}

function scopeEntries(scope) {
  return scope.map((path) => ({ path, directory: path.endsWith("/") }));
}

function entriesOverlap(left, right) {
  if (!left.directory && !right.directory) return left.path === right.path;
  if (left.directory && right.directory) {
    return left.path.startsWith(right.path) || right.path.startsWith(left.path);
  }
  const directory = left.directory ? left.path : right.path;
  const file = left.directory ? right.path : left.path;
  return file.startsWith(directory);
}

function scopesOverlap(left, right) {
  for (const leftEntry of scopeEntries(left)) {
    for (const rightEntry of scopeEntries(right)) {
      if (entriesOverlap(leftEntry, rightEntry)) return `${leftEntry.path} <> ${rightEntry.path}`;
    }
  }
  return null;
}

function nullSeparatedGit(cwd, args) {
  const result = gitResult(cwd, args);
  if (result.status !== 0) {
    throw new OwnershipError(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.split("\0").filter(Boolean);
}

function committedWriteSet(cwd, baseSha) {
  return new Set(
    nullSeparatedGit(cwd, ["diff", "--name-only", "--no-renames", "-z", `${baseSha}..HEAD`, "--"]),
  );
}

function uncommittedWriteSet(cwd) {
  const paths = new Set();
  const commands = [
    ["diff", "--cached", "--name-only", "--no-renames", "-z", "--"],
    ["diff", "--name-only", "--no-renames", "-z", "--"],
    ["ls-files", "--others", "--exclude-standard", "-z", "--"],
  ];
  for (const args of commands) {
    for (const path of nullSeparatedGit(cwd, args)) paths.add(path);
  }
  return paths;
}

function resolveRef(cwd, ref) {
  const result = gitResult(cwd, ["rev-parse", "--verify", "-q", ref]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function blobAt(cwd, ref, path) {
  const result = gitResult(cwd, ["rev-parse", "--verify", "-q", `${ref}:${path}`]);
  return result.status === 0 ? result.stdout.trim() : null;
}

// Committed-only out-of-scope paths are exempt when their HEAD tree entry (mode and
// content, not content alone) is identical to the same path in mainline (merge-base(HEAD,
// origin/main) or origin/main's tip) — i.e. the path was pulled in unchanged by merging
// origin/main, not authored by this claim. Comparing the tree entry rather than just the
// blob closes a mode-bit-only escape: a permission-mode flip (e.g. 100644 -> 100755) leaves
// the blob hash unchanged but is still a real change this claim made, so it must not be
// exempt. When origin/main cannot be resolved at all (offline, shallow clone, no tracking
// ref), no baseline exists and this returns no exemptions: behavior fails closed to the
// prior, unexempted check.
function resolveMainlineBaselines(cwd) {
  const mainTip = resolveRef(cwd, "origin/main");
  if (!mainTip) return [];
  const baselines = new Set([mainTip]);
  const mergeBase = gitResult(cwd, ["merge-base", "HEAD", "origin/main"]);
  if (mergeBase.status === 0 && mergeBase.stdout.trim()) baselines.add(mergeBase.stdout.trim());
  return [...baselines];
}

function pathIdenticalToRef(cwd, ref, path) {
  const result = gitResult(cwd, ["diff", "--quiet", ref, "HEAD", "--", path]);
  return result.status === 0;
}

function isExemptByMainline(cwd, path, baselines) {
  if (baselines.length === 0) return false;
  if (!blobAt(cwd, "HEAD", path)) return false;
  return baselines.some((ref) => pathIdenticalToRef(cwd, ref, path));
}

function scopeContainsPath(scope, path) {
  return scope.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));
}

function validateClaimShape(claim, index, errors) {
  const label = `claims[${index}]`;
  if (!sameKeys(claim, CLAIM_KEYS)) {
    errors.push(`${label} must contain exactly the closed task-ownership fields`);
    return null;
  }
  for (const field of ["claim_id", "revision", "session_id"]) {
    if (typeof claim[field] !== "string" || !claim[field].trim()) {
      errors.push(`${label}.${field} must be non-empty`);
    }
  }
  if (!GIT_SHA.test(claim.base_sha)) errors.push(`${label}.base_sha must be a full lowercase Git SHA`);
  if (!STATUSES.has(claim.status)) errors.push(`${label}.status is invalid`);
  if (!isAbsolute(claim.worktree)) errors.push(`${label}.worktree must be absolute`);
  if (!/^https:\/\/github\.com\/BELCORT-SDN-BHD\/FIKIRTIVE\/issues\/[1-9]\d*$/.test(claim.issue_url)) {
    errors.push(`${label}.issue_url must be an exact FIKIRTIVE GitHub issue URL`);
  }
  if (!Array.isArray(claim.scope) || claim.scope.length === 0) {
    errors.push(`${label}.scope must be a non-empty array`);
  }
  const scope = Array.isArray(claim.scope)
    ? claim.scope.map((entry, scopeIndex) =>
        normalizeScopeEntry(entry, `${label}.scope[${scopeIndex}]`, errors),
      )
    : [];
  if (JSON.stringify(scope) !== JSON.stringify([...new Set(scope)].sort())) {
    errors.push(`${label}.scope must be sorted and unique`);
  }
  const claimedAt = timestamp(claim.claimed_at, `${label}.claimed_at`, errors);
  const expiresAt = timestamp(claim.expires_at, `${label}.expires_at`, errors);
  if (Number.isFinite(claimedAt) && Number.isFinite(expiresAt) && claimedAt >= expiresAt) {
    errors.push(`${label}.expires_at must be later than claimed_at`);
  }
  return { claim, scope, claimedAt, expiresAt, label };
}

function validateActivePhysical(entry, context, errors) {
  const { claim, label, scope } = entry;
  try {
    if (!existsSync(claim.worktree) || !lstatSync(claim.worktree).isDirectory()) {
      errors.push(`${label}.worktree does not exist as a directory`);
      return;
    }
    const activeContext = discoverRepository(claim.worktree);
    if (claim.worktree !== activeContext.root) errors.push(`${label}.worktree is not canonical`);
    if (activeContext.commonDir !== context.commonDir) {
      errors.push(`${label}.worktree does not share this Git common-dir`);
    }
    const object = gitResult(activeContext.root, ["cat-file", "-e", `${claim.base_sha}^{commit}`]);
    if (object.status !== 0) errors.push(`${label}.base_sha is missing from the repository`);
    const ancestor = gitResult(activeContext.root, [
      "merge-base",
      "--is-ancestor",
      claim.base_sha,
      "HEAD",
    ]);
    if (ancestor.status !== 0) {
      errors.push(`${label}.base_sha is not an ancestor of worktree HEAD`);
    } else {
      const committed = committedWriteSet(activeContext.root, claim.base_sha);
      const uncommitted = uncommittedWriteSet(activeContext.root);
      const baselines = resolveMainlineBaselines(activeContext.root);
      const allPaths = new Set([...committed, ...uncommitted]);
      for (const path of [...allPaths].sort()) {
        if (scopeContainsPath(scope, path)) continue;
        const committedOnly = committed.has(path) && !uncommitted.has(path);
        if (committedOnly && isExemptByMainline(activeContext.root, path, baselines)) continue;
        errors.push(`${label} has an out-of-scope committed/index/worktree/untracked path: ${path}`);
      }
    }
  } catch (error) {
    errors.push(`${label}.worktree cannot be verified: ${error.message}`);
  }
}

export function validateOwnershipRegistry(
  registry,
  { context, now = new Date(), skipExpiryClaimId = null, physical = true } = {},
) {
  const errors = [];
  if (!sameKeys(registry, TOP_KEYS)) {
    throw new OwnershipError("registry must contain exactly schema_version, generation, and claims");
  }
  if (registry.schema_version !== 1) errors.push("registry schema_version must be 1");
  if (!Number.isInteger(registry.generation) || registry.generation < 1) {
    errors.push("registry generation must be a positive integer");
  }
  if (!Array.isArray(registry.claims)) errors.push("registry claims must be an array");
  const entries = Array.isArray(registry.claims)
    ? registry.claims
        .map((claim, index) => validateClaimShape(claim, index, errors))
        .filter(Boolean)
    : [];
  const ids = entries.map(({ claim }) => claim.claim_id);
  if (new Set(ids).size !== ids.length) errors.push("claim_id values must be globally unique");

  const active = entries.filter(({ claim }) => claim.status === "ACTIVE");
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  for (const entry of active) {
    if (entry.claim.claim_id !== skipExpiryClaimId && entry.expiresAt <= nowMs) {
      errors.push(`ACTIVE claim ${entry.claim.claim_id} is expired and remains blocking`);
    }
    if (physical && context) validateActivePhysical(entry, context, errors);
  }

  for (const field of ["issue_url", "session_id", "worktree"]) {
    const values = active.map(({ claim }) => claim[field]);
    if (new Set(values).size !== values.length) errors.push(`ACTIVE ${field} values must be unique`);
  }
  for (let left = 0; left < active.length; left += 1) {
    for (let right = left + 1; right < active.length; right += 1) {
      const overlap = scopesOverlap(active[left].scope, active[right].scope);
      if (overlap) {
        errors.push(
          `ACTIVE claims ${active[left].claim.claim_id}/${active[right].claim.claim_id} overlap: ${overlap}`,
        );
      }
    }
  }
  if (errors.length) throw new OwnershipError([...new Set(errors)].sort());
  return { generation: registry.generation, active };
}

function ensurePrivateDirectory(path, { create = false } = {}) {
  if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new OwnershipError("ownership registry directory must be a real directory");
  }
  if ((stats.mode & 0o777) !== 0o700) {
    throw new OwnershipError("ownership registry directory must have mode 0700");
  }
}

function pathEntryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function loadOwnershipRegistry(context) {
  ensurePrivateDirectory(context.registryDir);
  const stats = lstatSync(context.registryPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new OwnershipError("ownership registry must be a real regular file");
  }
  if ((stats.mode & 0o777) !== 0o600) {
    throw new OwnershipError("ownership registry must have mode 0600");
  }
  let registry;
  try {
    registry = JSON.parse(readFileSync(context.registryPath, "utf8"));
  } catch (error) {
    throw new OwnershipError(`ownership registry is invalid JSON: ${error.message}`);
  }
  return registry;
}

function writeRegistryAtomic(context, registry) {
  const temporary = join(context.registryDir, `.ownership-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, context.registryPath);
    const directoryDescriptor = openSync(context.registryDir, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function writeInitialRegistry(context) {
  const registry = { schema_version: 1, generation: 1, claims: [] };
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(context.registryPath, "wx", 0o600);
    created = true;
    writeFileSync(descriptor, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const directoryDescriptor = openSync(context.registryDir, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created) rmSync(context.registryPath, { force: true });
    throw error;
  }
}

function withRegistryLock(context, callback) {
  ensurePrivateDirectory(context.registryDir, { create: true });
  let descriptor;
  try {
    descriptor = openSync(context.lockPath, "wx", 0o600);
    closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    throw new OwnershipError(`ownership registry is locked; fail closed (${error.code ?? error.message})`);
  }
  try {
    return callback();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(context.lockPath, { force: true });
  }
}

function parseFlags(args, booleanFlags = new Set()) {
  const flags = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag.startsWith("--")) throw new OwnershipError(`unexpected argument: ${flag}`);
    if (booleanFlags.has(flag)) {
      if (flags.has(flag)) throw new OwnershipError(`duplicate flag: ${flag}`);
      flags.set(flag, [true]);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new OwnershipError(`missing value for ${flag}`);
    const values = flags.get(flag) ?? [];
    values.push(value);
    flags.set(flag, values);
    index += 1;
  }
  return flags;
}

function onlyFlags(flags, allowed) {
  for (const flag of flags.keys()) {
    if (!allowed.has(flag)) throw new OwnershipError(`unknown flag: ${flag}`);
  }
}

function one(flags, name, { required = false } = {}) {
  const values = flags.get(name) ?? [];
  if (values.length > 1) throw new OwnershipError(`${name} may appear only once`);
  if (required && values.length !== 1) throw new OwnershipError(`${name} is required`);
  return values[0];
}

function expectedGeneration(flags) {
  const raw = one(flags, "--expect-generation", { required: true });
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new OwnershipError("--expect-generation must be a positive integer");
  }
  return value;
}

function requireGeneration(registry, expected) {
  if (registry.generation !== expected) {
    throw new OwnershipError(
      `registry generation changed: expected ${expected}, found ${registry.generation}`,
    );
  }
}

function commandInit(context, args) {
  const flags = parseFlags(args);
  onlyFlags(flags, new Set());
  ensurePrivateDirectory(context.registryDir, { create: true });
  if (pathEntryExists(context.registryPath)) {
    throw new OwnershipError("ownership registry already exists; init never overwrites or resets it");
  }
  withRegistryLock(context, () => {
    if (pathEntryExists(context.registryPath)) {
      throw new OwnershipError("ownership registry already exists; init never overwrites or resets it");
    }
    writeInitialRegistry(context);
  });
  console.log("task-ownership-check: INITIALIZED generation=1 active=0");
}

function commandCheck(context, args) {
  const flags = parseFlags(args, new Set(["--require-zero"]));
  onlyFlags(flags, new Set(["--claim-id", "--require-zero"]));
  const claimId = one(flags, "--claim-id");
  const requireZero = flags.has("--require-zero");
  if (claimId && requireZero) throw new OwnershipError("--claim-id and --require-zero are exclusive");
  if (pathEntryExists(context.lockPath)) {
    throw new OwnershipError("ownership registry is locked; fail closed");
  }
  const registry = loadOwnershipRegistry(context);
  const result = validateOwnershipRegistry(registry, { context });
  if (requireZero && result.active.length !== 0) {
    throw new OwnershipError(`ACTIVE claims must be zero (found ${result.active.length})`);
  }
  if (claimId) {
    const matches = result.active.filter(({ claim }) => claim.claim_id === claimId);
    if (matches.length !== 1) throw new OwnershipError(`ACTIVE claim ${claimId} was not found exactly once`);
    if (matches[0].claim.worktree !== context.root) {
      throw new OwnershipError(`ACTIVE claim ${claimId} belongs to a different worktree`);
    }
  }
  console.log(
    `task-ownership-check: PASS generation=${result.generation} active=${result.active.length}`,
  );
}

function commandClaim(context, args) {
  const flags = parseFlags(args);
  onlyFlags(
    flags,
    new Set([
      "--expect-generation",
      "--claim-id",
      "--issue-url",
      "--scope",
      "--base-sha",
      "--revision",
      "--session-id",
      "--expires-at",
    ]),
  );
  const expected = expectedGeneration(flags);
  const scopes = flags.get("--scope") ?? [];
  if (scopes.length === 0) throw new OwnershipError("at least one --scope is required");
  const now = new Date();
  const claim = {
    claim_id: one(flags, "--claim-id", { required: true }),
    issue_url: one(flags, "--issue-url", { required: true }),
    scope: [...scopes].sort(),
    base_sha: one(flags, "--base-sha", { required: true }),
    revision: one(flags, "--revision", { required: true }),
    session_id: one(flags, "--session-id", { required: true }),
    worktree: context.root,
    claimed_at: now.toISOString(),
    expires_at: one(flags, "--expires-at", { required: true }),
    status: "ACTIVE",
  };
  withRegistryLock(context, () => {
    const registry = loadOwnershipRegistry(context);
    validateOwnershipRegistry(registry, { context, now });
    requireGeneration(registry, expected);
    const next = {
      ...registry,
      generation: registry.generation + 1,
      claims: [...registry.claims, claim],
    };
    validateOwnershipRegistry(next, { context, now });
    writeRegistryAtomic(context, next);
  });
  console.log(`task-ownership-check: CLAIMED ${claim.claim_id}`);
}

function commandClose(context, args) {
  const flags = parseFlags(args);
  onlyFlags(
    flags,
    new Set(["--expect-generation", "--claim-id", "--session-id", "--status"]),
  );
  const expected = expectedGeneration(flags);
  const claimId = one(flags, "--claim-id", { required: true });
  const sessionId = one(flags, "--session-id", { required: true });
  const status = one(flags, "--status", { required: true });
  if (!new Set(["RELEASED", "SUPERSEDED"]).has(status)) {
    throw new OwnershipError("--status must be RELEASED or SUPERSEDED");
  }
  withRegistryLock(context, () => {
    const registry = loadOwnershipRegistry(context);
    validateOwnershipRegistry(registry, { context, skipExpiryClaimId: claimId });
    requireGeneration(registry, expected);
    const matches = registry.claims.filter((claim) => claim.claim_id === claimId);
    if (matches.length !== 1 || matches[0].status !== "ACTIVE") {
      throw new OwnershipError(`ACTIVE claim ${claimId} was not found exactly once`);
    }
    if (matches[0].session_id !== sessionId) throw new OwnershipError("session_id does not match claim");
    const next = {
      ...registry,
      generation: registry.generation + 1,
      claims: registry.claims.map((claim) =>
        claim.claim_id === claimId ? { ...claim, status } : claim,
      ),
    };
    validateOwnershipRegistry(next, { context });
    writeRegistryAtomic(context, next);
  });
  console.log(`task-ownership-check: ${status} ${claimId}`);
}

function main() {
  try {
    const [command, ...args] = process.argv.slice(2);
    const context = discoverRepository();
    if (command === "init") commandInit(context, args);
    else if (command === "check") commandCheck(context, args);
    else if (command === "claim") commandClaim(context, args);
    else if (command === "close") commandClose(context, args);
    else throw new OwnershipError("usage: task-ownership-check.mjs {init|check|claim|close} ...");
  } catch (error) {
    const messages = error instanceof OwnershipError ? error.messages : [error.stack ?? error.message];
    console.error("task-ownership-check: FAIL");
    for (const message of messages) console.error(`- ${message}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
