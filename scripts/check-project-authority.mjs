#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CANONICAL_LAW = ".claude/CLAUDE.md";
const ROOT_ADAPTER = "AGENTS.md";
// The overlay is prose that gets rewritten; a Chinese substring made every rewrite a
// tripwire. The anchor is a stable, machine-owned marker instead: whoever moves or
// deletes the claim-policy section has to notice this check.
export const OVERLAY_CLAIM_ANCHOR = "<!-- fikirtive:claim-policy -->";
// The anchor alone is a marker, not a policy: review round 2 showed that an overlay
// containing ONLY the comment and no claim rule at all still passed this check, while the
// Chinese substring it replaced would have failed — a horizontal move, not the "anchoring,
// no relaxation" that was claimed. So the section the anchor introduces must still carry
// the three facts that make it a policy: the mandatory claim, the law clause it derives
// from, and the runbook that operates it. Three independent facts, not one brittle sentence.
export const OVERLAY_CLAIM_SUBSTANCE = [
  ["the mandatory task-linked `ACTIVE` claim", /`ACTIVE`\s*claim/],
  ["the project-law clause it derives from (第 12 条)", /第\s*12\s*条/],
  ["the task-ownership runbook pointer", /docs\/runbooks\/task-ownership\.md/],
];
const LOCAL_PAIRS = [
  ["apps/web/AGENTS.md", "apps/web/CLAUDE.md"],
  ["packages/otto/src/skills/AGENTS.md", "packages/otto/src/skills/CLAUDE.md"],
];
const AUTHORITY_SURFACES = [
  CANONICAL_LAW,
  ".claude/skills/fikirtive-orchestration-overlay/SKILL.md",
  "README.md",
  "docs/INDEX.md",
  "docs/runbooks/task-ownership.md",
  ...LOCAL_PAIRS.flat(),
];
const REFERENCE_SCAN_EXCLUSIONS = new Set([
  "scripts/check-project-authority.mjs",
  "scripts/__tests__/check-project-authority.test.mjs",
]);
const REFERENCE_SCAN_EXTENSIONS = new Set([
  ".css", ".html", ".js", ".json", ".md", ".mdx", ".mjs", ".sh", ".toml",
  ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);
export const RETIRED_PATHS = [
  ".claude/skills/fikirtive-ship/SKILL.md",
  "EXAM-REPORT.md",
  "TODOS.md",
  "docs/FIKIRTIVE-MASTER-2026-07-10.md",
  "docs/PRD.md",
  "docs/backlog.md",
  "docs/design-system/code-gaps.md",
  "docs/design-system/enforcement.md",
  "docs/design-system/polish-delta.md",
  "docs/ops/APRIME-MANIFEST-2026-07-11.md",
  "docs/ops/CREDENTIAL-INVENTORY-2026-07-11.md",
  "docs/ops/FOUNDER-SUPPLY-MANIFEST-2026-07-12.md",
  "docs/ops/MODEL-DOSSIER-2026-07.md",
  "docs/ops/ORCHESTRATOR-STATE.md",
  "docs/ops/MODEL-ROUTING-2026-07-11.md",
  "docs/ops/ROUTE-B-HANDOFF-README.md",
  "docs/ops/SESSION-HANDOFF-2026-07-10.md",
  "docs/ops/config-and-architecture.md",
  "docs/ops/staging.md",
  "docs/ops/route-b/DECISION-LOG.md",
  "docs/ops/route-b/DEPENDENCY-STATUS.md",
  "docs/ops/route-b/EVIDENCE-LEDGER.md",
  "docs/ops/route-b/RISKS-PENDING.md",
  "docs/ops/route-b/STANDING-DELEGATION.md",
  "docs/ops/route-b/coverage-audit",
  "docs/ops/route-b/execution",
  "docs/ops/route-b/reports",
  "docs/review/FULL-PRODUCT-REAUDIT-2026-07-11.md",
  "docs/review/ROUTE-B-EVIDENCE-2026-07-11",
  "docs/superpowers/plans/2026-06-29-fikirtive-ui-rework-roadmap.md",
  "docs/superpowers/specs/2026-06-28-SESSION-HANDOFF.md",
  "docs/superpowers/specs/2026-06-29-UI-REWORK-ENGINEER-HANDOFF.md",
  "docs/superpowers/specs/2026-07-08-staging-and-release-process-design.md",
  "docs/ui-rework-mockups",
  "scripts/__tests__/execution-harness-check.test.mjs",
  "scripts/execution-harness-check.mjs",
];
const RETIRED_SHORT_NAMES = [
  "2026-06-28-SESSION-HANDOFF.md",
  "2026-07-08-staging-and-release-process-design.md",
  "APRIME-MANIFEST-2026-07-11.md",
  "B0-REPORT.md",
  "B3-F-P-R4-REPAIR.md",
  "B3-REPORT.md",
  "B4-REPORT.md",
  "B8-DEPTH-REVIEW-PACK.md",
  "B9-PHASE1-REPORT.md",
  "CREDENTIAL-INVENTORY-2026-07-11.md",
  "DECISION-LOG.md",
  "DECISION-LOG",
  "DEPENDENCY-STATUS.md",
  "DEPENDENCY-STATUS",
  "EVIDENCE-LEDGER.md",
  "EVIDENCE-LEDGER",
  "EXAM-REPORT.md",
  "FIKIRTIVE-MASTER-2026-07-10.md",
  "FULL-PRODUCT-REAUDIT-2026-07-11.md",
  "FOUNDER-SUPPLY-MANIFEST-2026-07-12.md",
  "HANDOVER-2026-07-12.md",
  "MODEL-ROUTING-2026-07-11.md",
  "MODEL-DOSSIER-2026-07.md",
  "MATRIX-V0.md",
  "ORCHESTRATOR-STATE.md",
  "PRD.md",
  "RISKS-PENDING.md",
  "RISKS-PENDING",
  "ROUTE-B-HANDOFF-README.md",
  "ROUTE-B-EVIDENCE-2026-07-11",
  "SESSION-HANDOFF-2026-07-10.md",
  "STANDING-DELEGATION.md",
  "STANDING-DELEGATION",
  "TODOS.md",
  "backlog.md",
  "config-and-architecture.md",
  "code-gaps.md",
  "enforcement.md",
  "execution-harness-check.mjs",
  "fikirtive-ui-rework-roadmap.md",
  "polish-delta.md",
  "UI-REWORK-ENGINEER-HANDOFF.md",
  "ui-rework-mockups",
];
const RETIRED_REFERENCES = [
  ...RETIRED_PATHS,
  ...RETIRED_SHORT_NAMES,
  "coverage-audit/",
  "route-b/coverage-audit/",
  "docs/ops/route-b/execution/",
  "route-b/execution/",
  "route-b/reports/",
  "A′ 舱单",
  "A′舱单",
  "PR(本)",
  "ledger-sync",
  "五本账",
  "依赖状态板",
  "入证据账",
  "决策日志",
  "控制面收口 PR",
  "由总指挥",
  "证据台账",
  "风险账",
];

const LAW_FORBIDDEN_PATTERNS = [
  [/(?:^|[\s`'(])\/(?:Users|home|private|tmp|var\/folders)\//m, "absolute machine path"],
  [/[A-Za-z]:\\[^\s`]+/, "absolute machine path"],
  [/#\d+\b/, "specific GitHub #ID"],
  [/github\.com\/BELCORT-SDN-BHD\/FIKIRTIVE\/(?:issues|pull)\/\d+\b/, "specific GitHub artifact URL"],
  [/\b[a-f0-9]{7,40}\b/i, "specific Git SHA"],
  [/(?:CODEGRAPH_START|GBrain Configuration|\.codegraph\/|\.gbrain\/|\/setup-gbrain|\/sync-gbrain|gbrain\s+(?:query|search|code-)|codegraph\s+(?:explore|node))/i, "retired CodeGraph/GBrain configuration"],
  [/^##\s+(?:Current status|Current state|当前状态|现状)\b/im, "mutable current-state section"],
  [/^\s*(?:STATUS|current status|current state|当前状态|现状)\s*[:：=]/im, "mutable current-state marker"],
  [/(?:\b(?:active|current)\s+(?:ticket|issue|PR|branch|worktree|claim)|(?:当前|现行)(?:工单|票|PR|分支|worktree|claim))\s*[:：=]\s*\S+/i, "mutable current-state binding"],
  [/\b20\d{2}-\d{2}-\d{2}\b/, "dated current-state fact"],
  [/\brailway\s+up\b/i, "real deployment command"],
  [/\bprisma\s+migrate\s+deploy\b/i, "real deployment command"],
];
const CLAIM_OPTIONAL_PATTERNS = [
  /\boptional\s+(?:machine\s+)?(?:ownership\s+)?claim\b/i,
  /可选[^\n]{0,40}(?:ownership|claim)/i,
  /若[^\n]{0,40}harness[^\n]{0,40}(?:ownership|claim)/i,
  /any required live fencing claim/i,
];

export class AuthorityError extends Error {
  constructor(messages) {
    super(messages.join("\n"));
    this.messages = messages;
  }
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new AuthorityError([`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`]);
  }
  return result.stdout;
}

function trackedEntries(root, path) {
  return git(root, ["ls-files", "--stage", "-z", "--", path])
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d{6}) [a-f0-9]+ \d\t(.+)$/);
      return match ? { mode: match[1], path: match[2] } : { mode: "<invalid>", path: line };
    });
}

function trackedReferenceSurfaces(root) {
  return git(root, ["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .filter((path) => !REFERENCE_SCAN_EXCLUSIONS.has(path))
    .filter(
      (path) =>
        REFERENCE_SCAN_EXTENSIONS.has(extname(path).toLowerCase()) ||
        path === ".env.example" ||
        path === ".githooks/pre-push",
    );
}

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function requireTrackedMode(root, path, expected, errors) {
  const entries = trackedEntries(root, path).filter((entry) => entry.path === path);
  if (entries.length !== 1 || entries[0].mode !== expected) {
    errors.push(`${path} must be tracked exactly once with Git mode ${expected}`);
  }
}

function requireRegular(root, path, errors) {
  const absolute = join(root, path);
  try {
    const stats = lstatSync(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) errors.push(`${path} must be a real regular file`);
  } catch (error) {
    errors.push(`${path} is missing: ${error.message}`);
  }
  requireTrackedMode(root, path, "100644", errors);
}

function retiredPathHasPayload(path) {
  if (!existsSync(path)) return false;
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) return true;
  return readdirSync(path).some((name) => retiredPathHasPayload(join(path, name)));
}

export function checkProjectAuthority(root = process.cwd()) {
  const errors = [];
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim());
  } catch (error) {
    throw error instanceof AuthorityError ? error : new AuthorityError([error.message]);
  }

  const lawPath = join(canonicalRoot, CANONICAL_LAW);
  requireRegular(canonicalRoot, CANONICAL_LAW, errors);

  const adapterPath = join(canonicalRoot, ROOT_ADAPTER);
  try {
    const stats = lstatSync(adapterPath);
    if (!stats.isSymbolicLink()) errors.push(`${ROOT_ADAPTER} must be a symbolic link`);
    if (readlinkSync(adapterPath) !== CANONICAL_LAW) {
      errors.push(`${ROOT_ADAPTER} must point exactly to ${CANONICAL_LAW}`);
    }
    const resolved = realpathSync(adapterPath);
    const canonicalLaw = realpathSync(lawPath);
    if (!inside(canonicalRoot, resolved) || resolved !== canonicalLaw) {
      errors.push(`${ROOT_ADAPTER} must resolve to the canonical in-repository law`);
    }
  } catch (error) {
    errors.push(`${ROOT_ADAPTER} symlink is missing or broken: ${error.message}`);
  }
  requireTrackedMode(canonicalRoot, ROOT_ADAPTER, "120000", errors);

  let lawSource = "";
  try {
    lawSource = readFileSync(lawPath, "utf8");
    if (!lawSource.trim()) errors.push(`${CANONICAL_LAW} must be non-empty`);
    for (const [pattern, reason] of LAW_FORBIDDEN_PATTERNS) {
      if (pattern.test(lawSource)) errors.push(`${CANONICAL_LAW} contains forbidden ${reason}`);
    }
    if (!/every repository-mutating task must acquire one task-linked `ACTIVE` claim/.test(lawSource)) {
      errors.push(`${CANONICAL_LAW} must require a task-linked ACTIVE claim before repository mutation`);
    }
  } catch {
    // requireRegular already recorded the missing file.
  }

  for (const [agentsPath, claudePath] of LOCAL_PAIRS) {
    requireRegular(canonicalRoot, agentsPath, errors);
    requireRegular(canonicalRoot, claudePath, errors);
    try {
      const localLaw = readFileSync(join(canonicalRoot, agentsPath), "utf8");
      if (!localLaw.trim()) errors.push(`${agentsPath} must be non-empty`);
      if (localLaw === lawSource) errors.push(`${agentsPath} must not duplicate the canonical law`);
    } catch {
      // requireRegular already recorded the missing file.
    }
    try {
      if (readFileSync(join(canonicalRoot, claudePath), "utf8") !== "@AGENTS.md\n") {
        errors.push(`${claudePath} must be the exact one-line @AGENTS.md adapter`);
      }
    } catch {
      // requireRegular already recorded the missing file.
    }
  }

  for (const path of RETIRED_PATHS) {
    if (retiredPathHasPayload(join(canonicalRoot, path))) {
      errors.push(`retired authority path still exists: ${path}`);
    }
    if (trackedEntries(canonicalRoot, path).length > 0) {
      errors.push(`retired authority path is still tracked: ${path}`);
    }
  }

  for (const path of AUTHORITY_SURFACES) {
    const absolute = join(canonicalRoot, path);
    if (!existsSync(absolute)) {
      errors.push(`authority surface is missing: ${path}`);
      continue;
    }
    let source;
    try {
      source = readFileSync(absolute, "utf8");
    } catch (error) {
      errors.push(`authority surface cannot be read: ${path}: ${error.message}`);
      continue;
    }
  }

  const claimPolicyPaths = [
    CANONICAL_LAW,
    ".claude/skills/fikirtive-orchestration-overlay/SKILL.md",
    "docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md",
  ];
  for (const path of claimPolicyPaths) {
    const absolute = join(canonicalRoot, path);
    if (!existsSync(absolute)) {
      errors.push(`claim policy surface is missing: ${path}`);
      continue;
    }
    const source = readFileSync(absolute, "utf8");
    for (const pattern of CLAIM_OPTIONAL_PATTERNS) {
      if (pattern.test(source)) errors.push(`${path} makes task ownership optional`);
    }
  }
  try {
    const overlay = readFileSync(
      join(canonicalRoot, ".claude/skills/fikirtive-orchestration-overlay/SKILL.md"),
      "utf8",
    );
    if (!overlay.includes(OVERLAY_CLAIM_ANCHOR)) {
      errors.push(
        `orchestration overlay must keep the ${OVERLAY_CLAIM_ANCHOR} claim-policy anchor`,
      );
    } else {
      const section = overlay.slice(
        overlay.indexOf(OVERLAY_CLAIM_ANCHOR) + OVERLAY_CLAIM_ANCHOR.length,
      );
      for (const [label, pattern] of OVERLAY_CLAIM_SUBSTANCE) {
        if (!pattern.test(section)) {
          errors.push(`orchestration overlay claim-policy section is missing ${label}`);
        }
      }
    }
    const plan = readFileSync(
      join(canonicalRoot, "docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md"),
      "utf8",
    );
    if (!/所有 repo mutation 都按项目法/.test(plan)) {
      errors.push("Route-B plan must defer to the mandatory project task-ownership lifecycle");
    }
    const runbook = readFileSync(
      join(canonicalRoot, "docs/runbooks/task-ownership.md"),
      "utf8",
    );
    for (const command of [" init\n", " claim ", "check --claim-id", " close "]) {
      if (!runbook.includes(command)) errors.push(`task-ownership runbook is missing lifecycle command: ${command.trim()}`);
    }
  } catch (error) {
    errors.push(`task-ownership policy cannot be read: ${error.message}`);
  }

  for (const path of trackedReferenceSurfaces(canonicalRoot)) {
    const absolute = join(canonicalRoot, path);
    if (!existsSync(absolute)) continue;
    let source;
    try {
      source = readFileSync(absolute, "utf8");
    } catch (error) {
      errors.push(`tracked reference surface cannot be read: ${path}: ${error.message}`);
      continue;
    }
    for (const retired of RETIRED_REFERENCES) {
      if (source.includes(retired)) {
        errors.push(`tracked surface ${path} references retired authority: ${retired}`);
      }
    }
  }

  if (errors.length) throw new AuthorityError([...new Set(errors)].sort());
  return { root: canonicalRoot, canonicalLaw: CANONICAL_LAW, localPairs: LOCAL_PAIRS.length };
}

function main() {
  try {
    const result = checkProjectAuthority();
    console.log(
      `project-authority-check: PASS canonical=${result.canonicalLaw} local_pairs=${result.localPairs}`,
    );
  } catch (error) {
    const messages = error instanceof AuthorityError ? error.messages : [error.stack ?? error.message];
    console.error("project-authority-check: FAIL");
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
