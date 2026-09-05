/**
 * ENGINE-A1 的行为测试：跑一次、逐题有分、总分入档；evals:check 回归即非零退出。
 *
 * 判分器与被测对象都是 **mock**（`runEvals` 的两个参数就是为此注入的），所以这份测试
 * 一分钱不花、不碰网络、不需要钥匙。真调用那一半在 `runner.ts`，它的纯部分
 * （判词解析、题目装载、预算闸）在这里单独钉。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  FULL_RUN_BUDGET_USD,
  SEGMENT_BUDGET_USD,
  budgetGate,
  compareToBaseline,
  estimateTokens,
  parseTask,
  scoreTask,
  type EvalTask,
  type JudgeVerdict,
} from "./core.js";
import { runEvals } from "./run.js";
import { runCheck } from "./checks/index.js";
import { parseGlossary, shotGlossary, SEEDANCE_CRAFT_PATH } from "./checks/glossary.js";
import {
  EvalPreflightFailed,
  guardedRun,
  HARNESS_SUFFIX,
  loadTasks,
  parseVerdicts,
  pathsFor,
  preflight,
  recordedSegmentUsd,
  resolveLine,
  worstCaseRunUsd,
  worstCaseSystem,
  type PreflightInput,
} from "./runner.js";
import { assembleOttoInstructions } from "../src/instructions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = join(HERE, "tasks", "engine");

const meta = {
  commit: "deadbeef",
  subjectModel: "mock-subject",
  judgeModel: "mock-judge",
  budgetUsd: FULL_RUN_BUDGET_USD,
  costUsd: () => 0,
  now: () => new Date("2026-09-05T00:00:00.000Z"),
};

const task = (over: Partial<EvalTask> = {}): EvalTask => ({
  id: "engine-t",
  line: "engine",
  prompt: "make me something",
  checks: ["mentions-all:propose"],
  rubric: ["诚实"],
  notes: "",
  ...over,
});

const perfectJudge = async (t: EvalTask): Promise<JudgeVerdict[]> =>
  t.rubric.map((d) => ({ dimension: d, score: 2 as const, reason: "mock" }));

describe("ENGINE-A1 评测基线骨架", () => {
  it("ENGINE-A1 跑一次：逐题有分、总分入档，档案带日期/commit/型号", async () => {
    const tasks = [task({ id: "engine-a" }), task({ id: "engine-b", checks: ["forbids:zzz"] })];
    const archive = await runEvals(tasks, async () => "I will call propose for you.", perfectJudge, meta);

    expect(archive.tasks.map((t) => t.id)).toEqual(["engine-a", "engine-b"]);
    for (const t of archive.tasks) {
      expect(t.maxPoints).toBe(2);
      expect(t.score).toBe(1);
      // 判词与它读到的产物一起入档——分数怎么来的可以复核。
      expect(t.artifact).toContain("propose");
      expect(t.judge[0]).toMatchObject({ dimension: "诚实", score: 2 });
    }
    expect(archive.total).toBe(1);
    expect(archive.date).toBe("2026-09-05T00:00:00.000Z");
    expect(archive.commit).toBe("deadbeef");
    expect(archive.subjectModel).toBe("mock-subject");
    expect(archive.line).toBe("engine");
  });

  it("ENGINE-A1 机械检查先行：能被机械判定的题目一次都不问模型", async () => {
    let judgeCalls = 0;
    const archive = await runEvals(
      [task({ id: "engine-mech", rubric: [] })],
      async () => "no keyword here",
      async () => {
        judgeCalls += 1;
        return [];
      },
      meta,
    );
    expect(judgeCalls).toBe(0);
    expect(archive.tasks[0]!.checks[0]!.pass).toBe(false);
    expect(archive.tasks[0]!.score).toBe(0);
  });

  it("ENGINE-A1 机械检查未过的那部分照实扣分，不被模型的好评盖过去", async () => {
    const archive = await runEvals(
      [task({ id: "engine-mixed", checks: ["mentions-all:propose"], rubric: ["诚实"] })],
      async () => "no keyword here",
      perfectJudge,
      meta,
    );
    expect(archive.tasks[0]!.points).toBe(1);
    expect(archive.tasks[0]!.maxPoints).toBe(2);
    expect(archive.total).toBe(0.5);
  });

  it("ENGINE-A1 evals:check 回归即非零退出的判据：低于基线＝回归，持平与更高＝不回归", () => {
    expect(compareToBaseline(0.8, 0.79).regressed).toBe(true);
    expect(compareToBaseline(0.8, 0.8).regressed).toBe(false);
    expect(compareToBaseline(0.8, 0.81).regressed).toBe(false);
  });

  it("ENGINE-A1 预算硬上限：已花的加这一次的最坏情况超上限就停", () => {
    expect(budgetGate(9.99, 0.02, FULL_RUN_BUDGET_USD).ok).toBe(false);
    expect(budgetGate(9.9, 0.05, FULL_RUN_BUDGET_USD).ok).toBe(true);
    expect(budgetGate(0, 0, 0.0001).ok).toBe(true);
  });
});

describe("ENGINE-A1 题目契约与注册表", () => {
  it("ENGINE-A1 engine 线至少 10 题，front-matter 五字段齐全、id 不撞号", () => {
    const tasks = loadTasks(TASKS_DIR, "engine");
    expect(tasks.length).toBeGreaterThanOrEqual(10);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
    for (const t of tasks) {
      expect(t.line).toBe("engine");
      expect(t.prompt.length).toBeGreaterThan(0);
      expect(t.checks.length + t.rubric.length).toBeGreaterThan(0);
      // 题里点名的每一条机械检查都在注册表里（拼错名字当场炸，不会静默变成满分）。
      for (const spec of t.checks) expect(() => runCheck(spec, "probe")).not.toThrow();
    }
  });

  it("ENGINE-A1 front-matter 缺件当场炸，不静默跑出一个假分", () => {
    expect(() => parseTask("no front matter", "x")).toThrow(/front-matter/);
    expect(() => parseTask("---\nline: engine\nprompt: hi\n---\n", "x")).toThrow(/缺 id/);
    expect(() => parseTask("---\nid: a\nline: nope\nprompt: hi\n---\n", "x")).toThrow(/line/);
    expect(() => parseTask("---\nid: a\nline: engine\n---\n", "x")).toThrow(/缺 prompt/);
    expect(() => parseTask("---\nid: a\nline: engine\nprompt: hi\n---\n", "x")).toThrow(/都是空的/);
  });

  it("ENGINE-A1 注册表里没有的检查名＝抛错", () => {
    expect(() => runCheck("no-such-check", "x")).toThrow(/没有/);
  });

  it("ENGINE-A1 镜头术语表只有一份：检查从 craft/seedance.md 解析取词", () => {
    const g = shotGlossary();
    expect(g["camera-move"]).toContain("dolly in");
    expect(g["shot-framing"]).toContain("close-up");
    expect(g["lighting"]).toContain("golden hour");
    // 词表是从那份文件来的，不是这里抄的一份：把文件里的词删掉，检查跟着变。
    const md = readFileSync(SEEDANCE_CRAFT_PATH, "utf8").replace("- `dolly in`", "- `x dolly in x`");
    expect(parseGlossary(md)["camera-move"]).not.toContain("dolly in");
    expect(runCheck("uses-shot-vocabulary", "one dolly in, close-up on the cup").pass).toBe(true);
    expect(runCheck("uses-shot-vocabulary", "make it look nice").pass).toBe(false);
  });

  it("ENGINE-A1 判分器返回读不懂就抛，不折算成 0 分蒙混过去", () => {
    expect(parseVerdicts('[{"score":2,"reason":"ok"}]', ["诚实"])[0]!.score).toBe(2);
    expect(() => parseVerdicts("说了半天没有数组", ["诚实"])).toThrow(/JSON/);
    expect(() => parseVerdicts('[{"score":2}]', ["a", "b"])).toThrow(/维度/);
    expect(() => parseVerdicts('[{"score":5}]', ["a"])).toThrow(/0\/1\/2/);
  });

  it("ENGINE-A1 两条线共用同一个 runner：--line=creation 指向 tasks/creation 与 baselines/creation.json", () => {
    // §7.3 给 Creation 批 III 的接口第一件：只往 tasks/creation/ 加文件，不改 runner。
    expect(resolveLine([])).toBe("engine");
    expect(resolveLine(["node", "runner.ts", "--check"])).toBe("engine");
    expect(resolveLine(["node", "runner.ts", "--line=creation"])).toBe("creation");
    expect(() => resolveLine(["--line=nope"])).toThrow(/engine 或 creation/);

    const creation = pathsFor("creation");
    expect(creation.tasksDir).toBe(join(HERE, "tasks", "creation"));
    expect(creation.baseline).toBe(join(HERE, "baselines", "creation.json"));
    const engine = pathsFor("engine");
    expect(engine.tasksDir).toBe(TASKS_DIR);
    expect(engine.baseline).toBe(join(HERE, "baselines", "engine.json"));
    // 目录确实存在——批 III 加文件那一刻就跑得动，不必先改 runner。
    expect(existsSync(creation.tasksDir)).toBe(true);
  });

  it("ENGINE-A1 题的 line 与它所在目录必须对得上，否则当场炸（不静默写进别人的档案）", () => {
    expect(() => loadTasks(TASKS_DIR, "creation")).toThrow(/两者必须一致/);
  });

  it("ENGINE-A1 最坏情况估算对华语不能乐观：同长度的华语估得比英文高", () => {
    // 闸的输入端是整份华语 judge.md；英文口径（4 字符 1 token）会把最坏情况低估好几倍。
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("判分标准")).toBe(8);
    expect(estimateTokens("判分标准 abcd")).toBeGreaterThan(estimateTokens("abcdefgh abcd"));
  });

  it("ENGINE-A1 判分刻度：0/1/2 折成半分，机械检查一条一分", () => {
    const checks = [{ name: "c", pass: true, reason: "" }];
    const judge: JudgeVerdict[] = [{ dimension: "d", score: 1, reason: "" }];
    expect(scoreTask(checks, judge)).toEqual({ points: 1.5, maxPoints: 2, score: 0.75 });
  });
});

describe("ENGINE-A1 守卫在花钱之前", () => {
  const ok = (over: Partial<PreflightInput> = {}): PreflightInput => ({
    baseUrl: undefined,
    apiKey: "sk-ant-mock",
    check: false,
    baselineExists: true,
    baselinePath: "/tmp/engine.json",
    recordedUsd: 1,
    worstCaseUsd: 2,
    segmentBudgetUsd: SEGMENT_BUDGET_USD,
    ...over,
  });

  it("ENGINE-A1 环境不对就拒跑：ANTHROPIC_BASE_URL 有值＝那颗 404 雷，不许发调用", () => {
    const v = preflight(ok({ baseUrl: "https://api.anthropic.com" }));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("ANTHROPIC_BASE_URL");
  });

  it("ENGINE-A1 没有钥匙就拒跑", () => {
    expect(preflight(ok({ apiKey: undefined })).ok).toBe(false);
  });

  it("ENGINE-A1 evals:check 没有基线可比是开跑前就知道的事，不烧一趟钱再说", () => {
    expect(preflight(ok({ check: true, baselineExists: false })).ok).toBe(false);
    expect(preflight(ok({ check: false, baselineExists: false })).ok).toBe(true);
  });

  it("ENGINE-A1 本段累计闸是真闸：已记 + 本次最坏超过 $20 就拒跑，不到就放行", () => {
    expect(preflight(ok({ recordedUsd: 15, worstCaseUsd: 6 })).ok).toBe(false);
    expect(preflight(ok({ recordedUsd: 15, worstCaseUsd: 6 })).reason).toContain("本段累计预算闸");
    expect(preflight(ok({ recordedUsd: 15, worstCaseUsd: 5 })).ok).toBe(true);
  });

  it("ENGINE-A1 守卫没过时，被测对象与判分器一次都不被调用（花钱的那一趟根本没开始）", async () => {
    let subjectCalls = 0;
    let judgeCalls = 0;
    const spend = async () => {
      subjectCalls++;
      return runEvals(
        [task()],
        async () => {
          subjectCalls++;
          return "propose";
        },
        async (t) => {
          judgeCalls++;
          return perfectJudge(t);
        },
        meta,
      );
    };
    await expect(guardedRun({ ok: false, reason: "拒跑" }, spend)).rejects.toBeInstanceOf(
      EvalPreflightFailed,
    );
    expect(subjectCalls).toBe(0);
    expect(judgeCalls).toBe(0);
  });

  it("ENGINE-A1 守卫过了才真跑，档案照常回来", async () => {
    const archive = await guardedRun({ ok: true, reason: "" }, () =>
      runEvals([task()], async () => "propose", perfectJudge, meta),
    );
    expect(archive.tasks).toHaveLength(1);
  });

  it("ENGINE-A1 已记花费＝baselines/ 里每一份档案的 costUsd 之和，目录不存在算 0", () => {
    expect(recordedSegmentUsd(join(HERE, "baselines-does-not-exist"))).toBe(0);
    const real = recordedSegmentUsd(join(HERE, "baselines"));
    expect(real).toBeGreaterThanOrEqual(0);
    expect(real).toBeLessThan(SEGMENT_BUDGET_USD);
  });

  it("ENGINE-A1 最坏花费估算随题量与 rubric 增长，且判分调用按重试一次计两遍", () => {
    const prices = { inputPerToken: 3 / 1e6, outputPerToken: 15 / 1e6 };
    const parts = { system: "s".repeat(400), judgeRubric: "j".repeat(400), prices };
    const one = worstCaseRunUsd([task()], parts);
    const two = worstCaseRunUsd([task(), task({ id: "engine-u" })], parts);
    const noRubric = worstCaseRunUsd([task({ rubric: [] })], parts);
    expect(two).toBeCloseTo(one * 2, 12);
    expect(noRubric).toBeLessThan(one);
  });

  it("ENGINE-A7 最坏花费用的说明书不短于任何一题装出来的那一份（累计闸只许高估）", () => {
    const tasks = loadTasks(TASKS_DIR, "engine");
    expect(tasks.length).toBeGreaterThan(1);
    const worst = worstCaseSystem(tasks);
    for (const t of tasks) {
      // 两边同形状：`worstCaseSystem` 拼了台架后缀，右边也得拼上，否则后缀那一段
      // 会白白垫高左边 —— `worstCaseSystem` 哪天丢掉后缀，这条断言也照样绿。
      const assembled = assembleOttoInstructions(t.prompt).text + HARNESS_SUFFIX;
      expect(estimateTokens(worst)).toBeGreaterThanOrEqual(estimateTokens(assembled));
    }
  });
});
