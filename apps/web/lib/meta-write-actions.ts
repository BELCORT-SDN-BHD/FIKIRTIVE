/**
 * runApprovedPlan — the ONLY code path in the system that writes to Meta (spends the
 * user's real ad money). Trusted, internal, server-side executor. NOT `'use server'`.
 *
 * It takes a TRUSTED, already-authenticated `ownerId` from its caller (Task 12's
 * `approveMetaActionPlan`, which does requireOwner/isImpersonating/approval-binding, OR
 * the auto-trigger). This file does NOT re-authenticate — but every read/write is still
 * owner-scoped so a wrong ownerId can only touch its own rows, never another tenant's.
 *
 * Discipline mirrors `gen-actions.ts#startGen` (owner-scoped lookup, atomic claim,
 * best-effort ActionEvent) — but with NO credit ledger: Meta money is the user's own.
 *
 * Security invariants (do not weaken without re-reading the task brief):
 *  - Kill-switch (`adsWritesPaused`) refuses EVERYTHING, before any graph call.
 *  - Per-step idempotency: an APPLIED row is never re-posted (no double-spend).
 *  - Live re-read DIVERGENCE gate: if the world drifted so the action now means
 *    something different (esp. safe→spend), we do NOT write and STOP the batch.
 *  - Stop-on-first-failure: a write error halts the batch; no later step is attempted;
 *    earlier steps are NOT rolled back.
 */
import { prisma, Prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { decryptToken } from "./token-encryption";
import { metaGraphGet, metaGraphPost } from "./meta-graph";
import { classifyMoneyClass, type AdOp, type MoneyClass } from "./meta-action-policy";
import type { MetaActionCardPayload, MetaActionStep } from "./meta-plan-card";

export type StepResultStatus = "APPLIED" | "SKIPPED" | "DIVERGED" | "FAILED" | "NEEDS_CONFIRM";
export type StepResult = { index: number; status: StepResultStatus; reason?: string };
export type RunResult = {
  results: StepResult[];
  state: "done" | "partial" | "failed";
  needsReconnect?: true;
};

/** Live re-read of a single ad object: just the fields a write/divergence-check needs. */
const LIVE_FIELDS = "effective_status,daily_budget,lifetime_budget,start_time,end_time";

type LiveObject = {
  status?: string;
  dailyBudgetMinor?: number;
  lifetimeBudgetMinor?: number;
  startTime?: string;
  endTime?: string;
};

function parseLive(raw: Record<string, unknown>): LiveObject {
  const intOr = (v: unknown): number | undefined =>
    v == null ? undefined : Number.parseInt(String(v), 10);
  return {
    status: raw.effective_status != null ? String(raw.effective_status) : undefined,
    dailyBudgetMinor: intOr(raw.daily_budget),
    lifetimeBudgetMinor: intOr(raw.lifetime_budget),
    startTime: raw.start_time != null ? String(raw.start_time) : undefined,
    endTime: (raw.end_time ?? raw.stop_time) != null ? String(raw.end_time ?? raw.stop_time) : undefined,
  };
}

/**
 * Recompute the resolved op + money-class from (live current → the frozen step's
 * targetValue), using the SAME rule as plan-card construction. Budget ops were resolved
 * from a `set_budget` input, so their direction depends on the live current budget;
 * pause/resume/reschedule are fixed regardless of live state.
 */
function recomputeOp(frozen: MetaActionStep, live: LiveObject): { op: AdOp; moneyClass: MoneyClass } {
  if (frozen.op === "budget_up" || frozen.op === "budget_down") {
    const target = Number(frozen.targetValue.dailyBudgetMinor ?? frozen.targetValue.lifetimeBudgetMinor ?? 0);
    const current = Number(
      (frozen.targetValue.lifetimeBudgetMinor != null ? live.lifetimeBudgetMinor : live.dailyBudgetMinor) ?? 0,
    );
    const op: AdOp = target > current ? "budget_up" : "budget_down";
    return { op, moneyClass: classifyMoneyClass(op) };
  }
  // pause | resume | reschedule resolve directly — independent of live numeric state.
  return { op: frozen.op, moneyClass: classifyMoneyClass(frozen.op) };
}

/** The write body for a resolved op against its frozen targetValue. */
function bodyFor(step: MetaActionStep): Record<string, string | number> {
  switch (step.op) {
    case "pause":
      return { status: "PAUSED" };
    case "resume":
      return { status: "ACTIVE" };
    case "budget_up":
    case "budget_down": {
      if (step.targetValue.lifetimeBudgetMinor != null) {
        return { lifetime_budget: Number(step.targetValue.lifetimeBudgetMinor) };
      }
      return { daily_budget: Number(step.targetValue.dailyBudgetMinor ?? 0) };
    }
    case "reschedule": {
      const b: Record<string, string | number> = {};
      if (step.targetValue.startTime != null) b.start_time = String(step.targetValue.startTime);
      if (step.targetValue.endTime != null) b.end_time = String(step.targetValue.endTime);
      return b;
    }
  }
}

/**
 * Does the live state ALREADY equal what this step intended to write? Used to reconcile a
 * MAYBE-APPLIED (APPLYING) row left by a prior crash: if reality already matches the
 * target, the earlier write landed → idempotent, treat as applied. Otherwise ambiguous.
 */
function liveMatchesTarget(step: MetaActionStep, live: LiveObject): boolean {
  switch (step.op) {
    case "pause":
      return live.status === "PAUSED";
    case "resume":
      return live.status === "ACTIVE";
    case "budget_up":
    case "budget_down": {
      if (step.targetValue.lifetimeBudgetMinor != null) {
        return live.lifetimeBudgetMinor === Number(step.targetValue.lifetimeBudgetMinor);
      }
      return live.dailyBudgetMinor === Number(step.targetValue.dailyBudgetMinor);
    }
    case "reschedule": {
      const startOk = step.targetValue.startTime == null || live.startTime === String(step.targetValue.startTime);
      const endOk = step.targetValue.endTime == null || live.endTime === String(step.targetValue.endTime);
      return startOk && endOk;
    }
  }
}

/** Best-effort audit; a log hiccup must never break the money path. */
async function audit(ownerId: string, type: string, payload: Prisma.InputJsonObject): Promise<void> {
  try {
    await prisma.actionEvent.create({ data: { id: newId(), ownerId, type, payload } });
  } catch (e) {
    console.warn(`runApprovedPlan: ${type} audit write failed (non-fatal):`, e instanceof Error ? e.message : e);
  }
}

function aggregate(results: StepResult[]): "done" | "partial" | "failed" {
  if (results.length === 0) return "failed";
  const allOk = results.every((r) => r.status === "APPLIED" || r.status === "SKIPPED");
  if (allOk) return "done";
  const anyApplied = results.some((r) => r.status === "APPLIED" || r.status === "SKIPPED");
  return anyApplied ? "partial" : "failed";
}

export async function runApprovedPlan(ownerId: string, cardId: string): Promise<RunResult> {
  // 1. KILL-SWITCH FIRST — before any graph call, before loading the card.
  const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
  if (!conn) return { results: [], state: "failed", needsReconnect: true };
  if (conn.adsWritesPaused === true) {
    // Hard refusal: throw so a caller can never mistake a paused org for a no-op success.
    throw new Error("KILL_SWITCH: ads writes are paused for this org");
  }
  if (!conn.canWrite) return { results: [], state: "failed", needsReconnect: true };

  let token: string;
  try {
    token = decryptToken(conn.accessTokenEnc);
  } catch {
    return { results: [], state: "failed", needsReconnect: true };
  }

  // 2. Load the owner-scoped ACTION_CARD → its frozen payload.
  const message = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "ACTION_CARD" },
  });
  if (!message || !message.payload) return { results: [], state: "failed" };
  const payload = message.payload as unknown as MetaActionCardPayload;
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  if (steps.length === 0) return { results: [], state: "failed" };

  const results: StepResult[] = [];

  // 3. Execute steps IN ORDER. Any DIVERGED/FAILED/NEEDS_CONFIRM stops the batch.
  for (const step of steps) {
    const stepIndex = step.index;

    // 3a. Idempotency claim. The unique index (ownerId,cardId,stepIndex) is RAW SQL, not a
    //     Prisma @@unique, so we findFirst then create-with-catch (the index is the
    //     race-proof backstop).
    let row = await prisma.metaActionExecution.findFirst({ where: { ownerId, cardId, stepIndex } });
    if (row) {
      if (row.status === "APPLIED") {
        results.push({ index: stepIndex, status: "SKIPPED" });
        continue; // already done — never re-write.
      }
      if (row.status === "APPLYING") {
        // 3e. MAYBE-APPLIED reconcile — a prior crash. Re-read live; do NOT blindly re-post.
        const r = await reconcile(token, ownerId, cardId, step, row.id);
        results.push(r);
        if (r.status !== "SKIPPED") break; // ambiguous (NEEDS_CONFIRM) → stop the batch.
        continue;
      }
      // PENDING/FAILED leftover: fall through and re-claim this same row below.
    } else {
      // No row → create a PENDING claim. On a duplicate-insert race, re-read by index.
      try {
        row = await prisma.metaActionExecution.create({
          data: { id: newId(), ownerId, cardId, stepIndex, status: "PENDING" },
        });
      } catch (e) {
        if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
          const existing = await prisma.metaActionExecution.findFirst({ where: { ownerId, cardId, stepIndex } });
          if (existing?.status === "APPLIED") {
            results.push({ index: stepIndex, status: "SKIPPED" });
            continue;
          }
          if (existing?.status === "APPLYING") {
            const r = await reconcile(token, ownerId, cardId, step, existing.id);
            results.push(r);
            if (r.status !== "SKIPPED") break;
            continue;
          }
          // The concurrent claimant is still PENDING and is the rightful executor — do not
          // race it. Treat as needs-confirm and stop, rather than risk a double-write.
          results.push({ index: stepIndex, status: "NEEDS_CONFIRM", reason: "concurrent claim in progress" });
          break;
        }
        throw e;
      }
    }

    // 3b. Live re-read + DIVERGENCE check (the core safety gate). Read the live object and
    //     recompute (resolvedOp, moneyClass). If it no longer matches the SANCTIONED
    //     (frozen) classification, the world drifted → do NOT write, mark FAILED, stop.
    let live: LiveObject;
    try {
      const raw = await metaGraphGet(token, step.targetId, { fields: LIVE_FIELDS });
      live = parseLive(raw as Record<string, unknown>);
    } catch (e) {
      await prisma.metaActionExecution.update({ where: { id: row.id }, data: { status: "FAILED" } }).catch(() => {});
      const reason = e instanceof Error ? e.message.slice(0, 200) : "live re-read failed";
      results.push({ index: stepIndex, status: "FAILED", reason });
      break; // stop-on-first-failure.
    }

    const recomputed = recomputeOp(step, live);
    if (recomputed.op !== step.op || recomputed.moneyClass !== step.moneyClass) {
      await prisma.metaActionExecution.update({ where: { id: row.id }, data: { status: "FAILED" } }).catch(() => {});
      const reason = `diverged: approved as ${step.op}/${step.moneyClass} but is now ${recomputed.op}/${recomputed.moneyClass}`;
      await audit(ownerId, "meta.action.diverged", { cardId, stepIndex, targetId: step.targetId, reason });
      results.push({ index: stepIndex, status: "DIVERGED", reason });
      break; // do NOT write; stop the batch (partial/failed).
    }

    // 3a (cont). Mark APPLYING immediately before the write (the MAYBE-APPLIED window).
    await prisma.metaActionExecution.update({ where: { id: row.id }, data: { status: "APPLYING" } });

    // 3c. Write.
    try {
      await metaGraphPost(token, step.targetId, bodyFor(step));
    } catch (e) {
      // 3d. Write error → row FAILED, result FAILED, STOP the batch. No auto-rollback.
      await prisma.metaActionExecution.update({ where: { id: row.id }, data: { status: "FAILED" } }).catch(() => {});
      const reason = e instanceof Error ? e.message.slice(0, 200) : "write failed";
      results.push({ index: stepIndex, status: "FAILED", reason });
      break;
    }

    await prisma.metaActionExecution.update({
      where: { id: row.id },
      data: { status: "APPLIED", appliedValue: step.targetValue as unknown as Prisma.InputJsonValue },
    });
    await audit(ownerId, "meta.action.applied", { cardId, stepIndex, targetId: step.targetId, op: step.op });
    results.push({ index: stepIndex, status: "APPLIED" });
  }

  return { results, state: aggregate(results) };
}

/**
 * Reconcile a MAYBE-APPLIED (APPLYING) row: re-read live state and decide WITHOUT posting.
 * If live already equals the frozen target → the prior write landed → treat APPLIED
 * (idempotent SKIPPED). If still ambiguous → NEEDS_CONFIRM (a human must reconcile). Never
 * re-posts — that is the whole point of this path.
 */
async function reconcile(
  token: string,
  ownerId: string,
  cardId: string,
  step: MetaActionStep,
  rowId: string,
): Promise<StepResult> {
  let live: LiveObject;
  try {
    const raw = await metaGraphGet(token, step.targetId, { fields: LIVE_FIELDS });
    live = parseLive(raw as Record<string, unknown>);
  } catch {
    return { index: step.index, status: "NEEDS_CONFIRM", reason: "could not re-read live state" };
  }
  if (liveMatchesTarget(step, live)) {
    await prisma.metaActionExecution
      .update({ where: { id: rowId }, data: { status: "APPLIED", appliedValue: step.targetValue as unknown as Prisma.InputJsonValue } })
      .catch(() => {});
    await audit(ownerId, "meta.action.reconciled-applied", { cardId, stepIndex: step.index, targetId: step.targetId });
    return { index: step.index, status: "SKIPPED" };
  }
  return { index: step.index, status: "NEEDS_CONFIRM", reason: "prior write outcome unknown — live state does not match target" };
}
