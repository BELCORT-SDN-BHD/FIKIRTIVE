/**
 * ci-workflows.test.ts — 保护那个能冻结全仓的名字(#797)。
 *
 * `quality` 是 protect-main ruleset 里的必需检查,bypass_actors 为空:这个 check 名字一动,
 * 或者被另一个同名 job 抢走,全仓合并当场停摆。#797 加了第二个 workflow(main 合并后重跑同
 * 一道门),所以这里把两件事钉住:必需检查还在,而且全仓恰好一个。
 *
 * ── 为什么这里用真的 YAML 解析器(判官 r2 P2-1 的裁定)────────────────────────────────
 * r2 我用了一个手写的行分块器,想省下锁文件改动。判官实证它在五种形状下既不抛、又把 quality
 * 数成 0——行尾注释、更宽缩进、`jobs :`、值上的锚点、普通别名——而且我只统计了显式 `name`,
 * 漏了 GitHub「无 name 时回退 job id」的语义。裁定很干脆:**锁文件纯净换不来一个 fail-open
 * 的必需检查守卫**。裁定成立,这里改用 js-yaml。
 *
 * 选 js-yaml 而不是 yaml,是因为它不是 vitest 的可选 peer:锁文件改动是纯新增 11 行,
 * 不动任何既有的 vitest 解析串;而且 4.2.0 本来就在 store 里,连下载都不需要。
 *
 * 统计口径按 GitHub 的真实语义:check 名 = job 级 `name`,**没写 name 时回退成 job id**。
 * 两条命名路径都要数,否则把 ci.yml 的 `name: quality` 删掉就能悄悄绕过这道守卫。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = path.resolve(HERE, "../../../../.github/workflows");

type WorkflowJob = { name?: unknown; "runs-on"?: unknown; concurrency?: { group?: unknown } };
type Workflow = { jobs?: Record<string, WorkflowJob> };

/**
 * 一份 workflow 里每个 job 对外呈现的 check 名。
 * GitHub 的规则:有 job 级 `name` 就用它,没有就用 job id —— 两者都要进统计。
 */
function checkNames(text: string): { id: string; checkName: string; explicit: boolean }[] {
  const doc = load(text) as Workflow | undefined;
  const jobs = doc?.jobs;
  if (!jobs || typeof jobs !== "object") return [];
  return Object.entries(jobs).map(([id, job]) => {
    const name = job && typeof job === "object" ? job.name : undefined;
    const explicit = typeof name === "string" && name.trim() !== "";
    return { id, checkName: explicit ? String(name) : id, explicit };
  });
}

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(path.join(WORKFLOW_DIR, f), "utf8") }));

/** 全仓所有 workflow 里,对外呈现为 `quality` 的 job(不是文件,是 job)。 */
const qualityJobs = workflows.flatMap(({ file, text }) =>
  checkNames(text)
    .filter((j) => j.checkName === "quality")
    .map((j) => `${file}:${j.id}`),
);

describe("CI workflow shape (#797)", () => {
  it("the required `quality` check is declared exactly once, in ci.yml", () => {
    expect(qualityJobs).toEqual(["ci.yml:quality"]);
  });

  it("post-merge.yml exists and runs on pushes to main", () => {
    const post = workflows.find((w) => w.file === "post-merge.yml");
    expect(post, "post-merge.yml is the main-after-merge gate (#797 债#6)").toBeTruthy();
    expect(post!.text).toMatch(/on:\s*\n\s*push:\s*\n\s*branches:\s*\[main\]/);
  });

  it("post-merge.yml runs the same gate command the PR check runs", () => {
    const post = workflows.find((w) => w.file === "post-merge.yml")!;
    expect(post.text).toContain("pnpm quality");
  });

  it("post-merge.yml runs on a hosted runner — a self-hosted target would silently never run", () => {
    // 2026-08-11:自托管跑手的监听进程已停(注册保留,纯人工备援)。排在它上面的 job 不会红,
    // 会永远排队——「静默的不跑」比红更贵,而且看起来和「还没跑完」一模一样。
    const post = workflows.find((w) => w.file === "post-merge.yml")!;
    const doc = load(post.text) as Workflow;
    const jobs = Object.entries(doc.jobs ?? {});
    expect(jobs.length).toBeGreaterThan(0);
    for (const [id, job] of jobs) {
      const runsOn = JSON.stringify(job["runs-on"]);
      expect(runsOn, `${id} must run on a hosted runner`).toContain("ubuntu-latest");
      expect(runsOn, `${id} must not target the parked self-hosted runner`).not.toContain("self-hosted");
    }
  });

  /**
   * 判官 r1 P1-1:固定并发组 + cancel-in-progress,而 workflow_dispatch 可以在任意分支手动
   * 发起——于是任何人手动跑一次就能取消 main 上在飞的门,顶上来的还是另一个 SHA。
   * 组名必须同时带事件与 ref,取消才只可能发生在「同一 ref、同一触发」的过时运行上。
   */
  it("post-merge concurrency groups are scoped by event AND ref, so a manual run cannot cancel main's", () => {
    const post = workflows.find((w) => w.file === "post-merge.yml")!;
    const doc = load(post.text) as Workflow;
    const groups = Object.entries(doc.jobs ?? {})
      .map(([id, job]) => [id, job.concurrency?.group] as const)
      .filter((entry): entry is readonly [string, string] => typeof entry[1] === "string");

    expect(groups.length, "post-merge.yml should declare at least one concurrency group").toBeGreaterThan(0);
    for (const [id, group] of groups) {
      expect(group, `${id}: concurrency group must be scoped by event`).toContain("github.event_name");
      expect(group, `${id}: concurrency group must be scoped by ref`).toContain("github.ref");
    }
  });
});

/**
 * 统计口径自己也要被证明。前七条是 r2 就有的夹具;后面两组是判官 r2 打穿手写分块器的那五种
 * 写法、以及 r2 漏掉的 job-id 回退语义,逐条钉成常驻用例。
 */
describe("check-name counting (#797 r3 P2-1)", () => {
  const wf = (jobs: string) => `name: X\non:\n  push:\n    branches: [main]\n\njobs:\n${jobs}`;
  const qualityCount = (text: string) => checkNames(text).filter((j) => j.checkName === "quality").length;

  it("reads one job and its job-level name", () => {
    expect(checkNames(wf("  a:\n    name: quality\n    runs-on: ubuntu-latest\n"))).toEqual([
      { id: "a", checkName: "quality", explicit: true },
    ]);
  });

  it("two `quality` jobs in ONE file are counted as two", () => {
    expect(qualityCount(wf("  a:\n    name: quality\n  b:\n    name: quality\n"))).toBe(2);
  });

  it("a STEP named quality is not a job named quality", () => {
    expect(qualityCount(wf("  a:\n    name: other\n    steps:\n      - name: quality\n        run: echo hi\n"))).toBe(0);
  });

  it("quoted names are unquoted by the parser", () => {
    expect(qualityCount(wf('  a:\n    name: "quality"\n'))).toBe(1);
  });

  it("does not swallow the next top-level key", () => {
    const names = checkNames(`${wf("  a:\n    name: quality\n")}\npermissions:\n  contents: read\n`);
    expect(names.map((j) => j.id)).toEqual(["a"]);
  });

  it("a file with no jobs contributes nothing", () => {
    expect(checkNames("name: X\non:\n  push:\n")).toEqual([]);
  });

  it("parses this repository's real workflows and finds jobs in each", () => {
    for (const { file, text } of workflows) {
      expect(() => checkNames(text), `${file} should parse`).not.toThrow();
      expect(checkNames(text).length, `${file} should declare at least one job`).toBeGreaterThan(0);
    }
  });

  /** 判官 r2 实证:手写分块器在这五种形状下不抛,且把 quality 数成 0。 */
  describe("the five shapes that walked straight through the hand-rolled scanner", () => {
    it("① a trailing comment after the name", () => {
      expect(qualityCount(wf("  a:\n    name: quality # the required check\n"))).toBe(1);
    });

    it("② wider indentation", () => {
      expect(qualityCount("name: X\non:\n  push:\n\njobs:\n    a:\n        name: quality\n")).toBe(1);
    });

    it("③ a space before the colon: `jobs :`", () => {
      expect(qualityCount("name: X\non:\n  push:\n\njobs :\n  a:\n    name: quality\n")).toBe(1);
    });

    it("④ an anchor on the value: `name: &required quality`", () => {
      expect(qualityCount(wf("  a:\n    name: &required quality\n"))).toBe(1);
    });

    it("⑤ an alias that resolves to quality", () => {
      expect(qualityCount(wf("  a:\n    name: &required quality\n  b:\n    name: *required\n"))).toBe(2);
    });
  });

  /** 判官 r2:GitHub 在没有 job 级 name 时用 job id 当 check 名,r2 的统计漏了这条路径。 */
  describe("the job-id fallback GitHub actually applies", () => {
    it("a job with id `quality` and no name still presents as the `quality` check", () => {
      expect(checkNames(wf("  quality:\n    runs-on: ubuntu-latest\n"))).toEqual([
        { id: "quality", checkName: "quality", explicit: false },
      ]);
    });

    it("an explicit name overrides the id, in both directions", () => {
      expect(qualityCount(wf("  quality:\n    name: something-else\n"))).toBe(0);
      expect(qualityCount(wf("  something-else:\n    name: quality\n"))).toBe(1);
    });

    it("an empty name falls back to the id rather than counting as a blank check", () => {
      expect(qualityCount(wf('  quality:\n    name: ""\n'))).toBe(1);
    });

    it("ci.yml is counted once, not twice, even though its id AND name are both `quality`", () => {
      const ci = workflows.find((w) => w.file === "ci.yml")!;
      expect(checkNames(ci.text).filter((j) => j.checkName === "quality")).toHaveLength(1);
    });
  });
});
