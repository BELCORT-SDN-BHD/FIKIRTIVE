/**
 * 跑一遍评测集：机械检查先行，模型只判它判得了的那部分，每一次判定连同产物入档。
 *
 * 被测对象（subject）与判分器（judge）都是**注入**进来的 —— 所以行为测试可以用 mock
 * 跑完整条路，一分钱不花（ENGINE-A1 的测试正是这么跑的），而 `runner.ts` 注入真调用。
 */
import {
  EvalBudgetExceeded,
  scoreTask,
  totalScore,
  type EvalArchive,
  type EvalTask,
  type JudgeVerdict,
  type TaskResult,
} from "./core.js";
import { runCheck } from "./checks/index.js";

/** 被测对象：商家人话 → 产物。真身是一次带 Otto 说明书的模型调用。 */
export type Subject = (task: EvalTask) => Promise<string>;
/** 判分器：产物 + 判分维度 → 逐维判词。维度为空时**根本不调用**（省钱也省噪声）。 */
export type Judge = (task: EvalTask, artifact: string) => Promise<JudgeVerdict[]>;

export interface RunMeta {
  commit: string;
  subjectModel: string;
  judgeModel: string;
  budgetUsd: number;
  /** 本次真实花费；由 runner 在跑完后从计费器读。 */
  costUsd: () => number;
  now: () => Date;
}

export async function runEvals(
  tasks: EvalTask[],
  subject: Subject,
  judge: Judge,
  meta: RunMeta,
): Promise<EvalArchive> {
  if (tasks.length === 0) throw new Error("一题都没有——评测集是空的");
  const line = tasks[0]!.line;
  const results: TaskResult[] = [];

  for (const task of tasks) {
    const artifact = await subject(task);
    // 机械检查先行：确定性、零成本、零模型。它们判得了的事永远不进模型。
    const checks = task.checks.map((spec) => runCheck(spec, artifact));
    // 只有机械检查判不了的那部分（rubric 维度）才交模型。
    const verdicts = task.rubric.length > 0 ? await judge(task, artifact) : [];
    const { points, maxPoints, score } = scoreTask(checks, verdicts);
    results.push({ id: task.id, artifact, checks, judge: verdicts, score, points, maxPoints });
  }

  const { total, points, maxPoints } = totalScore(results);
  return {
    line,
    date: meta.now().toISOString(),
    commit: meta.commit,
    subjectModel: meta.subjectModel,
    judgeModel: meta.judgeModel,
    costUsd: Number(meta.costUsd().toFixed(6)),
    budgetUsd: meta.budgetUsd,
    total,
    points,
    maxPoints,
    tasks: results,
  };
}

export { EvalBudgetExceeded };
