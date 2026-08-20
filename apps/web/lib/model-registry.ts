import "server-only";
import { prisma } from "@fikirtive/db";
import { FOUNDER_OWNER_ID, knownDisabledSet } from "@fikirtive/core";

/**
 * 开关状态**读不到**时给商家的那句话(#647 T6 修复轮 P1-3)。
 *
 * 刻意与「被关掉」那一句(`generationUnavailableMessage`)分开:一个是「有人把它关了」,
 * 一个是「我们现在不知道」。把后者说成前者,商家会去找管理员开开关,而其实什么都没关。
 * English sentence case;不出现任何引擎/供应商名。
 */
export const MODEL_REGISTRY_UNAVAILABLE = "Generation is temporarily unavailable — please try again in a moment.";

/**
 * 后台关掉的模型 id(overlay 里 enabled=false 的行)。读是**不缓存**的,所以一次紧急下架
 * 立刻生效(与 P1a 的 runtime-config 读同一条规矩)。
 *
 * **返回 `{ error }` = 读不到,不是「什么都没关」**(#647 T6 修复轮 P1-3)。
 *
 * 这一行以前吞掉一切 DB 错误回空集合,注释还把它写成一条特性(fail-closed-to-typed-menu)。
 * 那个说法混了两件事:typed menu 能回答「这个模型存不存在」,回答不了「这个模型现在允不允许
 * 卖」—— 后者**只有**这张 overlay 表能回答。于是「库里全禁用 + 这次查询恰好抖了一下」的
 * 那一刻,Otto/分镜会铸出付费卡,startGen 会放行扣款:开关成了一个查询一抖就自动打开的锁。
 *
 * 钱路的规矩这个仓库已经裁过(#652/#657 同族):**结果不明就不许前进**。所以这里如实报
 * 「不知道」,由每个入口翻译成「暂时做不了」的诚实空态 —— 返回联合类型而不是抛,是为了让
 * 编译器逼着每一个调用点当场表态(和 `suggestModel` 返回 null 同一手法)。
 *
 * **与 `apps/worker/src/model-registry.ts` 的 `workerDisabledModels` 是同一张表、故意不同的
 * 失败语义,不要合并**:这一侧站在商家面前,读不到时正确的动作是**当场说人话**(诚实空态),
 * 所以返回 `{ error }`;那一侧站在已排队任务前面,读不到时正确的动作是**别往下走**(抛 PLAIN
 * → handleGen requeue、预扣挂着、零花费)。合成一个函数就得有一方改行为:让这一侧抛,商家会
 * 撞上一个没人翻译的异常;让那一侧回 `{ error }`,worker 就多了一条可以被忽略的返回值。
 */
export async function resolveDisabledModels(): Promise<{ disabled: Set<string> } | { error: string }> {
  try {
    const rows = await prisma.modelRegistryOverlay.findMany({
      where: { ownerId: FOUNDER_OWNER_ID, enabled: false },
      select: { modelId: true },
    });
    return { disabled: knownDisabledSet(rows.map((r) => r.modelId)) };
  } catch (e) {
    console.error("resolveDisabledModels DB read failed — refusing to treat it as 'nothing disabled':", e instanceof Error ? e.message : e);
    return { error: MODEL_REGISTRY_UNAVAILABLE };
  }
}
