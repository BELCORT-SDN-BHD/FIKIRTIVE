// ════════════════════════════════════════════════════════════════════════════
// Task 15 — Connections UI controls (autonomy toggle + kill-switch).
// Shape mirrors updateMemory: requireOwner → updateMany owner-scoped → { ok }.
// Surfaced to the client via otto-client-actions.ts (which is "use server").
// ════════════════════════════════════════════════════════════════════════════

/** Set the per-org Otto autonomy mode (Ask = always confirm; Auto = safe-only self-run). */
export async function setAdsAutonomy(mode: "ASK" | "AUTO"): Promise<{ ok: true } | { error: string }> {
  if (mode !== "ASK" && mode !== "AUTO") return { error: "Invalid autonomy mode." };
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true } | { error: string }> => {
    // F15 (safe default): staff impersonating a customer must not loosen that customer's ad-spend
    // gate (ASK→AUTO lets Otto spend without per-action approval). Exit impersonation to change it.
    if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to change their ad autonomy." };
    const updated = await prisma.metaConnection.updateMany({ where: { ownerId: gate.ownerId }, data: { adsAutonomy: mode } });
    if (updated.count === 0) return { error: "Connect Instagram or Facebook before changing ad-spend autonomy." };
    return { ok: true };
  });
}

/** Toggle the kill-switch. When paused=true, runApprovedPlan refuses every write. */
export async function setAdsWritesPaused(paused: boolean): Promise<{ ok: true } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true } | { error: string }> => {
    if (await isImpersonating()) return { error: "Paused while impersonating a customer — exit impersonation to change their ad-write controls." };
    const updated = await prisma.metaConnection.updateMany({ where: { ownerId: gate.ownerId }, data: { adsWritesPaused: paused } });
    if (updated.count === 0) return { error: "Connect Instagram or Facebook before changing ad-write controls." };
    return { ok: true };
  });
}

// ════════════════════════════════════════════════════════════════════════════

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
import { classifyMoneyClass, policyDecision, type AdOp, type MoneyClass } from "./meta-action-policy";
import { verifyApproval, type PlanStep } from "./meta-approval";
import { runAsUser } from "@fikirtive/db/principal";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { isImpersonating } from "@/lib/better-auth/compat";
import type { MetaActionCardPayload, MetaActionStep } from "./meta-plan-card";
import { sanitizeUserError } from "./provider-secrecy";

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
    default:
      throw new Error(`unsupported op for manage executor: ${(step as MetaActionStep).op}`);
  }
}

/**
 * Is a live effective_status a "not-active" (paused-equivalent) state? Meta returns rollup values
 * — CAMPAIGN_PAUSED / ADSET_PAUSED / PAUSED for paused, plus ARCHIVED / DELETED which are also not
 * active — so a literal `=== "PAUSED"` comparison wrongly fails for a successfully-paused nested
 * object. Normalize: anything containing PAUSED / ARCHIVED / DELETED is treated as paused/not-active.
 */
function isPausedStatus(status: string | undefined): boolean {
  if (!status) return false;
  const s = status.toUpperCase();
  return s.includes("PAUSED") || s.includes("ARCHIVED") || s.includes("DELETED");
}

/** Is a live effective_status an active state? Meta returns "ACTIVE" for active. */
function isActiveStatus(status: string | undefined): boolean {
  return status?.toUpperCase() === "ACTIVE";
}

/**
 * Does the live state ALREADY equal what this step intended to write? Used to reconcile a
 * MAYBE-APPLIED (APPLYING) row left by a prior crash: if reality already matches the
 * target, the earlier write landed → idempotent, treat as applied. Otherwise ambiguous.
 */
function liveMatchesTarget(step: MetaActionStep, live: LiveObject): boolean {
  switch (step.op) {
    case "pause":
      return isPausedStatus(live.status);
    case "resume":
      return isActiveStatus(live.status);
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
    default:
      throw new Error(`unsupported op for manage executor: ${(step as MetaActionStep).op}`);
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
      const reason = e instanceof Error ? sanitizeUserError(e.message, 200) : "live re-read failed";
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
      const reason = e instanceof Error ? sanitizeUserError(e.message, 200) : "write failed";
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

// ════════════════════════════════════════════════════════════════════════════
// AUTHORIZATION GATES — the only two sanctioned entries to runApprovedPlan.
//
// runApprovedPlan TRUSTS its caller for authorization (it re-reads reality and
// gates divergence/idempotency/kill-switch, but never checks "may this actor
// spend?"). These two functions are where that authorization actually happens:
//   - approveMetaActionPlan — a HUMAN clicking approve (authorizes the whole
//     frozen plan, including any spend steps).
//   - maybeAutoRun — the AUTO path: only money-SAFE steps under AUTO mode, never
//     a spend step, re-derived server-side (never trust the stored flag alone).
// ════════════════════════════════════════════════════════════════════════════

/** Reconstruct the EXACT PlanStep[] the card's approval was built over. MUST mirror
 *  buildMetaPlanCard's `planSteps` (same fields, same order) or the hash won't match. */
function bindingSteps(payload: MetaActionCardPayload): PlanStep[] {
  return payload.steps.map((s) => ({
    index: s.index,
    op: s.op,
    targetId: s.targetId,
    targetValue: s.targetValue,
  }));
}

/** Patch the card's frozen JSON payload with a single-use consume stamp, BEFORE executing,
 *  so a concurrent/duplicate trigger re-reads a consumed approval and is refused. */
async function consumeApproval(cardId: string, ownerId: string, payload: MetaActionCardPayload, nowIso: string): Promise<void> {
  const consumed: MetaActionCardPayload = {
    ...payload,
    approval: { ...payload.approval, consumedAt: nowIso },
  };
  await prisma.chatMessage.update({
    where: { id: cardId },
    data: { payload: consumed as unknown as Prisma.InputJsonObject },
  });
}

/**
 * approveMetaActionPlan — the HUMAN-approve gate (`'use server'`). The card UI calls this
 * when the user clicks approve. This is where real-money authorization happens:
 *   1. requireOwner (resolve ownerId server-side — NEVER a param).
 *   2. Block impersonation — staff-impersonating-customer must never spend customer money.
 *   3. Load the owner-scoped ACTION_CARD → frozen payload.
 *   4. Verify the approval BINDING (hash/actor/expiry/consumed) against the exact steps the
 *      card was built with. On any failure: refuse, do NOT execute, do NOT consume.
 *   5. Consume (single-use) — persist consumedAt BEFORE executing, so a concurrent approve
 *      re-reads consumed and is refused (no double-trigger).
 *   6. runApprovedPlan (the trusted executor). Human approval authorizes the WHOLE frozen
 *      plan including spend steps — so we do NOT block spend here. runApprovedPlan's live
 *      re-read divergence gate still catches reality-drift before any write.
 */
export async function approveMetaActionPlan(
  cardId: string,
): Promise<{ ok: true; state: RunResult["state"]; results: StepResult[] } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ ok: true; state: RunResult["state"]; results: StepResult[] } | { error: string }> => {
    if (await isImpersonating()) {
      return { error: "Paused while impersonating a customer — exit impersonation to do this." };
    }
    const { ownerId } = gate;

    const message = await prisma.chatMessage.findFirst({
      where: { id: cardId, ownerId, kind: "ACTION_CARD" },
    });
    if (!message || !message.payload) return { error: "That action card no longer exists." };
    const payload = message.payload as unknown as MetaActionCardPayload;

    const verdict = verifyApproval(payload.approval, bindingSteps(payload), ownerId, new Date().toISOString());
    if (!verdict.ok) {
      return { error: `This plan can't be approved (${verdict.reason}). Ask Otto to propose it again.` };
    }

    // Kill-switch / canWrite gate BEFORE consuming the single-use approval. runApprovedPlan throws
    // KILL_SWITCH when adsWritesPaused — if we consumed first, that throw would burn the approval
    // forever (card un-approvable, nothing executed). Check it up front so the approval survives.
    // (runApprovedPlan keeps its own check — defense in depth.)
    const conn = await prisma.metaConnection.findUnique({ where: { ownerId } });
    if (!conn || conn.canWrite !== true) {
      return { error: "Meta isn't connected for ad changes — reconnect and try again." };
    }
    if (conn.adsWritesPaused === true) {
      return { error: "Ad changes are paused (kill-switch on). Turn it off in Connections and try again." };
    }

    // Single-use: stamp consumedAt and persist BEFORE executing. A concurrent/duplicate approve
    // now re-reads a consumed approval (verifyApproval → "consumed") and is refused.
    // Note: consumeApproval is best-effort (read-check-write, not atomic); the per-step
    // MetaActionExecution unique index (ownerId,cardId,stepIndex) is the real exactly-once
    // serialization point, so a TOCTOU double-approve still cannot double-spend.
    await consumeApproval(cardId, ownerId, payload, new Date().toISOString());

    const result = await runApprovedPlan(ownerId, cardId);
    return { ok: true, state: result.state, results: result.results };
  });
}

/**
 * maybeAutoRun — the AUTO path (internal, NOT `'use server'`). Called by the propose flow
 * right after persisting an autoEligible card. Defense-in-depth: never trust the stored
 * `autoEligible` flag alone — re-derive the authorization server-side:
 *   - require MetaConnection.adsAutonomy === "AUTO"
 *   - require EVERY step is `auto` under policy (a single spend step makes the plan ask-only)
 * If either fails → return without running (a spend step can NEVER reach the executor here).
 * On success, stamp consumedAt (so a later human approve can't re-trigger) then execute.
 */
export async function maybeAutoRun(
  ownerId: string,
  cardId: string,
): Promise<{ ran: false; reason?: string } | { ran: true; ok: true; state: RunResult["state"]; results: StepResult[] }> {
  const message = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "ACTION_CARD" },
  });
  if (!message || !message.payload) return { ran: false, reason: "missing-card" };
  const payload = message.payload as unknown as MetaActionCardPayload;
  if (payload.autoEligible !== true) return { ran: false, reason: "not-auto-eligible" };

  // Re-derive server-side — do NOT trust the stored autoEligible alone.
  const conn = await prisma.metaConnection.findUnique({
    where: { ownerId },
    select: { adsAutonomy: true, adsWritesPaused: true, canWrite: true },
  });
  const mode = conn?.adsAutonomy ?? "ASK";
  if (mode !== "AUTO") return { ran: false, reason: "mode-ask" };
  const everyStepAuto = payload.steps.every((s) => policyDecision(mode, s.moneyClass) === "auto");
  if (!everyStepAuto) return { ran: false, reason: "spend-step" }; // a spend step is never auto here

  // Kill-switch / canWrite BEFORE consuming the single-use approval (FIX C). runApprovedPlan would
  // throw KILL_SWITCH when paused — consuming first would burn the approval. Check up front so the
  // card stays a normal pending proposal the user can approve manually once un-paused.
  if (!conn || conn.canWrite !== true) return { ran: false, reason: "cannot-write" };
  if (conn.adsWritesPaused === true) return { ran: false, reason: "kill-switch" };

  await consumeApproval(cardId, ownerId, payload, new Date().toISOString());

  const result = await runApprovedPlan(ownerId, cardId);
  return { ran: true, ok: true, state: result.state, results: result.results };
}
