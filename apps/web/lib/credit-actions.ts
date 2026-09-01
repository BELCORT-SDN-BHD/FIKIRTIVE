"use server";
/**
 * Admin credit grants/adjustments (closed-beta P2, section ⑦). The ONLY user-facing
 * way to add credits to an org. requireRole("credits","mutate") (finance / super-admin),
 * audited transactionally, idempotent on a client-supplied key (a double-click never
 * double-grants). The grant form speaks DISPLAYED credits (1 credit = $0.10); we convert
 * to the internal ledger unit here. grantCredits (the service) is the only account writer.
 */
import { revalidatePath } from "next/cache";
import { prisma, grantCredits, InsufficientCredits, FinanceAdjustBlocked } from "@fikirtive/db";
import {
  newId,
  FOUNDER_OWNER_ID,
  INTERNAL_PER_DISPLAY,
  FINANCE_ADJUST_LIMITS,
  FINANCE_PER_ACTION_LIMIT_MESSAGE,
} from "@fikirtive/core";
import { requireRole } from "./auth-guard";
import { activeMerchantOrg } from "./tenant-admin";
import { financeAdjustBlockedMessage } from "./finance-limit-seam";

export async function grantCreditsAction(raw: unknown): Promise<{ ok: true; duplicate?: boolean } | { error: string }> {
  const gate = await requireRole("credits", "mutate");
  if ("error" in gate) return gate;
  // manual validation (the web app's pattern — see saveUserRole; no direct zod dep here).
  const v = raw as { orgId?: unknown; displayedAmount?: unknown; reason?: unknown; idempotencyKey?: unknown };
  // P2 is founder-scoped (one org); the form defaults here. P3 (multi-tenant) passes a real orgId.
  const orgId = typeof v?.orgId === "string" && v.orgId && v.orgId.length <= 64 ? v.orgId : FOUNDER_OWNER_ID;
  // 跨租户铸币要跨租户的权限。`orgId` 来自**请求体** —— `credits.mutate`(finance 也持有)
  // 只授权 founder 自己那本账;把别人 org 的 id 填进来就是另一件事了,判定必须与
  // `grantTenantCredits` 逐字同口径:`tenants.mutate` + 这个 org 还活着。
  // 缺省仍然是 FOUNDER_OWNER_ID(既有行为不动)。
  if (orgId !== FOUNDER_OWNER_ID) {
    const crossTenant = await requireRole("tenants", "mutate");
    if ("error" in crossTenant) return crossTenant;
    if (!(await activeMerchantOrg(orgId))) return { error: "Unknown or closed org." };
  }
  // DISPLAYED credits (what merchants see). Signed: positive = grant, negative = adjustment.
  const displayedAmount = typeof v?.displayedAmount === "number" ? v.displayedAmount : NaN;
  if (!Number.isInteger(displayedAmount) || displayedAmount === 0 || Math.abs(displayedAmount) > 1_000_000) {
    return { error: "Enter a non-zero whole number of credits (max ±1,000,000)." };
  }
  // 单笔上限只是 UX 预检:真正的判定(单笔 + 滚动 30 天累计)在 `grantCredits` 的同一事务里。
  if (Math.abs(displayedAmount) > FINANCE_ADJUST_LIMITS.perActionDisplay) {
    return { error: FINANCE_PER_ACTION_LIMIT_MESSAGE };
  }
  const reason = typeof v?.reason === "string" ? v.reason.slice(0, 500) : "";
  // client-generated per submit → grantCredits dedupes a double-click (no double-grant).
  const idempotencyKey = typeof v?.idempotencyKey === "string" ? v.idempotencyKey : "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 100) return { error: "Invalid request." };

  const amount = displayedAmount * INTERNAL_PER_DISPLAY; // displayed → internal credits

  // grantCredits is the single authoritative guard: a negative ADJUST is an atomic
  // conditional decrement that throws InsufficientCredits if the account is missing or
  // would go below zero (no separate, racy pre-check here). The conditional reserve
  // relies on a non-negative balance.
  let res: Awaited<ReturnType<typeof grantCredits>>;
  try {
    res = await grantCredits({ orgId, amount, reason, source: "ADMIN", createdBy: gate.email, idempotencyKey });
  } catch (e) {
    if (e instanceof InsufficientCredits) return { error: "That adjustment would drive the balance negative (or the account doesn't exist)." };
    // MONEY-A14:撞上 30 天累计闸 —— 判定在账本层,这里只负责说人话并把它报给 founder。
    if (e instanceof FinanceAdjustBlocked) return { error: await financeAdjustBlockedMessage(e, { via: gate.email, entry: "grantCreditsAction" }) };
    throw e;
  }

  // audit the financial mutation (best-effort: the grant already committed; a log hiccup
  // must not surface as an error that prompts a retry → a second grant under a NEW key).
  try {
    await prisma.actionEvent.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "credits.grant", payload: { orgId, displayedAmount, amount, reason, via: gate.email, duplicate: "duplicate" in res } },
    });
  } catch (e) {
    console.warn(`grantCreditsAction: credits.grant audit write failed (non-fatal):`, e instanceof Error ? e.message : e);
  }

  revalidatePath("/admin/credits");
  return { ok: true, duplicate: "duplicate" in res };
}
