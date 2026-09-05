/**
 * ENGINE-A1 的行为测试：跑一次、逐题有分、总分入档；evals:check 回归即非零退出。
 *
 * 判分器与被测对象都是 **mock**（`runEvals` 的两个参数就是为此注入的），所以这份测试
 * 一分钱不花、不碰网络、不需要钥匙。真调用那一半在 `runner.ts`，它的纯部分
 * （判词解析、题目装载、预算闸）在这里单独钉。
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  FULL_RUN_BUDGET_USD,
  REGRESSION_TOLERANCE_POINTS,
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
  SPEND_LEDGER,
  appendSpend,
  guardedRun,
  HARNESS_SUFFIX,
  loadTasks,
  parseVerdicts,
  pathsFor,
  preflight,
  recordedSegmentUsd,
  recordingSpend,
  resolveLine,
  resolveTolerance,
  runMain,
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

  it("ENGINE-A1 evals:check 回归即非零退出的判据：低于基线超过容差＝回归，持平与更高＝不回归", () => {
    expect(compareToBaseline(0.8, 0.74).regressed).toBe(true);
    expect(compareToBaseline(0.8, 0.8).regressed).toBe(false);
    expect(compareToBaseline(0.8, 0.81).regressed).toBe(false);
  });

  it("ENGINE-A1 判分噪声容差：默认 ±5 个百分点内不算回归，容差可由参数覆盖", () => {
    // 判分器对同一份产物两次跑不一定给同一个分（engine-6 那 1 分就这么浮动过）：
    // 一题 4 分、共 10 题，一个维度抖一档＝总分 1.25 个百分点。默认容差要吃得下它。
    expect(REGRESSION_TOLERANCE_POINTS).toBe(5);
    expect(compareToBaseline(0.8, 0.79).regressed).toBe(false);
    expect(compareToBaseline(0.8, 0.75).regressed).toBe(false);
    expect(compareToBaseline(0.8, 0.7499).regressed).toBe(true);
    // 覆盖成 0 就是旧口径：低一点点也算回归。
    expect(compareToBaseline(0.8, 0.79, 0).regressed).toBe(true);
    expect(compareToBaseline(0.8, 0.7, 10).regressed).toBe(false);
    // delta 本身不受容差影响——印出来的还是真差值。
    expect(compareToBaseline(0.8, 0.79).delta).toBeCloseTo(-0.01, 12);
  });

  it("ENGINE-A1 --tolerance= 解析：缺省用默认值，读不懂或负数当场炸", () => {
    expect(resolveTolerance([])).toBe(REGRESSION_TOLERANCE_POINTS);
    expect(resolveTolerance(["node", "runner.ts", "--check"])).toBe(REGRESSION_TOLERANCE_POINTS);
    expect(resolveTolerance(["--tolerance=0"])).toBe(0);
    expect(resolveTolerance(["--tolerance=2.5"])).toBe(2.5);
    expect(() => resolveTolerance(["--tolerance=-1"])).toThrow(/百分点/);
    expect(() => resolveTolerance(["--tolerance=abc"])).toThrow(/百分点/);
    // 判官 2026-09-05 P2-5：空值（shell 里变量没展开）从前静默变成最严的 0，
    // 跑的人以为自己给的是默认的 ±5。要 0 得把 0 写出来。
    expect(() => resolveTolerance(["--tolerance="])).toThrow(/空的/);
    expect(() => resolveTolerance(["--tolerance=   "])).toThrow(/空的/);
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

  it("ENGINE-A1 禁词按词边界判：说出禁词才算命中，长单词里的同一串字母不算", () => {
    // 判官 2026-09-05 P2-3：裸子串会冤枉人 —— `extend` 撞上 “the extended cut”。
    expect(runCheck("forbids:extend", "I will extend your clip").pass).toBe(false); // 真说了＝命中
    expect(runCheck("forbids:extend", "that is the extended cut, not an edit").pass).toBe(true);
    expect(runCheck("forbids:Inbox", "check your Inbox").pass).toBe(false);
    expect(runCheck("forbids:Inbox", "two inboxes later").pass).toBe(true);
    // 词组同理，只看整段词组的两端；大小写仍不敏感。
    expect(runCheck("forbids:already researched", "It is Already Researched.").pass).toBe(false);
  });

  it("ENGINE-A1 禁词把屈折形也写出来：题目里的那份名单真的拦得住复数与进行时", () => {
    // 判官 2026-09-05 P2-2：词边界拦不住屈折形，而编造一个页面时用的正是复数
    // （Inboxes）、承诺做不到的事时用的正是进行时（extending）。这里读的是**题目文件**
    // 里真正在跑的那份名单，不是测试里另抄的一份。
    const tasks = loadTasks(TASKS_DIR, "engine");
    const specOf = (id: string, name: string) => {
      const spec = tasks.find((t) => t.id === id)?.checks.find((c) => c.startsWith(`${name}:`));
      expect(spec).toBeDefined();
      return spec!;
    };
    const map = specOf("engine-6", "forbids");
    expect(runCheck(map, "check your Inboxes for the reply").pass).toBe(false); // 反：复数溜不掉
    expect(runCheck(map, "Settings, then Connections — that is the whole path.").pass).toBe(true); // 正：正当回答照过

    const clip = specOf("engine-5", "forbids");
    expect(runCheck(clip, "I'll be extending your clip for you").pass).toBe(false); // 反：进行时溜不掉
    expect(runCheck(clip, "that is the extended cut, not a new clip").pass).toBe(true); // 正：不冤枉片名
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

  it("ENGINE-A1 已记花费＝花费账本每一行 costUsd 之和，账本不存在算 0", () => {
    expect(recordedSegmentUsd(join(HERE, "baselines", "spend-does-not-exist.jsonl"))).toBe(0);
    const real = recordedSegmentUsd(SPEND_LEDGER);
    expect(real).toBeGreaterThan(0); // 首跑那一趟的钱真的花了，账本里有它
    expect(real).toBeLessThan(SEGMENT_BUDGET_USD);
  });

  it("ENGINE-A1 累计是真累计：跑三趟＝三趟之和，重读账本不重复计", () => {
    // 「本段累计 $20」从前读的是各线**最近一次**的档案（覆盖写），跑三趟只记得到一趟的钱。
    // 账本只追加，所以三趟就是三趟（判官 2026-09-05 P2-1）。
    const dir = mkdtempSync(join(tmpdir(), "otto-evals-spend-"));
    const ledger = join(dir, "spend.jsonl");
    try {
      expect(recordedSegmentUsd(ledger)).toBe(0);
      const runs = [0.5, 0.25, 0.125];
      for (const costUsd of runs) {
        appendSpend(ledger, { line: "engine", date: new Date().toISOString(), commit: "abc", costUsd });
      }
      expect(recordedSegmentUsd(ledger)).toBeCloseTo(0.875, 12);
      // 读第二遍还是同一个数：求和不因为重读而翻倍。
      expect(recordedSegmentUsd(ledger)).toBeCloseTo(0.875, 12);
      // 追加从不改写既有的行：三趟仍在，第四趟只是多一行。
      expect(readFileSync(ledger, "utf8").trim().split("\n")).toHaveLength(3);
      appendSpend(ledger, { line: "engine", date: "d", commit: "c", costUsd: 0.125 });
      expect(recordedSegmentUsd(ledger)).toBeCloseTo(1, 12);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ENGINE-A1 账本读不懂的一行当场炸，不静默按 0 计（累计闸只许高估）", () => {
    const dir = mkdtempSync(join(tmpdir(), "otto-evals-spend-bad-"));
    const ledger = join(dir, "spend.jsonl");
    try {
      writeFileSync(ledger, '{"line":"engine","date":"d","commit":"c","costUsd":0.5}\n不是 JSON\n');
      expect(() => recordedSegmentUsd(ledger)).toThrow(/第 2 行/);
      writeFileSync(ledger, '{"line":"engine","date":"d","commit":"c","costUsd":"贵"}\n');
      expect(() => recordedSegmentUsd(ledger)).toThrow(/costUsd/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ENGINE-A1 main() 的接线：守卫没过时，花钱的那一趟一次都没被调用", async () => {
    // 判官 2026-09-05 P2-2：从前只钉了 guardedRun 的契约，把 main() 改成先跑后判照样全绿。
    let runs = 0;
    await expect(
      runMain({
        preflight: () => ({ ok: false, reason: "拒跑" }),
        runEvals: async () => {
          runs += 1;
          return "花掉了";
        },
      }),
    ).rejects.toBeInstanceOf(EvalPreflightFailed);
    expect(runs).toBe(0);
  });

  it("ENGINE-A1 main() 的接线：守卫过了才跑，产物原样回来", async () => {
    let runs = 0;
    await expect(
      runMain({
        preflight: () => ({ ok: true, reason: "" }),
        runEvals: async () => {
          runs += 1;
          return "档案";
        },
      }),
    ).resolves.toBe("档案");
    expect(runs).toBe(1);
  });

  it("ENGINE-A1 中途炸掉的一趟也进账本：钱花到哪儿记到哪儿，带 failed 标记", async () => {
    // 判官 2026-09-05 P2-1：从前只有跑完写档案那一路追加账本行。第七题上判分器连读两次
    // 都读不懂，前六题的钱已经付了，账本却一行都没有 —— 累计闸下一次读到的数偏小。
    const dir = mkdtempSync(join(tmpdir(), "otto-evals-spend-failed-"));
    const ledger = join(dir, "spend.jsonl");
    try {
      appendSpend(ledger, { line: "engine", date: "d", commit: "c", costUsd: 0.2 });
      expect(recordedSegmentUsd(ledger)).toBeCloseTo(0.2, 12);
      let spent = 0;
      await expect(
        recordingSpend(
          ledger,
          {
            line: "engine",
            commit: () => "beefcafe",
            now: () => new Date("2026-09-05T12:00:00.000Z"),
            spentUsd: () => spent,
          },
          async () => {
            spent = 0.3; // 前几题的钱已经真花出去了
            throw new Error("判分器连读两次都读不懂");
          },
        ),
      ).rejects.toThrow(/读不懂/); // 错误原样抛回去，退出码那条路不变
      const lines = readFileSync(ledger, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2); // 账本多了一行
      const failed = JSON.parse(lines[1]!) as Record<string, unknown>;
      expect(failed.failed).toBe(true);
      expect(failed.costUsd).toBeCloseTo(0.3, 12);
      expect(failed.commit).toBe("beefcafe");
      // 累计闸下一次读到的就是 0.2 + 0.3，不是 0.2。
      expect(recordedSegmentUsd(ledger)).toBeCloseTo(0.5, 12);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ENGINE-A1 跑成功那一趟不在这一层记账：账本只多失败那一行，不重复计", async () => {
    const dir = mkdtempSync(join(tmpdir(), "otto-evals-spend-ok-"));
    const ledger = join(dir, "spend.jsonl");
    try {
      await expect(
        recordingSpend(
          ledger,
          { line: "engine", commit: () => "c", now: () => new Date(), spentUsd: () => 0.9 },
          async () => "档案",
        ),
      ).resolves.toBe("档案");
      expect(existsSync(ledger)).toBe(false); // 成功那一路由 main() 用档案里的真值追加
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ENGINE-A1 账本自己写不进去时不许顶掉原始失败（两个都报，原始在前）", async () => {
    // 判官 2026-09-05 #1235 P2-4：appendSpend 是一次真写盘（盘满、只读挂载、目录没了）。
    // 裸着写在 catch 里，抛出去的就成了「写不了文件」，真正的病因连堆栈一起被顶掉。
    const dir = mkdtempSync(join(tmpdir(), "otto-evals-spend-unwritable-"));
    // 父目录不存在 ⇒ appendFileSync 抛 ENOENT，等价于写盘失败那一族。
    const ledger = join(dir, "没有这个目录", "spend.jsonl");
    try {
      const boom = new Error("判分器连读两次都读不懂");
      await expect(
        recordingSpend(
          ledger,
          { line: "engine", commit: () => "c", now: () => new Date(), spentUsd: () => 0.3 },
          async () => {
            throw boom;
          },
        ),
      ).rejects.toMatchObject({
        // 原始那条在前，写盘失败挂在后面。
        message: expect.stringMatching(/^判分器连读两次都读不懂；.*没能记进账本/s),
        cause: boom, // 原始错误连堆栈一起原样带着
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ENGINE-A1 花钱的那一趟真的经过 runMain（不是只有测试里那一份接线）", () => {
    // 判官 2026-09-05 P2-3：runMain 的契约有测试，但没有一条钉住 main() 用的就是它。
    // 把 main() 改回「先 runEvals 再问守卫」不会让上面两条红 —— 所以这里钉源码里的接线。
    const src = readFileSync(join(HERE, "runner.ts"), "utf8");
    const mainAt = src.indexOf("async function main()");
    expect(mainAt).toBeGreaterThan(0);
    const body = src.slice(mainAt);
    const wiredAt = body.indexOf("await runMain({");
    const spendAt = body.indexOf("runEvals(tasks,");
    expect(wiredAt).toBeGreaterThan(0);
    expect(spendAt).toBeGreaterThan(wiredAt); // 花钱那一趟长在 runMain 的参数里
    // main() 里也不许绕过 runMain 自己去调 guardedRun（那就等于又有了第二条接线）。
    expect(body).not.toContain("guardedRun(");
  });

  it("ENGINE-A1 花钱的那一趟真的裹在 recordingSpend 里（炸了也记账这条接线本身有人钉）", () => {
    // 判官 2026-09-05 #1235 P2-1：`recordingSpend` 的契约有两条测试（上面那两条），
    // 但没有一条钉住 main() 用了它 —— 把它从 main() 拆掉，evals 全套照样绿，而账本从此
    // 又只记跑成功的那一趟，累计闸重新开始低估。所以这里钉源码里的接线。
    const src = readFileSync(join(HERE, "runner.ts"), "utf8");
    const mainAt = src.indexOf("async function main()");
    expect(mainAt).toBeGreaterThan(0);
    const body = src.slice(mainAt);
    const wiredAt = body.indexOf("await runMain({");
    const recordingAt = body.indexOf("recordingSpend(");
    const spendAt = body.indexOf("runEvals(tasks,");
    expect(recordingAt).toBeGreaterThan(wiredAt); // 在 runMain 的参数里面
    expect(spendAt).toBeGreaterThan(recordingAt); // 真花钱那一趟长在它里面
    // 记的是产品那本账，不是另开一本。
    expect(body.slice(recordingAt, spendAt)).toContain("SPEND_LEDGER");
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
