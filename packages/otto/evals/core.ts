/**
 * 评测骨架的纯部分：一题一文件的 front-matter 契约、判分、花费估算与预算闸、档案比对。
 *
 * 这里**没有任何 I/O、没有任何模型调用**——全是纯函数，所以行为测试跑它一分钱都不花。
 * 契约见 `docs/specs/otto-engine.md` §7.3（两条线共用同一份 front-matter 与同一个 runner）。
 */

/** 一题一文件的 front-matter 契约（§7.3；engine 与 creation 两条线共用）。 */
export interface EvalTask {
  /** 逐字等于验收编号，或 `<line>-<n>`。 */
  id: string;
  line: "engine" | "creation";
  /** 商家人话——原样送给被测对象，runner 不改一个字。 */
  prompt: string;
  /** 要跑哪几个机械检查（`checks/` 注册表里的名字，可带 `:参数`）。 */
  checks: string[];
  /** 判分维度，交给 judge.md。机械检查判得了的事**不进**这里。 */
  rubric: string[];
  /** front-matter 之后的正文：给人读的出题理由。runner 不认得它。 */
  notes: string;
}

export interface CheckResult {
  name: string;
  pass: boolean;
  reason: string;
}

/** judge 对一个 rubric 维度的判定。0=没做到 / 1=部分 / 2=做到了。 */
export interface JudgeVerdict {
  dimension: string;
  score: 0 | 1 | 2;
  reason: string;
}

export interface TaskResult {
  id: string;
  /** 被测对象这一趟的产物。判定要能复核，就得连产物一起存（§7.3「判分的诚实口径」）。 */
  artifact: string;
  checks: CheckResult[];
  judge: JudgeVerdict[];
  /** 得分（0–1）。 */
  score: number;
  points: number;
  maxPoints: number;
}

export interface EvalArchive {
  line: "engine" | "creation";
  date: string;
  commit: string;
  subjectModel: string;
  judgeModel: string;
  /** 本次真实花费（按真实 token 用量 × 价目表算）。 */
  costUsd: number;
  budgetUsd: number;
  total: number;
  points: number;
  maxPoints: number;
  tasks: TaskResult[];
}

// ── front-matter ────────────────────────────────────────────────────────────

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * 纯：一题一文件 → EvalTask。
 *
 * 支持的 YAML 子集，刻意只有两种形状（多一种就要背一个 YAML 解析器的全部歧义）：
 *   `key: 单行值`
 *   `key:` 之后每行 `  - 一项`
 * `prompt` 是单行值：商家一句人话，本来就不该是一段文档。
 */
export function parseTask(source: string, where: string): EvalTask {
  const m = FRONT_MATTER.exec(source);
  if (!m) throw new Error(`${where}: 缺 front-matter（文件必须以 --- 开头、以 --- 收尾）`);
  const scalars = new Map<string, string>();
  const lists = new Map<string, string[]>();
  let current: string | null = null;

  for (const raw of m[1]!.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item) {
      if (!current) throw new Error(`${where}: 列表项 "${item[1]}" 没有归属的键`);
      lists.get(current)!.push(unquote(item[1]!.trim()));
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(raw);
    if (!kv) throw new Error(`${where}: 读不懂这一行 front-matter：${raw}`);
    const [, key, value] = kv as unknown as [string, string, string];
    if (value.trim() === "") {
      current = key;
      lists.set(key, []);
    } else {
      current = null;
      scalars.set(key, unquote(value.trim()));
    }
  }

  const id = scalars.get("id");
  const line = scalars.get("line");
  const prompt = scalars.get("prompt");
  if (!id) throw new Error(`${where}: 缺 id`);
  if (line !== "engine" && line !== "creation") throw new Error(`${where}: line 必须是 engine 或 creation`);
  if (!prompt) throw new Error(`${where}: 缺 prompt`);
  const checks = lists.get("checks") ?? [];
  const rubric = lists.get("rubric") ?? [];
  if (checks.length === 0 && rubric.length === 0) {
    throw new Error(`${where}: checks 与 rubric 不能都是空的——那样这题判不出任何分`);
  }
  return { id, line, prompt, checks, rubric, notes: (m[2] ?? "").trim() };
}

function unquote(v: string): string {
  const q = /^"([\s\S]*)"$/.exec(v) ?? /^'([\s\S]*)'$/.exec(v);
  return q ? q[1]! : v;
}

// ── 判分 ────────────────────────────────────────────────────────────────────

/**
 * 纯：一题的分。
 *
 * 机械检查一条 1 分（确定性、零成本、零模型）；judge 的一个维度满分 2 分，折成 1 分。
 * 「机械检查先行」在这里是字面意思：机械检查那几分**永远不经过模型**，
 * 模型只判它判得了的那部分（rubric 维度），且判词与产物一起入档。
 */
export function scoreTask(checks: CheckResult[], judge: JudgeVerdict[]): {
  points: number;
  maxPoints: number;
  score: number;
} {
  const maxPoints = checks.length + judge.length;
  if (maxPoints === 0) return { points: 0, maxPoints: 0, score: 0 };
  const mechanical = checks.filter((c) => c.pass).length;
  const judged = judge.reduce((sum, v) => sum + v.score / 2, 0);
  const points = mechanical + judged;
  return { points, maxPoints, score: points / maxPoints };
}

/** 纯：总分＝各题得分的平均（每题等权，题数变了总分仍可比）。 */
export function totalScore(tasks: TaskResult[]): { total: number; points: number; maxPoints: number } {
  if (tasks.length === 0) return { total: 0, points: 0, maxPoints: 0 };
  const points = tasks.reduce((s, t) => s + t.points, 0);
  const maxPoints = tasks.reduce((s, t) => s + t.maxPoints, 0);
  return { total: tasks.reduce((s, t) => s + t.score, 0) / tasks.length, points, maxPoints };
}

// ── 花费与预算闸 ────────────────────────────────────────────────────────────

/** 单次全跑的硬上限（`docs/specs/otto-engine.md` §7.7 建议值）。超了就停，不是警告。 */
export const FULL_RUN_BUDGET_USD = 10;
/**
 * 本段累计预算（§7.7）。**是真闸，不是记账口径**：开跑之前 runner 把 `baselines/` 里
 * 每一份档案的 `costUsd` 加起来，再加上本次全跑的最坏花费，超过它就拒跑（一分钱不花）。
 * 见 `runner.ts` 的 `recordedSegmentUsd` / `worstCaseRunUsd` / `preflight`。
 */
export const SEGMENT_BUDGET_USD = 20;

export interface TokenPrices {
  inputPerToken: number;
  outputPerToken: number;
}

/** 纯：一次调用的美元花费。 */
export function callCostUsd(
  usage: { inputTokens: number; outputTokens: number },
  prices: TokenPrices,
): number {
  return usage.inputTokens * prices.inputPerToken + usage.outputTokens * prices.outputPerToken;
}

/**
 * 纯：粗估 token 数。只用于**开跑前**的最坏估算，从不用于计费（计费永远用真实用量）。
 *
 * 「4 字符 ≈ 1 token」是**英文**口径。这个闸的输入端常常是整份华语文件
 * （`judge.md` 与题目的华语 rubric 就是），而华语大致 1–2 token/字 ——
 * 拿英文口径去估华语，最坏情况会被低估好几倍。一个自称 fail closed 的闸不能用乐观口径估最坏，
 * 所以这里按 CJK 与非 CJK 分档：CJK 每字算 2，其余仍按 4 字符 1 token。
 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/gu) ?? []).length;
  return Math.ceil(cjk * 2 + (text.length - cjk) / 4);
}

/**
 * 纯：预算看门人。每次模型调用**之前**问它一次。
 *
 * fail closed：已花的 + 这一次的最坏情况超过上限，就停 —— 不是「跑完再说」。
 */
export function budgetGate(spentUsd: number, worstCaseNextUsd: number, budgetUsd: number): {
  ok: boolean;
  reason: string;
} {
  const projected = spentUsd + worstCaseNextUsd;
  if (projected > budgetUsd) {
    return {
      ok: false,
      reason:
        `预算闸：已花 $${spentUsd.toFixed(4)} + 这一次最坏 $${worstCaseNextUsd.toFixed(4)} ` +
        `= $${projected.toFixed(4)} > 上限 $${budgetUsd.toFixed(2)}，就地停。`,
    };
  }
  return { ok: true, reason: "" };
}

/** 预算耗尽时抛它——runner 据此停跑并非零退出。 */
export class EvalBudgetExceeded extends Error {}

// ── 基线比对 ────────────────────────────────────────────────────────────────

/** 浮点比较的容差：判分本身有噪声，回归判定不该被第 12 位小数触发。 */
export const REGRESSION_EPSILON = 1e-9;

/** 纯：`--check` 的判词。总分低于基线即回归（⑥段「不低于基线」用的也是这一句）。 */
export function compareToBaseline(baselineTotal: number, currentTotal: number): {
  regressed: boolean;
  delta: number;
} {
  const delta = currentTotal - baselineTotal;
  return { regressed: delta < -REGRESSION_EPSILON, delta };
}
