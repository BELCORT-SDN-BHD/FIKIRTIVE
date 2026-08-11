/**
 * ci-workflows.test.ts — 保护那个能冻结全仓的名字(#797)。
 *
 * `quality` 是 protect-main ruleset 里的必需检查,bypass_actors 为空:这个 check 名字一动,
 * 或者被另一个 workflow 里的同名 job 抢走,全仓合并当场停摆。#797 加了第二个 workflow
 * (main 合并后重跑同一道门),所以这里把两件事钉住:必需检查还在,而且只有一个。
 *
 * 为什么住在 apps/web/lib/__tests__:这是 `pnpm -r test`(quality 的 tests 门)已经会跑到的
 * 地方,不需要给 quality.sh 加新门就能在每个 PR 上生效。断言只看行,不解析 YAML,所以不引入
 * 任何依赖。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = path.resolve(HERE, "../../../../.github/workflows");

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(path.join(WORKFLOW_DIR, f), "utf8") }));

/** 声明了 job 名恰好是 `quality` 的 workflow 文件。 */
const declaresQuality = workflows.filter((w) => w.text.split("\n").some((line) => /^\s*name:\s*quality\s*$/.test(line)));

describe("CI workflow shape (#797)", () => {
  it("the required `quality` check is declared exactly once, in ci.yml", () => {
    expect(declaresQuality.map((w) => w.file)).toEqual(["ci.yml"]);
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

  it("post-merge.yml never passes a workflow input straight into a shell line", () => {
    const post = workflows.find((w) => w.file === "post-merge.yml")!;
    // ${{ inputs.* }} 只允许出现在 env: 映射里,不允许出现在 run: 的命令文本中。
    for (const line of post.text.split("\n")) {
      if (!line.includes("${{ inputs.")) continue;
      expect(line, `input interpolated outside an env: mapping — ${line.trim()}`).toMatch(/^\s+[A-Z_]+:\s*\$\{\{ inputs\./);
    }
  });
});
