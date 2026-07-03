"use server";
/**
 * research-actions — RESEARCH_CARD 的「Approve & run」动作(研究 S3 Task 1)。
 *
 * approve = balance 预检 + 建 ResearchJob(幂等)+ 卡 status→running + 入队。
 * **approve 本身 $0**:不 reserve、不 settle、不建 GenJob、不 withLlmBudget —— 真正花钱
 * 在 worker(Task 2),整段 search→read→synthesize 循环用一个 withLlmBudget 计量。
 * 这里的 balance 预检只是 fail-fast(读余额比对卡面预估),NOT a reservation:它不写
 * CreditAccount、不建 ledger row,余额真正的原子扣减在 worker 起步瞬间。
 *
 * 全部 owner-scoped:身份来自 requireOwner 的 session,绝不来自客户端输入(镜像 F3/F4
 * storyboard-actions 的 loadCard 模式)。
 */
import { z } from "zod";
import { prisma, Prisma } from "@fikirtive/db";
import { newId, RESEARCH_QUEUE } from "@fikirtive/core";
import { RESEARCH_TIERS, researchTierBudgetInternal, type ResearchCardPayload } from "@fikirtive/otto";
import { isImpersonating } from "@/lib/better-auth/compat";
import { requireOwner } from "./auth-guard";
import { getBoss } from "./queue";

const approveInput = z.object({ cardId: z.string().min(1) });
const IMPERSONATION_BLOCK = "Paused while impersonating a customer — exit impersonation to do this.";
const RESEARCH_QUEUE_ERROR = "Could not reach the research queue — please try again.";

/** RESEARCH_CARD payload 的运行时形状 —— status 生命周期 planned→running→done/failed。
 *  S2 只落 "planned";approve 推进到 "running"。tier 决定预估 credits。 */
type ResearchPayload = ResearchCardPayload & { status: "planned" | "running" | "done" | "failed" };

type Ok = { jobId: string };
type Err = { error: string; code?: string };

/** owner-scoped 载入一张 RESEARCH_CARD(复制 storyboard-actions.ts 的模式;不跨文件导出)。
 *  身份来自 session;thread.ownerId/deletedAt 复核防越权。 */
async function loadCard(cardId: string, ownerId: string) {
  const card = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "RESEARCH_CARD", deletedAt: null },
    select: { id: true, threadId: true, payload: true, thread: { select: { ownerId: true, deletedAt: true } } },
  });
  if (!card || card.thread.deletedAt || card.thread.ownerId !== ownerId) return null;
  return card;
}

async function failQueuedResearch(
  card: NonNullable<Awaited<ReturnType<typeof loadCard>>>,
  ownerId: string,
  jobId: string,
  fallbackPayload: ResearchPayload,
  errorText: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.researchJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: errorText },
    });
    const fresh = await tx.chatMessage.findFirst({
      where: { id: card.id, ownerId, kind: "RESEARCH_CARD", deletedAt: null },
      select: { payload: true },
    });
    const cur = (fresh?.payload ?? fallbackPayload) as ResearchPayload;
    await tx.chatMessage.updateMany({
      where: { id: card.id, ownerId, kind: "RESEARCH_CARD", deletedAt: null },
      data: { payload: { ...cur, status: "failed", error: errorText } as unknown as Prisma.InputJsonObject },
    });
  });
}

/** Read-only ($0) poll: return a RESEARCH_CARD's current payload so the client can watch
 *  status advance planned→running→done/failed after approve. Owner-scoped via loadCard;
 *  NEVER writes, NEVER spends — mirrors syncStoryboardMedia's read-only reconcile shape. */
export async function getResearchCard(raw: unknown): Promise<{ payload: ResearchPayload } | Err> {
  const parsed = approveInput.safeParse(raw);
  if (!parsed.success) return { error: "That request isn't valid." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const card = await loadCard(parsed.data.cardId, ownerId);
  if (!card) return { error: "Card not found." };
  return { payload: (card.payload ?? {}) as ResearchPayload };
}

export async function approveResearch(raw: unknown): Promise<Ok | Err> {
  const parsed = approveInput.safeParse(raw);
  if (!parsed.success) return { error: "That request isn't valid." };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (await isImpersonating()) return { error: IMPERSONATION_BLOCK };
  const { ownerId } = gate;

  const card = await loadCard(parsed.data.cardId, ownerId);
  if (!card) return { error: "Card not found." };

  const payload = (card.payload ?? {}) as ResearchPayload;
  // Only a PLANNED card may be approved. Already running/done/failed → reject re-approve
  // (idempotent second click on a live card is rejected here BEFORE the tx; a genuine race
  // where two clicks both pass this check is caught by the once-EVER index below).
  if (payload.status !== "planned") {
    return { error: "This research is already running or done." };
  }

  const tier = payload.tier;
  // INTERNAL budget for this tier — the EXACT reserve the worker's withLlmBudget will take for
  // tier.maxSteps. CreditAccount.balance is also INTERNAL, so this compares like-for-like. (The
  // card's estimatedCredits is DISPLAYED units, ~10× smaller — using it here would make the gate
  // far too lax; the honest fail-fast threshold is the internal budget.)
  const estimateInternal = researchTierBudgetInternal(RESEARCH_TIERS[tier]?.maxSteps ?? 0);

  // BALANCE PRE-CHECK (fail-fast, NOT a reservation): read the org's spendable balance and
  // compare against the tier's INTERNAL budget. If it can't cover it, refuse WITHOUT creating a
  // job — the real atomic reserve happens in the worker (Task 2) via withLlmBudget.
  // This is a friendly gate, not the spend cap: a missing account reads as 0 balance → refuse.
  const account = await prisma.creditAccount.findUnique({ where: { orgId: ownerId }, select: { balance: true } });
  const balance = account?.balance ?? 0;
  if (balance < estimateInternal) {
    return { error: "You don't have enough credits for this research.", code: "insufficient_credits" };
  }

  const idempotencyKey = `research:${card.id}`;

  let jobId: string;
  try {
    // $transaction: create the ResearchJob AND flip the card to "running" atomically. NO
    // reserve/settle here — approve is $0. The once-EVER partial-unique index on
    // (ownerId, idempotencyKey) WHERE key LIKE 'research:%' makes the insert idempotent:
    // a concurrent same-card approve hits P2002 (caught below).
    jobId = await prisma.$transaction(async (tx) => {
      const id = newId();
      await tx.researchJob.create({
        data: { id, ownerId, threadId: card.threadId, cardId: card.id, idempotencyKey, tier },
      });
      // RMW the card payload: re-read INSIDE the tx so a concurrent $0 edit can't be clobbered,
      // flip ONLY status → "running", byte-preserve every other field.
      const fresh = await tx.chatMessage.findFirst({
        where: { id: card.id, ownerId, kind: "RESEARCH_CARD", deletedAt: null },
        select: { payload: true },
      });
      const cur = (fresh?.payload ?? payload) as ResearchPayload;
      await tx.chatMessage.update({
        where: { id: card.id },
        data: { payload: { ...cur, status: "running" } as unknown as Prisma.InputJsonObject },
      });
      return id;
    });
  } catch (e) {
    // Once-EVER index race: a concurrent same-card approve won the insert → return ITS job id
    // instead of creating a duplicate. The tx rolled back, so this attempt wrote nothing (no
    // second job, no second card flip). research:<cardId> is exactly-once-ever (all-status
    // index), so match ANY status — never spend/enqueue twice, never re-throw P2002.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const existing = await prisma.researchJob.findFirst({
        where: { ownerId, idempotencyKey },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (existing) return { jobId: existing.id };
    }
    throw e;
  }

  // ONLY the enqueue is in this try: if the message was never sent, no worker can run the
  // research, so fail-close the $0 job/card immediately. Nothing has been reserved/spent yet.
  let queueJobId: string | null = null;
  try {
    const boss = await getBoss();
    queueJobId = await boss.send(RESEARCH_QUEUE, { jobId });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "queue unavailable";
    await failQueuedResearch(card, ownerId, jobId, payload, `dispatch failed: ${message}`);
    return { error: RESEARCH_QUEUE_ERROR };
  }

  // BEST-EFFORT: the job is ALREADY enqueued; queueJobId is tracking only.
  try {
    await prisma.researchJob.update({ where: { id: jobId }, data: { queueJobId: queueJobId ?? "" } });
  } catch (e) {
    console.warn(`approveResearch: queueJobId persist failed for job ${jobId} (non-fatal):`, e instanceof Error ? e.message : e);
  }

  return { jobId };
}
