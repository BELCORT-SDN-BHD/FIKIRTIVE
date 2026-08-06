import { prisma } from "@fikirtive/db";
import { FOUNDER_OWNER_ID, knownDisabledSet } from "@fikirtive/core";

/** Worker-side admin-disabled model ids. This check exists to catch a job that was
 *  QUEUED before an emergency disable — it is the last gate before the spend claim.
 *
 *  **读不到就抛**(#647 T6 修复轮 P1-3)。这一行以前吞掉一切 DB 错误回空集合,注释还把它
 *  写成一条特性(「配置读取抖一下不许挡住已排队的任务」)。那句话混了两件事:typed menu
 *  能回答「这个模型存不存在」,回答不了「这个模型现在允不允许卖」—— 后者**只有**这张
 *  overlay 表能回答。于是「库里全禁用 + 这次查询恰好抖了一下」的那一刻,worker 会走过这道
 *  闸、claim、调 provider,**真的把钱花出去**。网页侧读错最多是白高兴一场;这一侧花掉的是钱。
 *
 *  抛出来的是 **PLAIN**(不带 `charged` 标记)—— #664 已裁的两类失败语义里,这属于「花钱
 *  之前的故障」:handleGen 会 requeue,预扣继续挂着,零花费;重试用尽才终态 + 退款。
 *  配置查询抖一下正是典型的瞬时故障,重投是对的;静默继续花钱不是。
 *
 *  错误信息**不带**底层驱动原文:它会被 pg-boss 序列化进 job.output,连接串/口令之类
 *  不该落在那里(与 handleGen 重抛时 sanitize 同一条理由)。
 *
 *  #463: intentionally NOT wrapped in a principal frame. ModelRegistryOverlay is platform-wide
 *  founder config (tenant-guard-exempt), and this runs INSIDE a tenant-scoped gen handler —
 *  wrapping it would either re-label platform config as tenant data or shadow the caller's
 *  scope. It reads the ambient frame it happens to run in and never widens it. Do not flag it
 *  as a missing system context. */
export async function workerDisabledModels(): Promise<Set<string>> {
  try {
    const rows = await prisma.modelRegistryOverlay.findMany({
      where: { ownerId: FOUNDER_OWNER_ID, enabled: false },
      select: { modelId: true },
    });
    return knownDisabledSet(rows.map((r) => r.modelId));
  } catch (e) {
    console.error("[worker] workerDisabledModels DB read failed — refusing to run without the switch state:", e instanceof Error ? e.message : e);
    throw new Error("model registry unavailable — not spending until the switch state can be read");
  }
}
