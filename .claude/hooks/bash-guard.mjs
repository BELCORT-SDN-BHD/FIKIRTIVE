// Decision half of Lock 2 (pretooluse-bash-guard.sh). Reads the PreToolUse payload on
// stdin; exit 2 = block with a reason on stderr, exit 0 = allow.
//
// Why a program and not a grep: the first version matched keywords against the whole
// command string, so `git push -u origin claude/x && gh pr create --base main` was
// blocked as a "direct push to main", and so was `git push origin x; git log
// origin/main..HEAD`. A guard that fires on the normal push→open-PR flow gets turned
// off, and then it guards nothing. Here the command is split into clauses, and each
// clause is read as argv — the destination of a push comes from its refspec, not from
// the word "main" appearing somewhere on the line.
//
// Everything fails open: unknown payload shape, unresolvable repository, missing tier
// evidence → allow. GitHub rulesets and .githooks/pre-push are the real gate for
// pushes; this one stops the command earlier, and covers the shell write forms that no
// PreToolUse Edit matcher can see (heredoc redirect, tee, sed -i).

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const BLUEPRINT_FILES = ["docs/BLUEPRINT.md", "scripts/blueprint.sha256"];

function readStdin() {
  return new Promise((done) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => done(raw));
    process.stdin.on("error", () => done(""));
  });
}

function block(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

// Operator split, not a shell parser. Over-splitting is harmless (each fragment is
// matched on its own); under-splitting is what produced the false blocks.
export function clausesOf(command) {
  return command.split(/\n|;|&&|\|\||\||&/).map((part) => part.trim()).filter(Boolean);
}

export function argvOf(clause) {
  const tokens = clause.replace(/^[({!]\s*/, "").match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  return (tokens ?? []).map((token) => token.replace(/["']/g, ""));
}

// A worker's transcript is a file directly inside <session>/subagents/ (observed:
// .../<session-uuid>/subagents/agent-<id>.jsonl). Anchored, so a config directory that
// merely contains the word — CLAUDE_CONFIG_DIR=/tmp/subagents/… — cannot hand a
// top-level session a worker's permissions. Generous in the worker's favour: either a
// leaf of subagents/, or the agent- filename prefix.
export function isWorkerTranscript(path) {
  const marker = path.lastIndexOf("/subagents/");
  if (marker === -1) return false;
  const leaf = path.slice(marker + "/subagents/".length);
  return !leaf.includes("/") || (leaf.split("/").pop() ?? "").startsWith("agent-");
}

// ONE notion of "which token names the program", shared by every matcher below. Three
// different notions is what the second review found: the push matcher scanned the whole
// argv, the gh matcher demanded argv[0] === "gh", and the write matcher took basename of
// argv[0] — so a single prefix walked straight through the strongest lock in the set
// (`env FOO=1 gh pr merge`, `./gh pr merge`, `command gh pr merge`, `env FOO=1 tee
// docs/BLUEPRINT.md` were all ALLOW). The merge lock has no server-side backstop: the
// protect-main ruleset requires 0 approving reviews and declares no required status
// checks, so nothing else stops `gh pr merge`.
//
// Returns the index of every token that could be naming `name`, most-likely first.
// Deliberately generous: leading VAR=value assignments and wrapper programs are skipped
// first, then the rest of argv is scanned too, because a wrapper this list has not heard
// of (`nice -n 5 git push`) must not become a hole. Over-matching costs at most a false
// block on a command that merely mentions the word — and every caller still requires a
// real subcommand or a token that resolves to a real file in this repository.
const WRAPPERS = new Set([
  "env", "command", "builtin", "exec", "nohup", "time", "sudo", "doas",
  "stdbuf", "setsid", "nice", "ionice", "xargs", "timeout", "script",
]);

export function basenameOf(token) {
  return (token ?? "").split("/").pop() ?? "";
}

// The strict answer: the index of the token that actually names the program, after the
// leading VAR=value assignments and wrapper programs are skipped. -1 when argv is all
// prefix. Used where "is this clause a gh command" must NOT be satisfied by the word
// appearing as an argument (`git push origin main gh` is a push, not a gh call).
export function headIndexOf(argv) {
  let head = 0;
  while (head < argv.length) {
    const token = argv[head];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) { head += 1; continue; }
    if (WRAPPERS.has(basenameOf(token))) {
      head += 1;
      while (
        head < argv.length &&
        (argv[head].startsWith("-") ||
          /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[head]) ||
          /^\d+(?:\.\d+)?[smhd]?$/.test(argv[head]))
      ) {
        head += 1;
      }
      continue;
    }
    return head;
  }
  return -1;
}

export function commandIndexes(argv, name) {
  const found = [];
  const head = headIndexOf(argv);
  if (head !== -1 && basenameOf(argv[head]) === name) found.push(head);
  for (let scan = 0; scan < argv.length; scan += 1) {
    if (scan !== head && basenameOf(argv[scan]) === name) found.push(scan);
  }
  return found;
}

// Only forms that write a named file: `> f` / `>> f` (a heredoc's `cat > f <<EOF`
// carries the redirect), `tee f`, `sed -i … f`.
export function writeTargets(clause) {
  const targets = [];
  for (const match of clause.matchAll(/>>?\s*("[^"]*"|'[^']*'|[^\s;&|<>]+)/g)) {
    targets.push(match[1].replace(/["']/g, ""));
  }
  const argv = argvOf(clause);
  for (const at of commandIndexes(argv, "tee")) {
    targets.push(...argv.slice(at + 1).filter((arg) => !arg.startsWith("-")));
  }
  for (const at of commandIndexes(argv, "sed")) {
    const rest = argv.slice(at + 1);
    if (!rest.some((arg) => arg === "-i" || arg === "--in-place" || /^-[a-zA-Z]*i/.test(arg))) continue;
    // Every operand is a candidate; repoWrite() below rejects the sed script itself
    // because `s/a/b/` has no existing parent directory.
    targets.push(...rest.filter((arg) => !arg.startsWith("-")));
  }
  return targets.filter((target) => target && !target.startsWith("&"));
}

function gitIn(dir, args) {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function commonDir(dir) {
  if (!dir || !existsSync(dir)) return null;
  return gitIn(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
}

// Resolves to a repository-relative path only when the token really names a file in
// this repository. Requiring the parent directory to exist is what keeps a sed script
// (`s/a/b/`) from being read as a relative path.
export function repoWrite(token, { cwd, repoTop }) {
  if (!repoTop) return null;
  if (/^[~$]/.test(token)) return null;
  const absolute = isAbsolute(token) ? token : resolve(cwd, token);
  const rel = relative(repoTop, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (!existsSync(absolute)) {
    const parent = dirname(absolute);
    if (!existsSync(parent) || !statSync(parent).isDirectory()) return null;
  }
  return rel;
}

export function ghVerdict(argv) {
  const at = commandIndexes(argv, "gh")[0];
  if (at === undefined) return null;
  const rest = argv.slice(at + 1);
  if (rest[0] === "pr" && rest[1] === "merge") {
    return "合并权属 Founder 或其明确指派的非作者执行者,session 不得执行;--auto 更是项目法禁令(第 2 条)。";
  }
  if (rest[0] !== "api") return null;
  const flagIndex = rest.findIndex((arg) => arg === "--method" || arg === "-X");
  const method =
    flagIndex !== -1 ? rest[flagIndex + 1] : rest.map((arg) => /^--method=(.+)$/.exec(arg)?.[1]).find(Boolean);
  const mergesPullRequest = rest.some((arg) => /\/pulls\/\d+\/merge\/?$/.test(arg) || /\/merges\/?$/.test(arg));
  if (mergesPullRequest && (!method || /^(put|post)$/i.test(method))) {
    return "gh api 合并 PR 与 gh pr merge 同罪(第 2 条):合并权属 Founder 或其明确指派的非作者执行者。";
  }
  return null;
}

// Returns { args, dir } when this clause really is a `git push`, else null. `dir` is the
// `-C <path>` git ran in, because that — not the session's cwd — is the checkout whose
// current branch a bare `git push` inherits. Reading the branch from cwd let
// `git -C <main checkout> push` be judged against the WRONG branch.
export function pushArgsOf(argv) {
  const gitAt = commandIndexes(argv, "git")[0];
  if (gitAt === undefined) return null;
  const after = argv.slice(gitAt + 1);
  let index = 0;
  let dir = null;
  while (index < after.length && after[index].startsWith("-")) {
    if (after[index] === "-C") dir = after[index + 1] ?? null;
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(after[index])) index += 1;
    index += 1;
  }
  return after[index] === "push" ? { args: after.slice(index + 1), dir } : null;
}

export function pushVerdict(pushArgs, currentBranch) {
  const forceFlag = pushArgs.some(
    (arg) =>
      arg === "--force" ||
      arg === "--force-with-lease" ||
      arg === "--force-if-includes" ||
      arg.startsWith("--force-with-lease=") ||
      arg.startsWith("--force-if-includes=") ||
      /^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg),
  );
  const positional = pushArgs.filter((arg) => !arg.startsWith("-"));
  const refspecs = positional.slice(1);
  if (forceFlag || refspecs.some((spec) => spec.startsWith("+"))) {
    return "force push 被拒:会重写他人已拉取的历史(+refspec 同样是 force)。要改已推提交,追加一个新 commit 或先与 Founder 确认。";
  }
  const isMain = (ref) => ref.replace(/^\+/, "").replace(/^refs\/heads\//, "") === "main";
  // An explicit refspec names its own destination; `git push`, `git push origin` and
  // `git push origin HEAD` inherit it from the checked-out branch — which is exactly
  // how a session sitting on main pushes to main without ever typing the word.
  const explicit = refspecs
    .filter((spec) => spec !== "HEAD")
    .map((spec) => (spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec))
    .filter(Boolean);
  const inherits = refspecs.length === 0 || refspecs.some((spec) => spec === "HEAD");
  const destinations = inherits && currentBranch ? [...explicit, currentBranch] : explicit;
  if (destinations.some(isMain)) {
    return "直推 main 被项目法禁止(第 1 条)。请推到任务分支再开 PR。GitHub 侧 ruleset 与 .githooks/pre-push 同样会拒,此处只是提前止损。";
  }
  return null;
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    process.exit(0);
  }
  const input = payload.tool_input ?? payload.toolInput ?? {};
  const command = typeof input.command === "string" ? input.command : "";
  if (!command.trim()) process.exit(0);
  const transcript = payload.transcript_path ?? payload.transcriptPath ?? "";
  const cwd = payload.cwd ?? payload.workingDirectory ?? process.env.CLAUDE_PROJECT_DIR ?? "";

  const projectCommon = commonDir(process.env.CLAUDE_PROJECT_DIR ?? "");
  const cwdCommon = commonDir(cwd);
  const inProjectRepo = Boolean(projectCommon && cwdCommon && projectCommon === cwdCommon);
  const repoTop = inProjectRepo ? gitIn(cwd, ["rev-parse", "--show-toplevel"]) : null;
  // No transcript field = no tier evidence = never the orchestrator. Same fail-open
  // rule as the write guard: absent evidence must not block anyone.
  const orchestrator = Boolean(transcript) && !isWorkerTranscript(transcript);

  for (const clause of clausesOf(command)) {
    const argv = argvOf(clause);
    if (argv.length === 0) continue;

    if (process.env.FIKIRTIVE_BLUEPRINT_AMEND !== "1") {
      if (/update-blueprint-hash/.test(clause)) {
        block("Blueprint 哈希只在 Founder 的修宪流程里更新(第 8 条)。修宪时由 Founder 用 FIKIRTIVE_BLUEPRINT_AMEND=1 启动 Claude Code。");
      }
      for (const token of writeTargets(clause)) {
        const rel = repoWrite(token, { cwd, repoTop });
        if (rel && BLUEPRINT_FILES.includes(rel)) {
          block(`shell 写入 ${rel} 被拒(第 8 条):Blueprint 与其哈希只在 Founder 的修宪流程里改。settings.json 的 deny 规则只管 Edit/Write 工具,管不到 shell,所以这里拦。`);
        }
      }
    }

    if (orchestrator && process.env.FIKIRTIVE_ORCH_WRITE_OK !== "1") {
      for (const token of writeTargets(clause)) {
        const rel = repoWrite(token, { cwd, repoTop });
        if (rel) {
          block(
            `编排者无写权(第 13 条):这条命令会写仓库内的 ${rel}。判断留编排者,写码派 worker。\n` +
              "仓库外路径(记忆、scratchpad、临时目录)不受限。紧急放行须在启动进程时给环境,Bash 里 export 无效:FIKIRTIVE_ORCH_WRITE_OK=1 claude",
          );
        }
      }
    }

    const gh = ghVerdict(argv);
    if (gh) block(gh);
    // Skip the push matcher only when gh is what this clause actually RUNS. Skipping on
    // the word appearing anywhere would hand back a hole: `git push origin main gh` is a
    // push whose refspec list contains a branch called gh.
    const head = headIndexOf(argv);
    if (head !== -1 && basenameOf(argv[head]) === "gh") continue;

    const push = pushArgsOf(argv);
    if (!push) continue;
    // `-C <path>` wins over cwd: that is the checkout whose HEAD a bare `git push`
    // would follow. Outside this repository we have no tier or branch facts → allow.
    const branchDir = push.dir ? resolve(cwd || process.cwd(), push.dir) : cwd;
    const branchInRepo = push.dir
      ? Boolean(projectCommon && commonDir(branchDir) === projectCommon)
      : inProjectRepo;
    const branch = branchInRepo ? gitIn(branchDir, ["rev-parse", "--abbrev-ref", "HEAD"]) : null;
    const verdict = pushVerdict(push.args, branch);
    if (verdict) block(verdict);
  }

  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("bash-guard.mjs")) {
  main().catch(() => process.exit(0));
}
