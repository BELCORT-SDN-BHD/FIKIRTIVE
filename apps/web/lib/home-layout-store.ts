import "server-only";

/**
 * `OrgHomeLayout` 的读写与那道能力闸(规格 docs/specs/frontend-baseline.md §7.3⑤,验收 FRONT-A4)。
 *
 * 为什么单独一层而不是塞进 `-actions`:读这一行的是**服务端渲染**(`HomeEntry`),写它的是
 * 一个 server action。两者共用同一份 where 条件与同一道能力判定,而 `"use server"` 模块的
 * 每一个导出都是一个对外端点 —— 把只读函数放进去等于凭空多开一个可被调用的入口。
 * 所以事实层留在这里(纯 server-only 模块),端点层只在 `home-layout-actions.ts`。
 *
 * 租户口径:ownerId 一律来自 `requireOwner()` 的服务端 principal,每一次查询都显式带上它。
 * `OrgHomeLayout` 同时登记在 `packages/db/src/tenant-guard.ts` 的 TENANT_MODELS 里,
 * 所以就算这里漏了一次,运行时守卫也会当场拒绝,而不是安静地跨租户读一行。
 */

import { prisma } from "@fikirtive/db";
import { FOUNDER_OWNER_ID, newId } from "@fikirtive/core";

import { isFounderAdmin } from "@/lib/allowlist";
import { requireOrgPermission, type OwnerGate } from "@/lib/org-role-guard";
import { isHomeComponentId, type SavedHomeLayout } from "@/lib/home-layout";
import type { HomeComponentId } from "@/design-system/patterns/founder-home/model";

/**
 * 这个人能不能改这个工作区的 Home 版面。
 *
 * 判的是能力 `workspace.manage_home`,不是角色名字(项目指南「Permission-based access」):
 * 一个人可以同时是 creator 与 approver,能不能改版面只看有没有那一条能力。
 *
 * **founder-admin 那一支**:`requireOwner()` 是唯一能返回 `ownerId === "founder"` 的地方,
 * 而它走的正是 `isFounderAdmin(email)` 这一支 —— 那个会话按构造在 founder org 里**没有**
 * Membership 行(见 auth-guard.ts `resolveUserPrincipal` 的 MEMBERSHIP MISS 一节)。
 * 拿「查不到 membership」当「没有权限」会把 Founder 自己锁在 Customize home 外面,
 * 那是把一个已知的建模缺口误读成一次拒绝。所以这一支显式放行,而且**两个条件都要满足**
 * (ownerId 是 founder 且这个邮箱真的是 founder-admin),不靠单一条件推另一个。
 */
export async function canManageHome(gate: OwnerGate): Promise<boolean> {
  if (gate.ownerId === FOUNDER_OWNER_ID && isFounderAdmin(gate.email)) return true;
  const access = await requireOrgPermission(gate, "workspace.manage_home");
  return !("error" in access);
}

/** 这个工作区保存过的版面;没保存过、或这一刻读不出来,都返回 null(=走推荐模板)。 */
export async function readHomeLayout(ownerId: string): Promise<SavedHomeLayout | null> {
  const row = await prisma.orgHomeLayout
    .findUnique({
      where: { ownerId },
      select: { componentIds: true, hiddenIds: true },
    })
    .catch(() => null);
  if (!row) return null;
  return { componentIds: row.componentIds, hiddenIds: row.hiddenIds };
}

/**
 * 落一行版面。**upsert 压在 `ownerId` 的唯一约束上**,不是「先查后建」:两个管理员同时按
 * Save 时,后者更新前者那一行,而不是插出第二行让「刷新之后版面还在」变成掷骰子。
 */
export async function writeHomeLayout(input: {
  ownerId: string;
  componentIds: readonly HomeComponentId[];
  hiddenIds: readonly HomeComponentId[];
  updatedById: string | null;
}): Promise<void> {
  const componentIds = input.componentIds.filter(isHomeComponentId);
  const hiddenIds = input.hiddenIds.filter(isHomeComponentId);
  await prisma.orgHomeLayout.upsert({
    where: { ownerId: input.ownerId },
    create: {
      id: newId(),
      ownerId: input.ownerId,
      componentIds,
      hiddenIds,
      updatedById: input.updatedById,
    },
    update: { componentIds, hiddenIds, updatedById: input.updatedById },
  });
}

/** 写入时记「谁改的」用的 User.id;查不到就记 null —— 记不清是谁,好过记一个猜的。 */
export async function actingUserId(email: string): Promise<string | null> {
  const user = await prisma.user
    .findUnique({ where: { email }, select: { id: true } })
    .catch(() => null);
  return user?.id ?? null;
}
