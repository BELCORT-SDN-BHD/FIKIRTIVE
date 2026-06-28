"use client";
import React, { useState } from "react";
import { ClipboardList, ShieldCheck, CheckCircle2, Loader2 } from "lucide-react";
import { Card, Button } from "@/components/fk";
import { approveMetaActionPlan } from "@/lib/otto-client-actions";
import type { MetaActionCardPayload } from "@/lib/meta-plan-card";

export interface OttoActionPlanCardProps {
  cardId: string;
  payload: unknown;
}

/** Format a value-diff object as a human-readable string. */
function fmtValue(v: Record<string, unknown>): string {
  const parts: string[] = [];
  if (v.dailyBudgetMinor != null) parts.push(`$${(Number(v.dailyBudgetMinor) / 100).toFixed(2)}/day`);
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
 *  - Otherwise the user must click Approve. Approve calls approveMetaActionPlan (real money gate). */
export function OttoActionPlanCard({ cardId, payload }: OttoActionPlanCardProps) {
  const p = (payload ?? {}) as Partial<MetaActionCardPayload>;
  const steps = Array.isArray(p.steps) ? p.steps : [];
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [result, setResult] = useState<{ ok: true; state: string } | { error: string } | null>(null);

  async function approve() {
    if (busy || denied) return;
    setBusy(true);
    try {
      const res = await approveMetaActionPlan(cardId);
      setResult(res);
    } catch {
      setResult({ error: "Couldn't submit — please try again." });
    } finally {
      setBusy(false);
    }
  }

  const isAutoEligible = p.autoEligible === true;
  const approveResult = result && "ok" in result ? result : null;
  const errorMsg = result && "error" in result ? result.error : null;
  const isDone = approveResult?.state === "done";
  const isPartial = approveResult?.state === "partial";
  const isFailed = approveResult?.state === "failed";

  return (
    <div style={{ maxWidth: 480 }}>
      <Card variant="tint" padding="md">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
          <ClipboardList size={20} color="var(--brand)" />
          <span style={{ fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-base)", color: "var(--text-strong)" }}>
            {p.planTitle || "Action plan"}
          </span>
        </div>

        {/* Steps list */}
        {steps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
            {steps.map((step, i) => (
              <div
                key={i}
                style={{
                  background: "var(--surface-card)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-1)",
                }}
              >
                {/* Target name + op label */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
                  <span style={{ fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-sm)", color: "var(--text-strong)" }}>
                    {step.targetName}
                  </span>
                  {/* money-class badge */}
                  <span
                    style={{
                      fontSize: "var(--text-xs)",
                      fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"],
                      padding: "2px 7px",
                      borderRadius: 99,
                      background: step.moneyClass === "spend" ? "var(--warning-100, #fef3c7)" : "var(--success-100, #dcfce7)",
                      color: step.moneyClass === "spend" ? "var(--warning-700, #b45309)" : "var(--success-700, #15803d)",
                    }}
                  >
                    {step.moneyClass === "spend" ? "spend" : "safe"}
                  </span>
                </div>

                {/* Op + value diff */}
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  {opLabel(step.op)}{Object.keys(step.currentValue ?? {}).length > 0 && Object.keys(step.targetValue ?? {}).length > 0
                    ? `: ${fmtValue(step.currentValue ?? {})} → ${fmtValue(step.targetValue ?? {})}`
                    : ""}
                </div>

                {/* Evidence */}
                {step.evidence && (
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", fontStyle: "italic" }}>
                    {step.evidence}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Total spend impact */}
        {p.totalSpendImpactDisplay && (
          <div style={{ paddingTop: "var(--space-3)", borderTop: "1px solid var(--border-subtle)", marginBottom: "var(--space-4)" }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Total daily budget change: </span>
            <span style={{ fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-sm)", color: "var(--text-strong)" }}>
              {p.totalSpendImpactDisplay}
            </span>
          </div>
        )}

        {/* Controls */}
        {isAutoEligible ? (
          /* Auto mode — no buttons, just status */
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--success-700, #15803d)" }}>
            <CheckCircle2 size={16} />
            <span>Otto is handling this automatically.</span>
          </div>
        ) : approveResult ? (
          /* Post-approve result */
          <div style={{ fontSize: "var(--text-sm)" }}>
            {isDone && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "var(--success-700, #15803d)" }}>
                <CheckCircle2 size={16} />
                <span>Done — all steps applied.</span>
              </div>
            )}
            {isPartial && (
              <div style={{ color: "var(--warning-700, #b45309)" }}>
                Partially applied — some steps may need attention.
              </div>
            )}
            {isFailed && (
              <div style={{ color: "var(--error-700, #b91c1c)" }}>
                Could not apply the plan — no changes were made.
              </div>
            )}
          </div>
        ) : denied ? (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            Plan declined — nothing was changed.
          </div>
        ) : (
          /* Pending approval */
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <Button variant="primary" size="md" disabled={busy} onClick={approve}>
              {busy ? (
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                  Applying…
                </span>
              ) : "Approve"}
            </Button>
            <Button variant="secondary" size="md" disabled={busy} onClick={() => setDenied(true)}>
              Deny
            </Button>
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div role="alert" style={{ marginTop: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--error-700, #b91c1c)" }}>
            {errorMsg}
          </div>
        )}

        {/* Trust footer */}
        {!approveResult && !denied && !isAutoEligible && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "var(--space-3)", fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>
            <ShieldCheck size={15} /> Otto only does this after you approve.
          </div>
        )}
      </Card>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default OttoActionPlanCard;
