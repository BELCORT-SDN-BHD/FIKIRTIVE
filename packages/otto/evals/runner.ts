/**
 * 评测基线 runner（tsx 入口，`docs/specs/otto-engine.md` §7.3）。
 *
 *   pnpm --filter @fikirtive/otto run evals          写档案（baselines/<line>.json）
 *   pnpm --filter @fikirtive/otto run evals:check    重跑并比对基线，回归即非零退出
 *
 * 哪一条线由 `--line=engine|creation` 决定，缺省 engine（§7.3 给 Creation 的接口第一件：
 * Creation 只往 tasks/creation/ 加文件，不改本文件）。pnpm 传参要加 `--`：
 *   pnpm --filter @fikirtive/otto run evals -- --line=creation
 *
 * 两条纪律，都在 README 第一段：
 *   · 一律 `env -u ANTHROPIC_BASE_URL`（本文件开跑前会亲自检查一次，设了就拒跑）；
 *   · 本 runner **不加载仓库 `.env.local`** —— 变量只从已经在 shell 里的 `process.env` 读。
 *
 * 预算：单次全跑硬上限 $10（`FULL_RUN_BUDGET_USD`），每次模型调用之前问一次预算闸，
 * 超了就地停并非零退出 —— 不是「跑完再看花了多少」。
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { llmPricesFor } from "@fikirtive/core";
import { ottoInstructions } from "../src/instructions.js";
import { OTTO_PRIMARY_MODEL } from "../src/model.js";
import {
  EvalBudgetExceeded,
  FULL_RUN_BUDGET_USD,
  SEGMENT_BUDGET_USD,
  budgetGate,
  callCostUsd,
  compareToBaseline,
  estimateTokens,
  parseTask,
  type EvalArchive,
  type EvalTask,
  type JudgeVerdict,
} from "./core.js";
import { runEvals, type Judge, type Subject } from "./run.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const JUDGE_RUBRIC_PATH = join(HERE, "judge.md");

/** 两条线共用同一个 runner（§7.3 给 Creation 的接口第一件：只加文件，不改 runner）。 */
export type EvalLine = "engine" | "creation";

/** 纯：`--line=creation` → 哪一条线；不给就是 engine（本规格自己的那条）。 */
export function resolveLine(argv: readonly string[]): EvalLine {
  const raw = argv.find((a) => a.startsWith("--line="))?.slice("--line=".length) ?? "engine";
  if (raw !== "engine" && raw !== "creation") {
    throw new Error(`--line 只能是 engine 或 creation，收到 "${raw}"`);
  }
  return raw;
}

/** 纯：一条线的两个路径——题目目录与它自己那一份档案。 */
export function pathsFor(line: EvalLine): { tasksDir: string; baseline: string } {
  return { tasksDir: join(HERE, "tasks", line), baseline: join(HERE, "baselines", `${line}.json`) };
}

const SUBJECT_MAX_OUTPUT = 900;
const JUDGE_MAX_OUTPUT = 700;

/**
 * 离线台架的固定后缀。它**不是**被测内容的一部分：被测的是 Otto 的说明书本身
 * （⑥段把单体换成文件柜之后，换掉的正是上面那一份），这一段永远不变，
 * 所以两次跑分比的仍是同一件事。
 */
const HARNESS_SUFFIX = `

---
You are answering inside an offline evaluation harness. No tools are connected this turn and nothing you say spends money. Answer the merchant as you normally would, and state plainly — in order — which tools or prompt skills you would call and the key fields you would pass. Do not invent results you have not got.`;

// ── 环境前置（§7.7 的那颗雷）────────────────────────────────────────────────

function assertEnvironment(): void {
  if (process.env.ANTHROPIC_BASE_URL) {
    throw new Error(
      "ANTHROPIC_BASE_URL 有值——本机 Anthropic 调用会 404（症状像「型号不存在」，别去改型号常量）。\n" +
        "跑法：env -u ANTHROPIC_BASE_URL pnpm --filter @fikirtive/otto run evals",
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 不在环境里。先 `set -a; . .env.local; set +a`，再 env -u ANTHROPIC_BASE_URL 跑。");
  }
}

// ── 计费器：真实用量 × 价目表，每次调用之前过一次预算闸 ──────────────────────

class Meter {
  private spent = 0;
  constructor(private readonly budgetUsd: number) {}
  get usd(): number {
    return this.spent;
  }
  /** 调用**之前**问：这一次最坏要花多少？超了就抛。 */
  guard(model: string, promptText: string, maxOutputTokens: number): void {
    const p = llmPricesFor(model);
    const worst = callCostUsd(
      { inputTokens: estimateTokens(promptText), outputTokens: maxOutputTokens },
      p,
    );
    const verdict = budgetGate(this.spent, worst, this.budgetUsd);
    if (!verdict.ok) throw new EvalBudgetExceeded(verdict.reason);
  }
  /** 调用**之后**记：真实用量的钱。 */
  charge(model: string, usage: { inputTokens?: number; outputTokens?: number }): void {
    this.spent += callCostUsd(
      { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
      llmPricesFor(model),
    );
  }
}

// ── 被测对象与判分器 ────────────────────────────────────────────────────────

function makeSubject(model: string, meter: Meter): Subject {
  const system = ottoInstructions + HARNESS_SUFFIX;
  return async (task) => {
    meter.guard(model, system + task.prompt, SUBJECT_MAX_OUTPUT);
    const r = await generateText({
      model: anthropic(model),
      system,
      prompt: task.prompt,
      maxOutputTokens: SUBJECT_MAX_OUTPUT,
    });
    meter.charge(model, r.usage);
    return r.text;
  };
}

/** 纯：从判分器的回答里取出那个 JSON 数组（模型爱包一层散文，这里只认结构）。 */
export function parseVerdicts(raw: string, dimensions: string[]): JudgeVerdict[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error(`判分器没返回 JSON 数组：${raw.slice(0, 200)}`);
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed) || parsed.length !== dimensions.length) {
    throw new Error(`判分器返回 ${Array.isArray(parsed) ? parsed.length : "非数组"} 条，题目有 ${dimensions.length} 个维度`);
  }
  return parsed.map((v, i) => {
    const row = v as { score?: unknown; reason?: unknown };
    const score = Number(row.score);
    if (score !== 0 && score !== 1 && score !== 2) throw new Error(`第 ${i + 1} 维的 score 不是 0/1/2：${String(row.score)}`);
    return { dimension: dimensions[i]!, score: score as 0 | 1 | 2, reason: String(row.reason ?? "") };
  });
}

function makeJudge(model: string, meter: Meter): Judge {
  const rubric = readFileSync(JUDGE_RUBRIC_PATH, "utf8");
  return async (task, artifact) => {
    const prompt =
      `${rubric}\n\n## 这一题\n\n商家说的话：\n${task.prompt}\n\n## Otto 的产物\n\n${artifact}\n\n` +
      `## 要判的维度（按顺序，逐条判）\n\n${task.rubric.map((d, i) => `${i + 1}. ${d}`).join("\n")}\n\n` +
      `只输出一个 JSON 数组，长度 ${task.rubric.length}，每项 {"score":0|1|2,"reason":"一句话"}。不要输出别的。`;
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      meter.guard(model, prompt, JUDGE_MAX_OUTPUT);
      const r = await generateText({
        model: anthropic(model),
        prompt: attempt === 0 ? prompt : `${prompt}\n\n（上一次的输出读不懂，请只输出那个 JSON 数组。）`,
        maxOutputTokens: JUDGE_MAX_OUTPUT,
      });
      meter.charge(model, r.usage);
      try {
        return parseVerdicts(r.text, task.rubric);
      } catch (err) {
        last = err;
      }
    }
    throw last;
  };
}

// ── 题目与档案 ──────────────────────────────────────────────────────────────

export function loadTasks(dir: string, expectedLine: EvalLine): EvalTask[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
  const tasks = files.map((f) => parseTask(readFileSync(join(dir, f), "utf8"), join(dir, f)));
  const ids = new Set(tasks.map((t) => t.id));
  if (ids.size !== tasks.length) throw new Error("题目 id 撞号了——一题一个 id");
  // 题的 line 必须与它所在目录对得上：一道 creation 题掉进 tasks/engine/ 就是一份写错的档案，
  // 而档案是「不低于基线」的比较对象——那种错必须当场炸，不能静默入档。
  for (const t of tasks) {
    if (t.line !== expectedLine) {
      throw new Error(`题 ${t.id} 写着 line: ${t.line}，却放在 tasks/${expectedLine}/ 里——两者必须一致`);
    }
  }
  return tasks;
}

function commitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: HERE, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * 这条线的档案里已记的花费——**只报数不拦**（`SEGMENT_BUDGET_USD` 是记账口径，
 * 真闸只有单次全跑的 `FULL_RUN_BUDGET_USD`，见 README「预算」一节）。
 */
function spentSoFarUsd(baseline: string): number {
  if (!existsSync(baseline)) return 0;
  const prev = JSON.parse(readFileSync(baseline, "utf8")) as EvalArchive;
  return prev.costUsd ?? 0;
}

function report(archive: EvalArchive): void {
  for (const t of archive.tasks) {
    const failed = t.checks.filter((c) => !c.pass);
    console.log(
      `  ${t.id}  ${t.points.toFixed(1)}/${t.maxPoints}  (${(t.score * 100).toFixed(0)}%)` +
        (failed.length > 0 ? `  机械检查未过：${failed.map((c) => c.name).join(", ")}` : ""),
    );
  }
  console.log(
    `总分 ${(archive.total * 100).toFixed(1)}%  (${archive.points.toFixed(1)}/${archive.maxPoints})  ` +
      `花费 $${archive.costUsd.toFixed(4)} / 上限 $${archive.budgetUsd}`,
  );
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const line = resolveLine(process.argv);
  const { tasksDir, baseline: BASELINE } = pathsFor(line);
  assertEnvironment();

  // `--check` 没有基线可比是**开跑前**就知道的事——先说，别烧完一整趟钱再说。
  if (check && !existsSync(BASELINE)) {
    console.error(`没有基线可比（${BASELINE} 不存在）。先跑一次 evals 写档案。`);
    process.exit(1);
  }

  const tasks = loadTasks(tasksDir, line);
  const model = OTTO_PRIMARY_MODEL;
  const budgetUsd = FULL_RUN_BUDGET_USD;
  const meter = new Meter(budgetUsd);

  const already = spentSoFarUsd(BASELINE);
  console.log(
    `${line} 线 ${tasks.length} 题，型号 ${model}，单次上限 $${budgetUsd}` +
      `（本段累计记账口径 $${SEGMENT_BUDGET_USD}，只报数不拦；这条线的档案里已记 $${already.toFixed(4)}）`,
  );

  const archive = await runEvals(tasks, makeSubject(model, meter), makeJudge(model, meter), {
    commit: commitSha(),
    subjectModel: model,
    judgeModel: model,
    budgetUsd,
    costUsd: () => meter.usd,
    now: () => new Date(),
  });
  report(archive);

  if (!check) {
    writeFileSync(BASELINE, `${JSON.stringify(archive, null, 2)}\n`);
    console.log(`档案已写 ${BASELINE}`);
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as EvalArchive;
  const { regressed, delta } = compareToBaseline(baseline.total, archive.total);
  console.log(
    `基线 ${(baseline.total * 100).toFixed(1)}%（${baseline.date}，commit ${baseline.commit.slice(0, 8)}）` +
      ` → 本次 ${(archive.total * 100).toFixed(1)}%，差 ${(delta * 100).toFixed(1)} 个百分点`,
  );
  if (regressed) {
    console.error("回归：总分低于基线。");
    process.exit(1);
  }
  console.log("不低于基线。");
}

// tsx 直跑时才 main()；被测试 import 时不跑（测试只要那几个纯函数）。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
