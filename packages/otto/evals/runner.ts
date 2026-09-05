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
 * 预算两道，都在花钱之前：
 *   · 本段累计 $20（`SEGMENT_BUDGET_USD`）—— 开跑前把 `baselines/spend.jsonl`（只追加、
 *     不覆盖的花费账本）里每一行的 `costUsd` 加起来，再加上本次全跑的最坏花费，
 *     超了就拒跑，一分钱不花。每跑一趟就追加一行——**中途炸掉的那一趟也追加**（记到
 *     炸的那一刻为止的真实花费，带 `failed`），所以「累计」是真累计；
 *   · 单次全跑 $10（`FULL_RUN_BUDGET_USD`）—— 每次模型调用之前问一次，超了就地停并非零退出。
 * 两道都不是「跑完再看花了多少」。开跑前的那几道守卫由 `preflight` 判、`guardedRun` 执行，
 * 而 main() 的接线本身是 `runMain({ preflight, runEvals })`：花钱的那一趟是传给它的闭包，
 * 所以「守卫在花钱之前」是结构上的事实，不是注释里的说法（回归测试钉的正是它）。
 */
import { appendFileSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { llmPricesFor } from "@fikirtive/core";
import { assembleOttoInstructions } from "../src/instructions.js";
import { OTTO_PRIMARY_MODEL } from "../src/model.js";
import {
  EvalBudgetExceeded,
  FULL_RUN_BUDGET_USD,
  REGRESSION_TOLERANCE_POINTS,
  SEGMENT_BUDGET_USD,
  budgetGate,
  callCostUsd,
  compareToBaseline,
  estimateTokens,
  parseTask,
  type EvalArchive,
  type EvalTask,
  type JudgeVerdict,
  type TokenPrices,
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

/** 档案目录：每条线一份跑分档案（覆盖写），外加一份只追加的花费账本 `spend.jsonl`。 */
const BASELINES_DIR = join(HERE, "baselines");

/**
 * 纯：`--tolerance=<百分点>` → 回归判定的噪声容差；不给就是默认的 ±5 个百分点。
 *
 * 给 0 就是「低一点点也算回归」（旧口径）。负数与读不懂的值当场炸：一个悄悄变成
 * 「永不回归」的容差比没有容差更坏。
 *
 * 空值（`--tolerance=`，多半是 shell 里那个变量没展开）也当场炸：`Number("")` 是 0，
 * 从前它会静默变成**最严**的口径，跑的人以为自己给的是默认的 ±5（判官 2026-09-05 P2-5）。
 * 「打错字」与「我要 0」必须分得开，所以要 0 得把 0 写出来。
 */
export function resolveTolerance(argv: readonly string[]): number {
  const raw = argv.find((a) => a.startsWith("--tolerance="))?.slice("--tolerance=".length);
  if (raw === undefined) return REGRESSION_TOLERANCE_POINTS;
  if (raw.trim() === "") {
    throw new Error("--tolerance= 后面是空的：要最严的口径请写 --tolerance=0，不给就是默认的 ±5 个百分点");
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`--tolerance 要一个 ≥0 的百分点数，收到 "${raw}"`);
  }
  return n;
}

/** 纯：一条线的两个路径——题目目录与它自己那一份档案。 */
export function pathsFor(line: EvalLine): { tasksDir: string; baseline: string } {
  return { tasksDir: join(HERE, "tasks", line), baseline: join(BASELINES_DIR, `${line}.json`) };
}

const SUBJECT_MAX_OUTPUT = 900;
const JUDGE_MAX_OUTPUT = 700;

/**
 * 离线台架的固定后缀。它**不是**被测内容的一部分：被测的是 Otto 的说明书本身
 * （⑥段把单体换成文件柜之后，换掉的正是上面那一份），这一段永远不变，
 * 所以两次跑分比的仍是同一件事。
 *
 * 导出是给测试用的：ENGINE-A7 那条「最坏不短于任何一题」的断言，两边必须是**同一种形状**
 * （都带台架后缀），否则少掉的那一段会替真正的上界白白垫高一截，掉了后缀也照样绿。
 */
export const HARNESS_SUFFIX = `

---
You are answering inside an offline evaluation harness. No tools are connected this turn and nothing you say spends money. Answer the merchant as you normally would, and state plainly — in order — which tools or prompt skills you would call and the key fields you would pass. Do not invent results you have not got.`;

// ── 开跑前的守卫（§7.7 的那颗雷 ＋ 两道预算）────────────────────────────────

/** 开跑前能判的全部条件。全是值，所以这道守卫可以在测试里逐条钉，不必起进程、不必有钥匙。 */
export interface PreflightInput {
  /** `process.env.ANTHROPIC_BASE_URL`——有值就拒跑（§7.7 那颗 404 雷）。 */
  baseUrl: string | undefined;
  apiKey: string | undefined;
  /** `--check`：比对基线的那一趟。没有基线可比是开跑前就知道的事。 */
  check: boolean;
  baselineExists: boolean;
  baselinePath: string;
  /** 花费账本 `baselines/spend.jsonl` 里已记的花费之和。 */
  recordedUsd: number;
  /** 本次全跑的最坏花费（已被单次硬上限截住）。 */
  worstCaseUsd: number;
  segmentBudgetUsd: number;
}

/**
 * 纯：开跑前的判词。`ok:false` 就是「这一趟一次调用都不发」。
 *
 * 顺序即优先级：环境不对 → 没有基线可比 → 本段累计预算不够。
 */
export function preflight(i: PreflightInput): { ok: boolean; reason: string } {
  if (i.baseUrl) {
    return {
      ok: false,
      reason:
        "ANTHROPIC_BASE_URL 有值——本机 Anthropic 调用会 404（症状像「型号不存在」，别去改型号常量）。\n" +
        "跑法：env -u ANTHROPIC_BASE_URL pnpm --filter @fikirtive/otto run evals",
    };
  }
  if (!i.apiKey) {
    return {
      ok: false,
      reason: "ANTHROPIC_API_KEY 不在环境里。先 `set -a; . .env.local; set +a`，再 env -u ANTHROPIC_BASE_URL 跑。",
    };
  }
  if (i.check && !i.baselineExists) {
    return { ok: false, reason: `没有基线可比（${i.baselinePath} 不存在）。先跑一次 evals 写档案。` };
  }
  const segment = budgetGate(i.recordedUsd, i.worstCaseUsd, i.segmentBudgetUsd);
  if (!segment.ok) {
    return {
      ok: false,
      reason:
        `本段累计预算闸：账本已记 $${i.recordedUsd.toFixed(4)} + 本次最坏 $${i.worstCaseUsd.toFixed(4)} ` +
        `> 本段上限 $${i.segmentBudgetUsd.toFixed(2)}，拒跑（一分钱不花）。`,
    };
  }
  return { ok: true, reason: "" };
}

/** 守卫没过时抛它——runner 据此非零退出。 */
export class EvalPreflightFailed extends Error {}

/**
 * 守卫在花钱之前：`run` 是**闭包**，`verdict.ok` 为假时它根本不会被调用。
 *
 * main() 与回归测试跑的是同一个函数——否则「守卫在前」只是位置上的巧合，
 * 谁把两行调个个儿都不会红。
 */
export async function guardedRun<T>(
  verdict: { ok: boolean; reason: string },
  run: () => Promise<T>,
): Promise<T> {
  if (!verdict.ok) throw new EvalPreflightFailed(verdict.reason);
  return run();
}

/**
 * main() 的**接线**本身，抽出来是为了能被钉住：两件事都是闭包，谁先谁后是这一个函数说了算。
 *
 * `guardedRun` 只保证「verdict 为假时不跑」；它保不了 main() 有没有先把钱花掉再去问守卫
 * （判官 2026-09-05 P2-2：只把 main() 改成先跑后判，从前 22 条测试全绿）。
 * 真正花钱的那一趟必须经过这里，回归测试才有对象可钉。
 */
export async function runMain<T>(deps: {
  preflight: () => { ok: boolean; reason: string };
  runEvals: () => Promise<T>;
}): Promise<T> {
  return guardedRun(deps.preflight(), deps.runEvals);
}

/**
 * 花费账本：**只追加、不覆盖**，一行一趟（JSON Lines）。
 *
 * 为什么不是 `baselines/<line>.json`：那份是**最近一次**的跑分档案，每跑一次就被整份覆盖，
 * 拿它求和只会算到「每条线最后那一趟」——跑了三趟只记一趟的钱，「本段累计 $20」就名不副实。
 * 账本每成功跑一次追加一行，累计闸读它求和，所以三趟就是三趟的钱。
 */
export const SPEND_LEDGER = join(BASELINES_DIR, "spend.jsonl");

/**
 * 账本一行：哪条线、什么时候、哪个 commit、这一趟真花了多少。
 *
 * `failed: true` ＝ 这一趟中途炸了（判分器读不懂两次、单次预算闸拦下、网络断），
 * `costUsd` 记的是**炸到那一刻为止**已经真花掉的钱。没有档案可写不等于没花钱。
 */
export interface SpendEntry {
  line: EvalLine;
  date: string;
  commit: string;
  costUsd: number;
  failed?: boolean;
}

/**
 * 本段到今天为止**已记的真实花费**＝账本每一行 `costUsd` 之和。账本不存在算 0。
 *
 * 读不懂的一行当场炸：一个 fail closed 的闸不能把「读不懂」静默当成 0，
 * 那会让累计凭空变小、闸凭空放行。
 */
export function recordedSegmentUsd(ledgerPath: string): number {
  if (!existsSync(ledgerPath)) return 0;
  return readFileSync(ledgerPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .reduce((sum, line, i) => {
      let entry: SpendEntry;
      try {
        entry = JSON.parse(line) as SpendEntry;
      } catch {
        throw new Error(`${ledgerPath} 第 ${i + 1} 行读不懂，累计闸拒绝按 0 计：${line.slice(0, 120)}`);
      }
      if (typeof entry.costUsd !== "number" || !Number.isFinite(entry.costUsd)) {
        throw new Error(`${ledgerPath} 第 ${i + 1} 行的 costUsd 不是数字，累计闸拒绝按 0 计`);
      }
      return sum + entry.costUsd;
    }, 0);
}

/** 追加一行——只追加，从不改写既有的行（改写就等于把已经花掉的钱抹掉）。 */
export function appendSpend(ledgerPath: string, entry: SpendEntry): void {
  appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`);
}

/**
 * 花钱的那一趟外面这一层：**炸了也记账**，然后把错误原样抛回去。
 *
 * 从前只有跑完写档案那一路会追加账本行。可钱是一次调用一次地花出去的：第七题上判分器
 * 连读两次都读不懂、或者单次预算闸把这一趟拦停，前六题的钱已经付了，账本却一行都没有。
 * 累计闸下一次读到的数就偏小，于是「本段累计 $20」会被一趟趟失败悄悄花穿
 * （判官 2026-09-05 P2-1，方向是低估——正是 fail closed 最不能有的那个方向）。
 *
 * `spentUsd()` 读的是计费器**当下**的真实花费，所以记的是「炸到那一刻为止」的钱，
 * 不是估算、也不是 0。守卫拒跑那一档不经过这里（一分钱没花，不该在账本上留行）。
 */
export async function recordingSpend<T>(
  ledgerPath: string,
  meta: { line: EvalLine; commit: () => string; now: () => Date; spentUsd: () => number },
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    appendSpend(ledgerPath, {
      line: meta.line,
      date: meta.now().toISOString(),
      commit: meta.commit(),
      costUsd: meta.spentUsd(),
      failed: true,
    });
    throw err;
  }
}

/**
 * 纯：本次全跑的最坏花费估算——每题一次被测调用，有 rubric 的再加判分调用
 * （判分器读不懂会重试一次，所以按两次算）。产物长度未知，按被测输出上限当最坏。
 *
 * 只用于开跑前的累计闸；计费永远用真实用量。
 */
export function worstCaseRunUsd(
  tasks: readonly EvalTask[],
  parts: { system: string; judgeRubric: string; prices: TokenPrices },
): number {
  const systemTokens = estimateTokens(parts.system);
  const rubricTokens = estimateTokens(parts.judgeRubric);
  return tasks.reduce((sum, t) => {
    const promptTokens = estimateTokens(t.prompt);
    const subject = callCostUsd(
      { inputTokens: systemTokens + promptTokens, outputTokens: SUBJECT_MAX_OUTPUT },
      parts.prices,
    );
    if (t.rubric.length === 0) return sum + subject;
    const judgeInput =
      rubricTokens + promptTokens + SUBJECT_MAX_OUTPUT + estimateTokens(t.rubric.join("\n"));
    const judge = callCostUsd(
      { inputTokens: judgeInput, outputTokens: JUDGE_MAX_OUTPUT },
      parts.prices,
    );
    return sum + subject + judge * 2;
  }, 0);
}

/**
 * 纯：本次全跑最坏的那一份说明书 —— 逐题装一遍，取 token 估算最长的那一份，再拼台架后缀。
 *
 * ⑥段（ENGINE-A7）之后说明书是**每轮现装**的，每题装出来的不一样长；单体时代那句
 * `ottoInstructions + HARNESS_SUFFIX` 已经没有对应物。累计闸只许高估不许低估
 * （fail closed），所以这里取逐题装配里最长的那一份当上界：真跑的任何一题都不会比它贵。
 */
export function worstCaseSystem(tasks: readonly EvalTask[]): string {
  const worst = tasks
    .map((t) => assembleOttoInstructions(t.prompt).text)
    .reduce((a, b) => (estimateTokens(b) > estimateTokens(a) ? b : a), "");
  return worst + HARNESS_SUFFIX;
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
  return async (task) => {
    // ⑥段（ENGINE-A7）之后，被测的说明书是**这一轮装出来的那一份** —— 商家真正拿到的
    // 就是它。单体时代这里是 `ottoInstructions` 整份；台架后缀一个字没动，所以两次跑分
    // 比的仍是同一件事：同一道题、同一段后缀、Otto 的说明书换了组织方式。
    const system = assembleOttoInstructions(task.prompt).text + HARNESS_SUFFIX;
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
  const tolerancePoints = resolveTolerance(process.argv);
  const { tasksDir, baseline: BASELINE } = pathsFor(line);

  // 装题、读文件、估最坏花费——全都不花钱，都在守卫之前算好。
  const tasks = loadTasks(tasksDir, line);
  const model = OTTO_PRIMARY_MODEL;
  const budgetUsd = FULL_RUN_BUDGET_USD;
  const meter = new Meter(budgetUsd);
  const recordedUsd = recordedSegmentUsd(SPEND_LEDGER);
  // 本次最坏花费被单次硬上限截住：那一道会在超上限之前就地停，所以这一趟的真实上界就是它。
  const worstCaseUsd = Math.min(
    worstCaseRunUsd(tasks, {
      system: worstCaseSystem(tasks),
      judgeRubric: readFileSync(JUDGE_RUBRIC_PATH, "utf8"),
      prices: llmPricesFor(model),
    }),
    budgetUsd,
  );

  console.log(
    `${line} 线 ${tasks.length} 题，型号 ${model}，单次上限 $${budgetUsd}` +
      `（本段累计上限 $${SEGMENT_BUDGET_USD}：账本已记 $${recordedUsd.toFixed(4)}，本次最坏 $${worstCaseUsd.toFixed(4)}）`,
  );

  const archive = await runMain({
    preflight: () =>
      preflight({
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        apiKey: process.env.ANTHROPIC_API_KEY,
        check,
        baselineExists: existsSync(BASELINE),
        baselinePath: BASELINE,
        recordedUsd,
        worstCaseUsd,
        segmentBudgetUsd: SEGMENT_BUDGET_USD,
      }),
    runEvals: () =>
      recordingSpend(
        SPEND_LEDGER,
        { line, commit: commitSha, now: () => new Date(), spentUsd: () => meter.usd },
        () =>
          runEvals(tasks, makeSubject(model, meter), makeJudge(model, meter), {
            commit: commitSha(),
            subjectModel: model,
            judgeModel: model,
            budgetUsd,
            costUsd: () => meter.usd,
            now: () => new Date(),
          }),
      ),
  });
  // 钱已经花掉了——不管这一趟是写档案还是 --check，账本都要记上这一行。
  appendSpend(SPEND_LEDGER, {
    line,
    date: archive.date,
    commit: archive.commit,
    costUsd: archive.costUsd,
  });
  report(archive);

  if (!check) {
    writeFileSync(BASELINE, `${JSON.stringify(archive, null, 2)}\n`);
    console.log(`档案已写 ${BASELINE}`);
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as EvalArchive;
  const { regressed, delta } = compareToBaseline(baseline.total, archive.total, tolerancePoints);
  console.log(
    `基线 ${(baseline.total * 100).toFixed(1)}%（${baseline.date}，commit ${baseline.commit.slice(0, 8)}）` +
      ` → 本次 ${(archive.total * 100).toFixed(1)}%，差 ${(delta * 100).toFixed(1)} 个百分点` +
      `（噪声容差 ±${tolerancePoints} 个百分点${tolerancePoints === REGRESSION_TOLERANCE_POINTS ? "" : "，--tolerance= 覆盖"}）`,
  );
  if (regressed) {
    console.error(`回归：总分低于基线超过容差 ±${tolerancePoints} 个百分点。`);
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
