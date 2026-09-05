"use client";
import React, { useState } from "react";
import { ClipboardList, ShieldCheck, CheckCircle2, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { approveMetaActionPlan, ottoReject } from "@/lib/otto-client-actions";
import { ACTION_PLAN_DECLINE_TEXT, isDeclinedPayload } from "@/lib/meta-card-decline-view";
import type { MetaActionCardPayload } from "@/lib/meta-plan-card";

export interface OttoActionPlanCardProps {
  cardId: string;
  /** The conversation this card lives in — `ottoReject` is thread-scoped, like every other
   *  card action, so the server never takes a card id on its own. */
  threadId: string;
  payload: unknown;
}

/** A valid ISO-4217 code is exactly 3 ASCII letters. An empty/invalid code (e.g. a node that
 *  never carried currency) would make Intl.NumberFormat throw — so we fall back to a plain number. */
function isValidCurrency(code: string | undefined): code is string {
  return typeof code === "string" && /^[A-Za-z]{3}$/.test(code);
}

/** Format a value-diff object as a human-readable string.
 *  Budget amounts are rendered using the object's `currency` field (÷100 minor→major). */
function fmtValue(v: Record<string, unknown>, currency?: string): string {
  const parts: string[] = [];
  if (v.dailyBudgetMinor != null) {
    const cur = currency ?? (v.currency as string | undefined);
    const major = Number(v.dailyBudgetMinor) / 100;
    const fmt = isValidCurrency(cur)
      ? new Intl.NumberFormat(undefined, { style: "currency", currency: cur })
      : new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    parts.push(`${fmt.format(major)}/day`);
  }
  if (v.status != null) parts.push(String(v.status).toLowerCase());
  if (v.startTime != null) parts.push(`start ${v.startTime}`);
  if (v.endTime != null) parts.push(`end ${v.endTime}`);
  return parts.join(", ") || JSON.stringify(v);
}

/** Map from an op string to a human-readable verb. */
function opLabel(op: string): string {
  switch (op) {
    case "pause": return "Pause";
    case "resume": return "Resume";
    case "budget_up": return "Increase budget";
    case "budget_down": return "Decrease budget";
    case "reschedule": return "Reschedule";
    default: return op;
  }
}

/** Otto's Meta action-plan card. Shown for ACTION_CARD messages.
 *  - Renders the plan title, each step with a money-class badge, and the total spend impact.
 *  - If autoEligible the plan runs automatically; show status only, no approve/deny.
 *  - Otherwise the user must click Approve. Approve calls approveMetaActionPlan (real money gate),
 *    Deny calls ottoReject (FRONT-A12: the refusal is persisted server-side, so a refresh still
 *    shows it declined and the plan can never be approved afterwards). */
export function OttoActionPlanCard({ cardId, threadId, payload }: OttoActionPlanCardProps) {
  const p = (payload ?? {}) as Partial<MetaActionCardPayload>;
  const steps = Array.isArray(p.steps) ? p.steps : [];
  // WHICH button is in flight, not just "something is" — otherwise clicking Deny relabels
  // Approve to "Applying…" and the card claims a spend that is not happening.
  const [busyKind, setBusyKind] = useState<"approve" | "deny" | null>(null);
  const busy = busyKind !== null;
  const [deniedLocal, setDeniedLocal] = useState(false);
  const [result, setResult] = useState<{ ok: true; state: string } | { error: string } | null>(null);

  // A decline persisted on the card payload outlives this component — that is the whole point.
  const denied = deniedLocal || isDeclinedPayload(payload);

  async function approve() {
    if (busy || denied) return;
    setBusyKind("approve");
    try {
      const res = await approveMetaActionPlan(cardId);
      setResult(res);
    } catch {
      setResult({ error: "Couldn't submit — please try again." });
    } finally {
      setBusyKind(null);
    }
  }

  async function deny() {
    if (busy || denied) return;
    setBusyKind("deny");
    setResult(null);
    try {
      const res = await ottoReject({ threadId, cardId });
      // Anything but an error is a settled card: "already resolved" means someone else got there
      // first, and the plan is just as un-approvable as if this click had done it.
      if (res && typeof res === "object" && "error" in res) {
        setResult({ error: (res as { error: string }).error });
        return;
      }
      setDeniedLocal(true);
    } catch {
      setResult({ error: "Couldn't decline that — please try again." });
    } finally {
      setBusyKind(null);
    }
  }

  // FIX D: branch on the REAL persisted auto outcome, not just autoEligible. Only an auto-run that
  // actually ran shows the "handled automatically" line; a refused/declined auto-run (ran:false, or
  // no outcome recorded) leaves the card a normal PENDING proposal with Approve/Deny.
  const autoOutcome = p.autoOutcome;
  const autoRan = autoOutcome?.ran === true;
  const autoState = autoOutcome?.state;
  const showAutoStatus = autoRan; // a real auto-run happened → show its outcome, no buttons
  const approveResult = result && "ok" in result ? result : null;
  const errorMsg = result && "error" in result ? result.error : null;
  const isDone = approveResult?.state === "done";
  const isPartial = approveResult?.state === "partial";
  const isFailed = approveResult?.state === "failed";

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className="gb leading-[1.5]" style={{ maxWidth: 480 }}>
      {/* Card: tint variant = bg-accent (neutral #F4F4F3 tint), radius-card (18px), pad-card (p-6), border */}
      <div className="rounded-[18px] border border-border bg-secondary p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <ClipboardList size={20} className="text-foreground" />
          <span className="font-bold text-[0.8125rem] text-foreground">
            {p.planTitle || "Action plan"}
          </span>
        </div>

        {/* Steps list */}
        {steps.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {steps.map((step, i) => (
              <div
                key={i}
                className="bg-card rounded-[14px] flex flex-col gap-1"
                style={{ padding: "10px 12px" }}
              >
                {/* Target name + op label */}
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[0.875rem] text-foreground">
                    {step.targetName}
                  </span>
                  {/* money-class badge — per-step display only, no logic change */}
                  <span
                    className={`text-[0.75rem] font-semibold px-[7px] py-[2px] rounded-full ${
                      step.moneyClass === "spend"
                        ? "bg-warning-soft text-[var(--warning-soft-foreground)]"
                        : "bg-success-soft text-[var(--success-soft-foreground)]"
                    }`}
                  >
                    {step.moneyClass === "spend" ? "spend" : "safe"}
                  </span>
                </div>

                {/* Op + value diff */}
                <div className="text-[0.75rem] text-muted-foreground">
                  {opLabel(step.op)}{Object.keys(step.currentValue ?? {}).length > 0 && Object.keys(step.targetValue ?? {}).length > 0
                    ? `: ${fmtValue(step.currentValue ?? {}, step.currentValue?.currency as string | undefined)} → ${fmtValue(step.targetValue ?? {}, step.currentValue?.currency as string | undefined)}`
                    : ""}
                </div>

                {/* Evidence */}
                {step.evidence && (
                  <div className="text-[0.75rem] text-muted-foreground/70 italic">
                    {step.evidence}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Total spend impact */}
        {p.totalSpendImpactDisplay && (
          <div className="pt-3 border-t border-border mb-4">
            <span className="text-[0.75rem] text-muted-foreground">Total daily budget change: </span>
            <span className="font-bold text-[0.875rem] text-foreground">
              {p.totalSpendImpactDisplay}
            </span>
          </div>
        )}

        {/* Controls */}
        {showAutoStatus ? (
          /* A real auto-run happened — show its honest outcome, no buttons */
          autoState === "done" ? (
            <div className="flex items-center gap-2 text-[0.875rem] text-[var(--success-soft-foreground)]">
              <CheckCircle2 size={16} />
              <span>Otto handled this automatically ✓</span>
            </div>
          ) : autoState === "partial" ? (
            <div className="text-[0.875rem] text-[var(--warning-soft-foreground)]">
              Otto applied this automatically, but some steps may need attention.
            </div>
          ) : (
            <div className="text-[0.875rem] text-[var(--error-soft-foreground)]">
              Otto tried to apply this automatically but it failed — no changes were made.
            </div>
          )
        ) : denied ? (
          <div className="text-[0.875rem] text-muted-foreground">
            {ACTION_PLAN_DECLINE_TEXT}
          </div>
        ) : approveResult ? (
          /* Post-approve result */
          <div className="text-[0.875rem]">
            {isDone && (
              <div className="flex items-center gap-2 text-[var(--success-soft-foreground)]">
                <CheckCircle2 size={16} />
                <span>Done — all steps applied.</span>
              </div>
            )}
            {isPartial && (
              <div className="text-[var(--warning-soft-foreground)]">
                Partially applied — some steps may need attention.
              </div>
            )}
            {isFailed && (
              <div className="text-[var(--error-soft-foreground)]">
                Could not apply the plan — no changes were made.
              </div>
            )}
          </div>
        ) : (
          /* Pending approval */
          <div className="flex gap-3">
            <Button variant="default" disabled={busy} onClick={approve}>
              {busyKind === "approve" ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                  Applying…
                </span>
              ) : "Approve"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={deny}>
              {busyKind === "deny" ? "Declining…" : "Deny"}
            </Button>
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <Alert role="alert" variant="destructive" density="compact" className="mt-2">
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}

        {/* Trust footer */}
        {!approveResult && !denied && !showAutoStatus && (
          <div className="flex items-center gap-[6px] mt-3 text-[0.75rem] text-muted-foreground/70">
            <ShieldCheck size={15} /> Otto only does this after you approve.
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default OttoActionPlanCard;
