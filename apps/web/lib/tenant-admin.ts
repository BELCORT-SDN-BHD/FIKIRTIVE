import "server-only";
import { prisma, adjustWindowTotals } from "@fikirtive/db";
import { displayCredits, FOUNDER_OWNER_ID, FINANCE_ADJUST_LIMITS, MANUAL_REFUND_REF_PREFIX } from "@fikirtive/core";

/** 一个**还活着的商家 org**,或者 null。
 *
 *  合并到这里(此前是 `tenant-actions.ts` 里的私有拷贝)是因为跨租户动钱的入口现在有三个
 *  ——授信、founder 面调账、人工退款——三处必须用同一条判定,否则「哪个入口能对已关闭的
 *  org 动钱」会变成一个要逐个入口去读代码才能回答的问题。founder org 永远不是商家 org:
 *  跨租户动作绝不能悄悄落回 founder 自己身上。 */
export async function activeMerchantOrg(orgId: string): Promise<{ id: string } | null> {
  if (!orgId || orgId === FOUNDER_OWNER_ID) return null;
  return prisma.organization.findFirst({ where: { id: orgId, deletedAt: null }, select: { id: true } });
}

export type TenantRow = {
  orgId: string;
  name: string;
  ownerEmail: string;
  status: string;
  balance: number;
  genCount: number;
  lastActiveAt: string | null;
};

export type InvitedRow = {
  email: string;
  status: string;
  invitedBy: string;
  createdAt: string;
};

export type TenantDetail = {
  orgId: string;
  name: string;
  ownerEmail: string;
  status: string;
  balance: number;
  reserved: number;
  spentUsd: number;
  projectCount: number;
  genCount: number;
  ledger: { id: string; kind: string; displayedDelta: number; reason: string; createdAt: string }[];
  audit: { id: string; type: string; createdAt: string }[];
  /** MONEY-A14:这个 org 在滚动 30 天里动过的**人工**钱(显示 credits,|Δ| 合计)。
   *  与真正会拒绝操作员的那把闸读同一条谓词(`adjustWindowTotals`),所以页面上的数字
   *  和闸的判定不可能各说各话。 */
  adjustRolling30dDisplay: number;
  /** 同上口径的上限(显示 credits),来自 `FINANCE_ADJUST_LIMITS` 单一源。 */
  adjustRolling30dLimitDisplay: number;
  /** MONEY-A14 —— 这个 org 里**还没收口**的人工退款单(RESERVE 在、SETTLE/REFUND 都不在)。
   *
   *  它必须来自**账本**而不是页面内存:退款单号既是账本 refId 也是 Stripe 幂等键,上一版把它
   *  只放在 React state 里,刷新一次就再也找不回那张单,而 credits 还锁着。事实来自 RESERVE 行
   *  reason 里钉着的那一份(整数 internal 单位,读侧才换算成显示 credits)。 */
  openManualRefunds: {
    refundId: string;
    paymentIntentId: string;
    heldDisplay: number;
    requestedDisplay: number;
    amountMinor: number;
    currency: string;
    allowPartial: boolean;
    at: string;
  }[];
};

/** RESERVE 行 reason 里钉着的退款事实(整数 internal 单位);写侧在 `refund-actions.ts`。 */
function decodeRefundPin(reason: string): { paymentIntentId: string; requestedInternal: number; heldInternal: number; amountMinor: number; currency: string; allowPartial: boolean } | null {
  const pi = /pi:(pi_[A-Za-z0-9]+)/.exec(reason)?.[1];
  const req = Number(/\|req:(\d+)/.exec(reason)?.[1]);
  const held = Number(/\|held:(\d+)/.exec(reason)?.[1]);
  const minor = Number(/\|minor:(\d+)/.exec(reason)?.[1]);
  const cur = /\|cur:([a-z]+)/.exec(reason)?.[1];
  const partial = /\|partial:([01])/.exec(reason)?.[1];
  if (!pi || !cur || !partial || ![req, held, minor].every((n) => Number.isSafeInteger(n))) return null;
  return { paymentIntentId: pi, requestedInternal: req, heldInternal: held, amountMinor: minor, currency: cur, allowPartial: partial === "1" };
}

/**
 * 这个 org 里还没收口的人工退款单(MONEY-A14,复审二 P1-2d)。
 *
 * 判据 = 有 RESERVE、没有 SETTLE/REFUND。两句查询而不是一句 NOT EXISTS,是因为 Prisma 表达不了
 * 同表自关联;窗口很小(未收口的单是个位数),两句都带 `orgId` 租户约束。
 */
async function openManualRefundsFor(orgId: string) {
  const holds = await prisma.creditLedger.findMany({
    where: { orgId, kind: "RESERVE", refId: { startsWith: MANUAL_REFUND_REF_PREFIX } },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { refId: true, reason: true, createdAt: true },
  });
  if (holds.length === 0) return [];
  const refIds = holds.map((h) => h.refId!).filter(Boolean);
  const finalized = await prisma.creditLedger.findMany({
    where: { orgId, refId: { in: refIds }, kind: { in: ["SETTLE", "REFUND"] } },
    select: { refId: true },
  });
  const closed = new Set(finalized.map((f) => f.refId));
  return holds
    .filter((hold) => !closed.has(hold.refId))
    .flatMap((hold) => {
      const pin = decodeRefundPin(hold.reason);
      if (!pin) return [];
      return [{
        refundId: hold.refId!.slice(MANUAL_REFUND_REF_PREFIX.length),
        paymentIntentId: pin.paymentIntentId,
        heldDisplay: displayCredits(pin.heldInternal),
        requestedDisplay: displayCredits(pin.requestedInternal),
        amountMinor: pin.amountMinor,
        currency: pin.currency,
        allowPartial: pin.allowPartial,
        at: hold.createdAt.toISOString(),
      }];
    });
}

export async function listTenants(): Promise<{ tenants: TenantRow[]; invited: InvitedRow[] }> {
  const [orgs, memberships, accounts, genAgg, invitedRows] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { not: FOUNDER_OWNER_ID }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true },
    }),
    prisma.membership.findMany({
      where: { orgId: { not: FOUNDER_OWNER_ID }, deletedAt: null, role: "owner" },
      select: { orgId: true, status: true, user: { select: { email: true } } },
    }),
    prisma.creditAccount.findMany({
      where: { orgId: { not: FOUNDER_OWNER_ID } },
      select: { orgId: true, balance: true },
    }),
    prisma.generation.groupBy({
      by: ["ownerId"],
      where: { deletedAt: null, ownerId: { not: FOUNDER_OWNER_ID } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.allowedEmail.findMany({
      orderBy: { createdAt: "desc" },
      select: { email: true, status: true, invitedBy: true, createdAt: true },
    }),
  ]);

  const ownerByOrg = new Map(memberships.map((m) => [m.orgId, m]));
  const balByOrg = new Map(accounts.map((a) => [a.orgId, a.balance]));
  const genByOrg = new Map(genAgg.map((g) => [g.ownerId, g]));

  const tenants: TenantRow[] = orgs.map((o) => {
    const m = ownerByOrg.get(o.id);
    const g = genByOrg.get(o.id);
    return {
      orgId: o.id,
      name: o.name,
      ownerEmail: m?.user?.email ?? "",
      status: m?.status ?? "unknown",
      balance: displayCredits(balByOrg.get(o.id) ?? 0),
      genCount: g?._count?._all ?? 0,
      lastActiveAt: g?._max?.createdAt ? g._max.createdAt.toISOString() : null,
    };
  });

  // Once a merchant signs in they own a tenant org (above). Since #538 provisioning flips
  // their AllowedEmail row to 'active' as the membership is created, so they normally drop
  // out of this list on status alone. This filter still matters for rows written BEFORE that
  // protocol landed, which are stuck at 'invited' — without it a signed-in merchant would
  // linger forever under "Invited (not yet signed in)".
  const activeEmails = new Set(tenants.map((t) => t.ownerEmail.toLowerCase()).filter(Boolean));
  const invited: InvitedRow[] = invitedRows
    .filter((r) => !activeEmails.has(r.email.toLowerCase()))
    .map((r) => ({
      email: r.email,
      status: r.status,
      invitedBy: r.invitedBy,
      createdAt: r.createdAt.toISOString(),
    }));

  return { tenants, invited };
}

export async function getTenantDetail(orgId: string): Promise<TenantDetail | null> {
  if (orgId === FOUNDER_OWNER_ID) return null;

  const org = await prisma.organization.findFirst({
    where: { id: orgId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!org) return null;

  const [membership, account, ledgerRows, genSpend, refSpend, projectCount, genCount, auditRows] = await Promise.all([
    prisma.membership.findFirst({
      where: { orgId, deletedAt: null, role: "owner" },
      select: { status: true, user: { select: { email: true } } },
    }),
    prisma.creditAccount.findUnique({
      where: { orgId },
      select: { balance: true, reserved: true },
    }),
    prisma.creditLedger.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, kind: true, balanceDelta: true, reason: true, createdAt: true },
    }),
    prisma.genJob.aggregate({
      where: { ownerId: orgId },
      _sum: { spentUsd: true },
    }),
    prisma.refGenJob.aggregate({
      where: { ownerId: orgId },
      _sum: { spentUsd: true },
    }),
    prisma.project.count({ where: { ownerId: orgId, deletedAt: null } }),
    prisma.generation.count({ where: { ownerId: orgId, deletedAt: null } }),
    prisma.actionEvent.findMany({
      where: { ownerId: orgId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, type: true, createdAt: true },
    }),
  ]);

  // 报表按**累计**判,不按单行判(此前一天发二十行 1000 也全绿)。口径来自钱服务本身。
  const [adjustTotals, openManualRefunds] = await Promise.all([adjustWindowTotals([orgId]), openManualRefundsFor(orgId)]);

  return {
    orgId: org.id,
    name: org.name,
    ownerEmail: membership?.user?.email ?? "",
    status: membership?.status ?? "unknown",
    balance: displayCredits(account?.balance ?? 0),
    reserved: displayCredits(account?.reserved ?? 0),
    spentUsd: Number(genSpend._sum.spentUsd ?? 0) + Number(refSpend._sum.spentUsd ?? 0),
    projectCount,
    genCount,
    ledger: ledgerRows.map((l) => ({
      id: l.id,
      kind: l.kind,
      displayedDelta: displayCredits(l.balanceDelta),
      reason: l.reason,
      createdAt: l.createdAt.toISOString(),
    })),
    audit: auditRows.map((a) => ({
      id: a.id,
      type: a.type,
      createdAt: a.createdAt.toISOString(),
    })),
    adjustRolling30dDisplay: displayCredits(adjustTotals.get(orgId)?.internalTotal ?? 0),
    adjustRolling30dLimitDisplay: FINANCE_ADJUST_LIMITS.rolling30dTotalDisplay,
    openManualRefunds,
  };
}
