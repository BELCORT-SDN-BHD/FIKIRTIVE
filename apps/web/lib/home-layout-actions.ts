"use server";

/**
 * Home 版面的**唯一写入动作**(规格 docs/specs/frontend-baseline.md §7.3⑤,验收 FRONT-A4)。
 *
 * 人工 UI(Customize home 面板的 Save)走这里;将来 Otto 要改版面也走这里,不另写一套业务实现
 * (项目指南「Shared actions」)。所以校验、能力闸、租户口径都长在这个函数里,而不是在客户端。
 *
 * 这个文件里**不写 `export type`**:`"use server"` 模块的类型再导出会让 `next build` 在运行时
 * 炸 ReferenceError,而 typecheck 与全部单元测试都是绿的(仓库既有实证,#741 已装围栏)。
 * 类型住在 `lib/home-layout.ts`(纯层)。
 */

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import { availableHomeComponents, homeLayoutWrite, isHomeComponentId } from "@/lib/home-layout";
import { actingUserId, canManageHome, writeHomeLayout } from "@/lib/home-layout-store";

/**
 * 保存这个工作区的 Home 版面。
 *
 * `selected` 是商家在面板里勾选并排好序的那一串。服务端**不信**它:未知 id 丢弃,
 * 没有真实生产者、面板根本没列过的 id 也丢弃(见 home-layout.ts 的 homeLayoutWrite)——
 * 客户端能发什么,决定不了库里能存什么。
 */
export async function saveHomeLayout(
  selected: unknown,
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;

  // 与 owner-settings 同一条口径:代登期间只能看,不能替商家改他自己的工作区设置。
  if (await isImpersonating()) {
    return { error: "Paused while impersonating a customer — exit impersonation to change their Home." };
  }

  if (!(await canManageHome(gate))) return { error: "You don't have access to this." };

  if (!Array.isArray(selected)) return { error: "Bad value." };
  const write = homeLayoutWrite({
    offered: availableHomeComponents(),
    selected: selected.filter(isHomeComponentId),
  });

  try {
    await writeHomeLayout({
      ownerId: gate.ownerId,
      componentIds: write.componentIds,
      hiddenIds: write.hiddenIds,
      updatedById: await actingUserId(gate.email),
    });
  } catch {
    return { error: "Couldn't save your Home layout — please try again." };
  }

  revalidatePath("/");
  return { ok: true };
}
