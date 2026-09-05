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
import { loadTasks, parseVerdicts, pathsFor, resolveLine } from "./runner.js";

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
