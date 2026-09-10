"use server";
import { prisma } from "@fikirtive/db";
import { newId, FOUNDER_OWNER_ID } from "@fikirtive/core";
import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guard";
import { revokeEmailAccess } from "@/lib/signup-gate";

/**
 * SIGNIN-A7 —— 操作员那一侧的撤销入口（docs/specs/sign-in.md 已冻结 · v1 §1.6）。
 *
 * 规格把撤销从「收回一张还没被用掉的邀请」改成了「收回一个地址的进门权」，而这两件事今天在
 * 后台是同一颗按钮：`lib/tenant-actions.ts` 的 `revokeTenantInvite` 只认 `status = "invited"`
 * 的行，两扇门写进名单的却都是 `active`（`admitSelfSignup`），所以**自助进来的地址永远撤不掉**
 * ——按下去只会得到「No pending invite for that address.」（审计 [6]）。
 *
 * 这个动作是那颗按钮该调的那一个：判定谓词是 `status ≠ revoked`，而且撤销与「切断他手上的
 * 会话」发生在同一笔事务里（`revokeEmailAccess`）。业务规则只有那一份，这里不重写一遍 ——
 * 这一层只做三件 server action 该做的事：**授权**、把入参收成一个地址、留下审计行。
 *
 * 邀请那条路（把一封还没被接受的邀请收回）留在 `revokeTenantInvite` 原样不动：它多守着一条
 * 「这地址已经属于某个工作区就别用邀请工具管他」的前置条件，那条件对本动作恰恰是要撤的对象。
 * 两者收成一条的那次改动落在 `components/admin/AdminDashboardV2.tsx` 与 `lib/tenant-actions.ts`
 * 上，不在本片的写集内，已登记进规格 §5 变更登记。
 */
export async function revokeMerchantAccess(emailRaw: unknown): Promise<{ ok: true; result: string } | { error: string }> {
  const gate = await requireRole("tenants", "mutate");
  if ("error" in gate) return gate;
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
  // 一个能当地址读的字符串才继续 —— 不做验证器，只挡空值与明显不是地址的东西。
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Invalid email." };

  const outcome = await revokeEmailAccess(email);
  if (outcome === "unknown") return { error: "That address has no access to revoke." };

  // 审计是 best-effort：写不下这一行，也不许把一次真的撤销报成失败。
  await prisma.actionEvent
    .create({
      data: {
        id: newId(),
        ownerId: FOUNDER_OWNER_ID,
        type: "tenant.revoke",
        payload: { email, via: gate.email, outcome },
      },
    })
    .catch(() => {});
  revalidatePath("/admin/tenants");
  return { ok: true, result: outcome };
}
