/**
 * gen-thread-redelivery —— 一次已经结束的生成，它那条**对话里的结果**没写成功时的补投。
 *
 * ## 为什么有这个文件
 *
 * 结果那一条(GEN_RESULT / TURN_ERROR)由 `gen.ts` 的 `appendCoworkResult` 写，而它是
 * **best-effort**：写不成就吞掉，理由是「一次已经收了钱的交付，不许被一条聊天消息写失败
 * 弄崩」。那条纪律没错，错的是它后面什么都没有 —— 作业已经 DONE，pg-boss 不会再投递它、
 * 收尸器也不再看它，于是那条对话就永远停在「making this…」上：商家付了钱、图也真的出来了，
 * 对话里却一个字都没有，刷新也没有。画布节点级那几条付费路(Founder 2026-09-04 20:45 裁决)
 * 现在把请求与确认写进同一条对话，缺了结果这一半就更明显。
 *
 * 这就是「写不成还可以再写一次」实际指的东西 —— 形状照抄画布那一条
 * (`canvas-backfill.ts`：同一个 reaper tick、跨租户扫描、按行进租户写)。
 *
 * ## 它绝不碰什么
 *
 * 不碰钱：不读写 ledger、不 reserve / settle / refund、不改任何 GenJob 状态列、不打供应商。
 * 它只做一件事 —— 把那条本来就该在的消息补上。exactly-once 由 `ChatMessage(genJobId)`
 * 那个部分唯一索引保证(kind ∈ GEN_RESULT/TURN_ERROR)：与原交付路撞车时 P2002 回滚，
 * 第二条消息不可能出现。
 *
 * ## 它刻意不补的两种
 *
 *  - **CANCELLED**：那条消息带着 `{ cancelled: true }` 这个耳记(`cowork-actions.ts`)，
 *    只有按下取消的那条路知道它。这里补一条普通的失败消息，就是把商家「我自己停的」
 *    改写成「我们没做成」—— 宁可不写。诚实口径(#1239 判官 P2-2)：它**连日志都没有**，
 *    因为扫描的 `status` 只收 DONE / FAILED(`REDELIVERABLE_STATUSES`)，取消的行压根
 *    不进候选 —— 不是「看到了、记下来、不补」。
 *  - **DONE 但一件产出都没有**：这一行到底算交付还是算失败，只有当时那条路说得清。
 *    猜一个说法比不说更糟 —— 这一种是看到了才跳过的，所以照实记进日志(`console.error`)，
 *    不静默丢。
 */
import { prisma } from "@fikirtive/db";
import { runAsTenant } from "@fikirtive/db/principal";
import { sanitizeError } from "../redact.js";
import { appendCoworkResult, genThreadResultCredits } from "./gen.js";

/** 刚结束的作业先放着：它自己的交付路多半正在写那条消息。 */
export const GEN_THREAD_REDELIVERY_GRACE_MS = 2 * 60_000;
/**
 * 往回看多久。补投是给「那一次写库失败了」兜底的，不是给历史数据做迁移的：
 * 一天之内没被补上的，多半是那条线程本身出了别的问题，继续每 5 分钟重试它没有意义。
 */
export const GEN_THREAD_REDELIVERY_MAX_AGE_MS = 24 * 60 * 60_000;
/**
 * 一轮最多**看**多少行。诚实口径：这是一个上界，不是一句「一定看得完」——
 * 一天里终结的、带线程的付费作业超过这个数时，这一轮只看得到最新的那一批。
 * 补投本身极少发生(要先有一次写库失败)，所以这个上界买的是「一轮扫描的成本有界」。
 */
export const GEN_THREAD_REDELIVERY_SCAN_BATCH = 500;
/** 一轮最多**补**多少条 —— 与画布那条同一条纪律：别把共用的 reaper tick 吃光。 */
export const GEN_THREAD_REDELIVERY_LIMIT = 50;

const REDELIVERABLE_STATUSES = ["DONE", "FAILED"] as const;

/**
 * 把每一条「作业已经结束、对话里却没有结果」的补上。返回这一轮真的补了几条(平常是 0)。
 *
 * 跑在 worker 的 reaper tick 里(那一层已经带着系统身份)；每一条补投按它自己那行的租户
 * 重新进入(#463 两段式：跨租户扫描、按 owner 写)。
 */
export async function redeliverGenThreadResults(now: Date = new Date()): Promise<number> {
  // 扫描也包在 try 里：这一轮的查询炸了，绝不能把后面那几条退款/回收扫描一起带走
  // (canvas-backfill 的 #601 r2 判官 P2③ 同一个教训)。
  let candidates: Awaited<ReturnType<typeof scanTerminalThreadJobs>> = [];
  try {
    candidates = await scanTerminalThreadJobs(now);
  } catch (e) {
    console.error("[gen-thread-redelivery] scan failed (retries next sweep):", sanitizeError(e));
    return 0;
  }
  if (candidates.length === 0) return 0;

  let delivered: Set<string>;
  try {
    const rows = await prisma.chatMessage.findMany({
      where: {
        genJobId: { in: candidates.map((j) => j.id) },
        kind: { in: ["GEN_RESULT", "TURN_ERROR"] },
      },
      select: { genJobId: true },
    });
    delivered = new Set(rows.map((r) => r.genJobId).filter((id): id is string => !!id));
  } catch (e) {
    console.error("[gen-thread-redelivery] delivered-set read failed (retries next sweep):", sanitizeError(e));
    return 0;
  }

  let repaired = 0;
  for (const job of candidates) {
    if (repaired >= GEN_THREAD_REDELIVERY_LIMIT) break;
    if (delivered.has(job.id)) continue;
    if (!job.threadId) continue;
    if (job.status === "DONE" && job.generationIds.length === 0) {
      // 说不清的那一种 —— 记下来，不猜。
      console.error(`[gen-thread-redelivery] ${job.id}: DONE with no outputs and no thread message — left for a human`);
      continue;
    }
    try {
      // 回调是承重的：Prisma 的 promise 是懒发起的，直接返回会在查询真的跑起来之前
      // 就把租户帧弹掉(canvas-backfill 同一条)。
      await runAsTenant(job.ownerId, async () => {
        if (job.status === "DONE") {
          await appendCoworkResult(job, "GEN_RESULT", job.generationIds, "", genThreadResultCredits(job));
        } else {
          await appendCoworkResult(
            job,
            "TURN_ERROR",
            [],
            "I couldn't finish that one — and you weren't charged. Want to try again?",
          );
        }
      });
      repaired += 1;
    } catch (e) {
      console.error(`[gen-thread-redelivery] ${job.id}: redelivery failed (retries next sweep):`, sanitizeError(e));
    }
  }
  return repaired;
}

/** 这一轮的候选行：带线程、已经终结、还在回看窗口里的付费作业。只读。 */
async function scanTerminalThreadJobs(now: Date) {
  return prisma.genJob.findMany({
    where: {
      threadId: { not: null },
      status: { in: [...REDELIVERABLE_STATUSES] },
      finishedAt: {
        gte: new Date(now.getTime() - GEN_THREAD_REDELIVERY_MAX_AGE_MS),
        lt: new Date(now.getTime() - GEN_THREAD_REDELIVERY_GRACE_MS),
      },
    },
    orderBy: { finishedAt: "desc" },
    take: GEN_THREAD_REDELIVERY_SCAN_BATCH,
    select: {
      id: true,
      ownerId: true,
      threadId: true,
      kind: true,
      model: true,
      status: true,
      count: true,
      generationIds: true,
      referenceVideoGenerationId: true,
      videoOptions: true,
    },
  });
}
