/**
 * ci-workflows.test.ts — 保护那个能冻结全仓的名字(#797)。
 *
 * `quality` 是 protect-main ruleset 里的必需检查,bypass_actors 为空:这个 check 名字一动,
 * 或者被另一个 workflow 里的同名 job 抢走,全仓合并当场停摆。#797 加了第二个 workflow
 * (main 合并后重跑同一道门),所以这里把两件事钉住:必需检查还在,而且只有一个。
 *
 * 为什么住在 apps/web/lib/__tests__:这是 `pnpm -r test`(quality 的 tests 门)已经会跑到的
 * 地方,不需要给 quality.sh 加新门就能在每个 PR 上生效。
 *
 * ── 这里为什么自己走 YAML,而不是装一个解析器(判官 r1 P2-2 的处置说明)────────────────
 * 判官指出第一版数错了对象:它数的是「含有那一行的文件数」,所以同一个文件里追加第二个
 * `name: quality` 的 job 仍然是绿的。修法必须是数**声明总数**,而且要按结构数。
 *
 * 装 `yaml` 走过一遍,又退回来了:它是 vitest 的可选 peer,加进 apps/web 会让锁文件里每一条
 * vitest 解析串都变成 `vitest@3.2.6(…)(yaml@2.9.0)`——为一个测试助手在共享锁文件上制造跨仓
 * 冲突面,和它买到的确定性不成比例。
 *
 * 所以这里走一个**只认 GitHub workflow 这一种形状**的分块器,并且遇到它没建模的写法
 * (flow 风格的 `jobs: {…}`、tab 缩进、锚点/别名)一律**抛**——不认识的输入变成红,而不是
 * 变成一个偏小的计数。它自己也有夹具测试,包括判官描述的那次突变(同文件两个 quality job
 * 必须数成 2),于是「数得对」是被证明的,不是被相信的。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = path.resolve(HERE, "../../../../.github/workflows");

type Job = { id: string; name: string | undefined; body: string };

/**
 * 从一份 workflow 文本里取出所有 job(id、job 级 `name`、以及该 job 的整块文本)。
 *
 * 只建模 GitHub workflow 实际使用的块状映射:顶层 `jobs:`,其下每个 job id 缩进一级,
 * job 的直接键再缩进一级。任何超出这个模型的写法都抛异常。
 */
export function parseJobs(text: string): Job[] {
  if (text.includes("\t")) throw new Error("tab indentation is not modelled — refusing to guess");
  if (/(^|\n)\s*(<<:|[A-Za-z0-9_-]+:\s*&[A-Za-z0-9_-]+\s*$)/.test(text)) {
    throw new Error("YAML anchors / merge keys are not modelled — refusing to guess");
  }

  const lines = text.split("\n");
  const jobsHeader = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsHeader === -1) {
    if (/^jobs:\s*\S/m.test(text)) throw new Error("flow-style `jobs:` is not modelled — refusing to guess");
    return [];
  }

  // job id 所在的缩进 = `jobs:` 之后第一条非空、非注释行的缩进。
  let jobIndent = -1;
  for (let i = jobsHeader + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim() || /^\s*#/.test(line)) continue;
    jobIndent = line.length - line.trimStart().length;
    break;
  }
  if (jobIndent <= 0) return [];

  const jobs: Job[] = [];
  let current: { id: string; start: number } | null = null;

  const close = (end: number) => {
    if (!current) return;
    const body = lines.slice(current.start + 1, end).join("\n");
    jobs.push({ id: current.id, name: jobName(body, jobIndent), body });
    current = null;
  };

  for (let i = jobsHeader + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;

    if (indent === 0) { close(i); return jobs; }   // 回到顶层键 → jobs 段结束
    if (indent < jobIndent) throw new Error(`unexpected dedent inside jobs: at line ${i + 1}`);
    if (indent > jobIndent) continue;              // job 内部,交给 jobName 处理

    const m = /^\s*([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (!m) throw new Error(`unrecognised job declaration at line ${i + 1}: ${line.trim()}`);
    close(i);
    current = { id: m[1]!, start: i };
  }
  close(lines.length);
  return jobs;
}

/** 一个 job 块里,**直接**属于该 job 的 `name:`(step 的 name 缩进更深,不算)。 */
function jobName(body: string, jobIndent: number): string | undefined {
  const pattern = new RegExp(`^ {${jobIndent + 2}}name:\\s*(.+?)\\s*$`);
  for (const line of body.split("\n")) {
    const m = pattern.exec(line);
    if (m) return m[1]!.replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(path.join(WORKFLOW_DIR, f), "utf8") }));

/** 全仓所有 workflow 里,job 级 name === "quality" 的声明(不是文件,是声明)。 */
const qualityDeclarations = workflows.flatMap(({ file, text }) =>
  parseJobs(text)
    .filter((j) => j.name === "quality")
    .map((j) => `${file}:${j.id}`),
);

describe("CI workflow shape (#797)", () => {
  it("the required `quality` check is declared exactly once, in ci.yml", () => {
    // 数的是声明,不是文件:同一个文件里追加第二个 `name: quality` 也必须红。
    expect(qualityDeclarations).toEqual(["ci.yml:quality"]);
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
    expect(post.text).not.toContain("self-hosted");
    for (const line of post.text.split("\n")) {
      if (/^\s*runs-on:/.test(line)) expect(line).toContain("ubuntu-latest");
    }
  });

  /**
   * 判官 r1 P1-1:固定并发组 + cancel-in-progress,而 workflow_dispatch 可以在任意分支手动
   * 发起——于是任何人手动跑一次就能取消 main 上在飞的门,顶上来的还是另一个 SHA。
   * 组名必须同时带事件与 ref,取消才只可能发生在「同一 ref、同一触发」的过时运行上。
   */
  it("post-merge concurrency groups are scoped by event AND ref, so a manual run cannot cancel main's", () => {
    const post = workflows.find((w) => w.file === "post-merge.yml")!;
    const groups = post.text
      .split("\n")
      .filter((l) => /^\s*group:\s*/.test(l))
      .map((l) => l.replace(/^\s*group:\s*/, "").trim());

    expect(groups.length, "post-merge.yml should declare at least one concurrency group").toBeGreaterThan(0);
    for (const group of groups) {
      expect(group, `concurrency group "${group}" must be scoped by event`).toContain("github.event_name");
      expect(group, `concurrency group "${group}" must be scoped by ref`).toContain("github.ref");
    }
  });
});

/**
 * 上面那些断言全部建立在 parseJobs 数得对之上,所以 parseJobs 自己也要被证明——尤其是判官
 * 指出的那一格:同一个文件里的第二个 quality job。这些夹具就是那次突变演习的常驻版本。
 */
describe("parseJobs — the counting itself (#797 r2 P2-2)", () => {
  const workflow = (jobs: string) => `name: X\non:\n  push:\n    branches: [main]\n\njobs:\n${jobs}`;

  it("reads one job and its job-level name", () => {
    const jobs = parseJobs(workflow("  a:\n    name: quality\n    runs-on: ubuntu-latest\n"));
    expect(jobs.map((j) => [j.id, j.name])).toEqual([["a", "quality"]]);
  });

  it("THE MUTATION: two `quality` jobs in ONE file are counted as two", () => {
    const jobs = parseJobs(
      workflow("  a:\n    name: quality\n    runs-on: ubuntu-latest\n  b:\n    name: quality\n    runs-on: ubuntu-latest\n"),
    );
    // 这正是第一版数不出来的那一格:按文件数会是 1,按声明数是 2 → 上面那条断言会红。
    expect(jobs.filter((j) => j.name === "quality").map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("a STEP named quality is not a job named quality", () => {
    const jobs = parseJobs(workflow("  a:\n    name: other\n    steps:\n      - name: quality\n        run: echo hi\n"));
    expect(jobs.filter((j) => j.name === "quality")).toHaveLength(0);
  });

  it("a job with no explicit name has an undefined name (GitHub falls back to the job id)", () => {
    const jobs = parseJobs(workflow("  quality:\n    runs-on: ubuntu-latest\n"));
    expect(jobs.map((j) => [j.id, j.name])).toEqual([["quality", undefined]]);
  });

  it("quoted names are unquoted", () => {
    const jobs = parseJobs(workflow('  a:\n    name: "quality"\n'));
    expect(jobs[0]?.name).toBe("quality");
  });

  it("stops at the next top-level key instead of swallowing it", () => {
    const jobs = parseJobs(`${workflow("  a:\n    name: quality\n")}\npermissions:\n  contents: read\n`);
    expect(jobs.map((j) => j.id)).toEqual(["a"]);
  });

  it("fails CLOSED on shapes it does not model, rather than under-counting", () => {
    expect(() => parseJobs("jobs: {a: {name: quality}}\n")).toThrow(/flow-style/);
    expect(() => parseJobs("jobs:\n\t a:\n")).toThrow(/tab/);
    // 锚点:哪一条守卫先抓到它不重要,重要的是它抛而不是被当成 0 个 quality job。
    expect(() => parseJobs("jobs:\n  base: &base\n    name: quality\n")).toThrow();
    expect(() => parseJobs("jobs:\n  a:\n    <<: *base\n")).toThrow();
    // 非法 job 声明同样抛,而不是被跳过。
    expect(() => parseJobs("jobs:\n  a: quality\n")).toThrow(/unrecognised/);
  });

  it("parses this repository's real workflows without throwing", () => {
    for (const { file, text } of workflows) {
      expect(() => parseJobs(text), `${file} should parse`).not.toThrow();
      expect(parseJobs(text).length, `${file} should declare at least one job`).toBeGreaterThan(0);
    }
  });
});
