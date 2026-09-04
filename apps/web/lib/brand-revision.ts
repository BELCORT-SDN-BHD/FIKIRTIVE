import "server-only";
import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";

/**
 * brand-revision —— FRONT-A8 里「每条显示**谁改的**、何时改的」的那半个答案。
 *
 * 今天 `Memory.source` / `BrandRecord.source` 只有 `'otto' | 'user'` 两个值:答得出
 * 「是不是 Otto 动的」,答不出「是谁」。`updatedAt` 已经答得出「何时」。所以这里补的是
 * **人**,以及一条只追加的改动史(`BrandContextRevision`) —— 在这之前,一条记录只有
 * `deletedAt` ＋ restore,答得出「它还在不在」,答不出「它被改成什么样了」。
 *
 * 这个模块**不是** Server Action(没有 "use server"):它是给 `memory-actions.ts` 与
 * `brand-record-actions.ts` 两条真实写路径共用的内部件。
 *
 * 说清楚边界(判官 P1-3):**商家在这一面做的每一个动作**都走这两个模块,历史因此只有
 * 这一处写法。但 Otto 有它自己的写路径 —— `packages/otto/src/skills/remember-brand-fact.ts`
 * 与 `_brand-record.ts` 直接 `prisma.memory.create` / `brandRecord.create`,写 `source:"otto"`,
 * 不经过这里(主干既有,本段没有改动它)。所以 Otto 写下的行没有 `updatedById`、也没有
 * 改动史;读模型 `brand-context-data.ts` 靠 `source` 这一列把它们照实说成 Otto 写的,
 * 而不是说成「不知道是谁」。要让 Otto 的写也留下历史,得改 packages/otto 的写路径 ——
 * 那不在本段写集里。
 */

export type BrandActor = { userId: string | null; label: string };

/** 显示名缺失时的中性说法(判官 P2-6)。英文 sentence case,与这一面其他文案同口径。 */
export const ANONYMOUS_ACTOR_LABEL = "a teammate";

/** 把一次已经通过闸的会话变成「谁」。拿不到 User 行时留空 id、用邮箱当标签 —— 编一个
 *  id 比留空更糟:历史行会指向一个不存在的人。 */
export async function resolveActor(email: string): Promise<BrandActor> {
  // 邮箱**原样**查,与刚刚放行这次调用的 `requireOwner` 用同一条口径。
  // (`requireRole` 那条路径会 lowercase;两处不一致时,这里跟着已经通过的那道闸走,
  //  否则大小写不同的一个真实账号会被查成「查无此人」,历史里就再也没有名字。)
  const user = await prisma.user
    .findUnique({ where: { email }, select: { id: true, name: true } })
    .catch(() => null);
  // 判官 P2-6:显示名缺不能拿邮箱顶上 —— 改动史与「Updated by …」都是给同工作区其他人
  // 看的,一条私人邮箱不该因为某人没填过名字就出现在别人的屏幕上。中性词说的是真话
  // (我们知道是工作区里的人,不知道他叫什么),而且不泄露任何东西。
  const label = user?.name?.trim() || ANONYMOUS_ACTOR_LABEL;
  return { userId: user?.id ?? null, label };
}

/**
 * 「谁改的」只在**认得出人**的时候才写(判官 P2-4)。
 *
 * `resolveActor` 查不到 User 行时 `userId` 是 null。把 null 写进 `updatedById`,
 * 等于用一次删除或恢复把这一行已知的作者抹掉 —— 商家看到的会从「Updated by Nadia」
 * 退回成「we don't have a record of who」。认不出人时就什么都不写。
 */
export function actorStamp(actor: BrandActor): { updatedById?: string } {
  return actor.userId ? { updatedById: actor.userId } : {};
}

export type BrandRevisionAction =
  | "created" | "updated" | "deleted" | "restored" | "confirmed" | "discarded";

/**
 * 追加一行改动史。**尽力而为**:历史写失败绝不把商家已经成功的保存变成失败
 * (那会用一个日志问题去毁一件真事)。
 *
 * 幂等靠 `(ownerId, targetKind, targetId, revisionKey)` 的唯一约束:`revisionKey` 由
 * 「动作 ＋ 这一行这一次的 updatedAt」拼成,所以同一次保存被重放(双击、网络重试、
 * Server Action 重发)只会留下一行,而不会把一次修改讲成三次。
 */
export async function recordBrandRevision(args: {
  ownerId: string;
  targetKind: "memory" | "record";
  targetId: string;
  action: BrandRevisionAction;
  stamp: Date;
  actor: BrandActor;
  summary: string;
}): Promise<void> {
  const { ownerId, targetKind, targetId, action, stamp, actor, summary } = args;
  await prisma.brandContextRevision
    .create({
      data: {
        id: newId(),
        ownerId,
        targetKind,
        targetId,
        action,
        revisionKey: `${action}:${stamp.toISOString()}`,
        changedById: actor.userId,
        changedByLabel: actor.label,
        summary,
      },
    })
    .catch(() => {});
}

/** 一次写之后把这一行的 `updatedAt` 读回来 —— 它是改动史幂等键的可变半段。
 *  `updateMany` 不返回行,所以这一读是必须的;读失败退回到「现在」:历史宁可多一行,
 *  也不该让商家一次成功的保存变成失败。 */
export async function stampOf(
  ownerId: string,
  id: string,
  kind: "memory" | "record",
): Promise<Date> {
  const row =
    kind === "memory"
      ? await prisma.memory.findFirst({ where: { id, ownerId }, select: { updatedAt: true } }).catch(() => null)
      : await prisma.brandRecord.findFirst({ where: { id, ownerId }, select: { updatedAt: true } }).catch(() => null);
  return row?.updatedAt ?? new Date();
}

export type BrandRevisionRow = {
  action: BrandRevisionAction;
  changedByLabel: string;
  summary: string;
  changedAt: Date;
};

/** 一条记录的改动史,新的在前。永远带 ownerId —— 历史与记录本身是同一条租户边界。 */
export async function listBrandRevisions(
  ownerId: string,
  targetKind: "memory" | "record",
  targetId: string,
): Promise<BrandRevisionRow[]> {
  const rows = await prisma.brandContextRevision.findMany({
    where: { ownerId, targetKind, targetId },
    orderBy: { changedAt: "desc" },
    take: 20,
    select: { action: true, changedByLabel: true, summary: true, changedAt: true },
  });
  return rows as BrandRevisionRow[];
}

/** 一批 `updatedById` → 商家看得懂的名字。一次查询,不在列表里逐行 N+1。 */
export async function labelsForUserIds(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const users = await prisma.user
    .findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } })
    .catch(() => []);
  // 同 `resolveActor`(判官 P2-6):没有显示名就用中性词,不把邮箱摆到别人面前。
  return new Map(users.map((u) => [u.id, u.name?.trim() || ANONYMOUS_ACTOR_LABEL]));
}
