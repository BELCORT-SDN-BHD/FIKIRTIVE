// Decision half of Lock 1 (pretooluse-write-guard.sh). Reads the PreToolUse payload on
// stdin; exit 2 = block with a reason on stderr, exit 0 = allow.
//
// Why a program and not the shell: the first version piped BOTH payload fields through
// one stdout stream separated by a newline and read them back by line position
// (`sed -n '1p'` / `'2p'`). `tool_input.file_path` is a model-authored field, so a
// newline INSIDE that value shifted every later field, and the lock failed in both
// directions at once:
//   * a worker writing to a path containing "\n" was BLOCKED — line 2 read back as a
//     fragment of the file name, never reached the subagents branch, and a blocked
//     worker is a project-wide outage;
//   * a top-level session could write file_path = ".../gen.ts\n/s/subagents/agent-1.jsonl"
//     and be read as a worker — exit 0, the write lock simply gone.
// A trailing sentinel only fixed the trailing-newline half. Here the values never leave
// this process, so there is no line position to shift.
//
// Fail-open by construction: unreadable payload, unknown JSON shape, non-string fields,
// absent transcript, or any repository-resolution failure exits 0. A governance hook must
// never be the reason a session cannot work. The payload field names
// (tool_input.file_path, transcript_path) move between harness versions — run
// .claude/hooks/probe-payload.sh once per upgrade and re-check them.

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

// A worker's transcript is a file directly inside <session>/subagents/ (observed:
// .../<session-uuid>/subagents/agent-<id>.jsonl). Anchored, so a config directory that
// merely contains the word — CLAUDE_CONFIG_DIR=/tmp/subagents/… — cannot hand a
// top-level session a worker's permissions. Generous in the worker's favour: either a
// leaf of subagents/, or the agent- filename prefix. Kept byte-identical in behaviour to
// bash-guard.mjs isWorkerTranscript(); the shapes test asserts the two agree.
export function isWorkerTranscript(path) {
  const marker = path.lastIndexOf("/subagents/");
  if (marker === -1) return false;
  const leaf = path.slice(marker + "/subagents/".length);
  return !leaf.includes("/") || (leaf.split("/").pop() ?? "").startsWith("agent-");
}

// The four field names the edit tools use for their target, in the two casings the
// harness has shipped. A non-string value is not a path we can reason about → "".
export function targetOf(input) {
  for (const key of ["file_path", "filePath", "notebook_path", "notebookPath"]) {
    const value = input?.[key];
    if (typeof value === "string" && value !== "") return value;
    if (value !== undefined && typeof value !== "string") return "";
  }
  return "";
}

// The write may create a file, and several directory levels with it. Walk up to the
// nearest ancestor that exists — that is the deepest point Git can still be asked about.
export function nearestExistingDir(filePath) {
  let dir = filePath.includes("/") ? dirname(filePath) : ".";
  if (dir === "") dir = "/";
  const seen = new Set();
  while (!existsSync(dir) || !statSync(dir).isDirectory()) {
    if (seen.has(dir)) return null;
    seen.add(dir);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return dir;
}

// Fully resolved Git common directory, or null. Resolving symlinks matters on macOS,
// where /tmp is a link to /private/tmp: two spellings of the same repository must
// compare equal, or the fence silently stops applying to one of them.
export function commonDir(dir) {
  if (!dir || !existsSync(dir)) return null;
  const result = spawnSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const out = result.stdout.trim();
  if (!out) return null;
  try {
    return realpathSync(out);
  } catch {
    return out;
  }
}

export const BLOCK_MESSAGE = `编排者无写权——判断留编排者,写码派 worker(Founder 令)。
本次被拦的是仓库内文件写入;仓库外(记忆、scratchpad)不受限。
紧急放行只能在启动 Claude Code 时给进程环境,Bash 工具里 export 无效
(hook 继承的是 CLI 进程的环境,不是某次 Bash 调用的):
  FIKIRTIVE_ORCH_WRITE_OK=1 claude   # 只解写锁
  FIKIRTIVE_HOOKS_OFF=1 claude       # 停用全部 hook`;

// null = allow, string = block with this reason.
export function verdict({ filePath, transcript, projectDir, resolveCommonDir = commonDir }) {
  if (typeof filePath !== "string" || filePath === "") return null;
  // No transcript field = no tier evidence = allow. This line is the difference between
  // a tripwire and an outage: the tier test below reads whoever is NOT a worker as the
  // orchestrator, so a renamed payload field would otherwise block every worker in the
  // project at once. Blocking on absent evidence is the one failure this hook must not
  // have (see README, "fail-open 是刻意的").
  if (typeof transcript !== "string" || transcript === "") return null;
  // Workers must be able to write — this branch is the whole point of the design, so it
  // comes first and stays generous.
  if (isWorkerTranscript(transcript)) return null;

  const dir = nearestExistingDir(resolve(projectDir || process.cwd(), filePath));
  if (!dir) return null;
  const targetRepo = resolveCommonDir(dir);
  if (!targetRepo) return null;
  const projectRepo = resolveCommonDir(projectDir || process.cwd());
  if (!projectRepo) return null;
  // Same Git common directory = this repository, main checkout or any linked worktree
  // under .claude/worktrees/. Anything else (memory files, scratchpads, another
  // repository) is outside the fence and stays writable.
  if (targetRepo !== projectRepo) return null;
  return BLOCK_MESSAGE;
}

function readStdin() {
  return new Promise((done) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => done(raw));
    process.stdin.on("error", () => done(""));
  });
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    process.exit(0);
  }
  if (!payload || typeof payload !== "object") process.exit(0);
  const input = payload.tool_input ?? payload.toolInput ?? {};
  const transcript = payload.transcript_path ?? payload.transcriptPath ?? "";
  const reason = verdict({
    filePath: targetOf(input),
    transcript: typeof transcript === "string" ? transcript : "",
    projectDir: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  });
  if (!reason) process.exit(0);
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

if (process.argv[1] && process.argv[1].endsWith("write-guard.mjs")) {
  main().catch(() => process.exit(0));
}
