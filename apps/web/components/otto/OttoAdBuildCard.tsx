"use client";
import React, { useState } from "react";
import { Hammer, ShieldCheck, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import { Card, Button } from "@/components/fk";
import { approveAdBuild, launchAdDraft } from "@/lib/otto-client-actions";
import type { MetaAdBuildCardPayload } from "@/lib/meta-build-spec";

export interface OttoAdBuildCardProps {
  cardId: string;
  payload: unknown;
}

/** Mirrors the v1 guard in OttoActionPlanCard. */
function isValidCurrency(code: string | undefined): code is string {
  return typeof code === "string" && /^[A-Za-z]{3}$/.test(code);
}

/** Format dailyBudgetMinor (integer minor units) as a currency string, or plain number. */
function fmtBudget(minor: number, currency: string | undefined): string {
  const major = minor / 100;
  const fmt = isValidCurrency(currency)
    ? new Intl.NumberFormat(undefined, { style: "currency", currency })
    : new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${fmt.format(major)}/day`;
}

/** Human-readable objective labels. */
function objectiveLabel(obj: string): string {
  switch (obj) {
    case "OUTCOME_TRAFFIC":    return "Traffic";
    case "OUTCOME_ENGAGEMENT": return "Engagement";
    case "OUTCOME_LEADS":      return "Leads";
    case "OUTCOME_SALES":      return "Sales";
    default:                   return obj;
  }
}

/** Compact targeting summary: show countries + age range if present. */
function targetingSummary(targeting: Record<string, unknown>): string {
  const parts: string[] = [];
  const geo = targeting.geo_locations as { countries?: string[] } | undefined;
  if (geo?.countries?.length) parts.push(geo.countries.join(", "));
  const ageMin = targeting.age_min as number | undefined;
  const ageMax = targeting.age_max as number | undefined;
  if (ageMin || ageMax) parts.push(`Ages ${ageMin ?? ""}–${ageMax ?? ""}`);
  const flex = targeting.flexible_spec as Array<{ interests?: Array<{ name?: string }> }> | undefined;
  if (flex?.length) {
    const interests = flex[0]?.interests?.map((i) => i.name ?? "").filter(Boolean) ?? [];
    if (interests.length) parts.push(interests.slice(0, 3).join(", "));
  }
  return parts.join(" · ") || "Broad";
}

export function OttoAdBuildCard({ cardId, payload }: OttoAdBuildCardProps) {
  const p = (payload ?? {}) as Partial<MetaAdBuildCardPayload>;

  // buildOutcome is stamped by maybeAutoBuild / the approveAdBuild path
  const buildOutcome = p.buildOutcome as
    | { built: boolean; state?: string; createdIds?: Record<string, string>; reason?: string }
    | undefined;
  const isBuilt = buildOutcome?.built === true && buildOutcome?.state === "done";
  const createdIds = buildOutcome?.createdIds ?? {};

  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [approveResult, setApproveResult] = useState<
    { ok: true; state: string; createdIds: Record<string, string> } | { error: string } | null
  >(null);
  const [launchResult, setLaunchResult] = useState<
    | { actionCardId: string }
    | { metaFallback: true }
    | { error: string }
    | null
  >(null);

  async function approve() {
    if (busy || denied) return;
    setBusy(true);
    try {
      const res = await approveAdBuild(cardId);
      setApproveResult(res);
    } catch {
      setApproveResult({ error: "Couldn't submit — please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function launch() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await launchAdDraft(cardId);
      setLaunchResult(res);
    } catch {
      setLaunchResult({ error: "Couldn't queue the launch — please try again." });
    } finally {
      setBusy(false);
    }
  }

  const approveOk = approveResult && "ok" in approveResult ? approveResult : null;
  const approveErr = approveResult && "error" in approveResult ? approveResult.error : null;
  const launchErr = launchResult && "error" in launchResult ? launchResult.error : null;

  // Post-approve: show the built state
  const builtAfterApprove = approveOk?.state === "done";
  const partialAfterApprove = approveOk?.state === "partial";
  const failedAfterApprove = approveOk?.state === "failed";

  // The effective "built" state: either persisted from auto-build or from this session's approve
  const effectivelyBuilt = isBuilt || builtAfterApprove;
  const effectiveCreatedIds = effectivelyBuilt
    ? (isBuilt ? createdIds : (approveOk?.createdIds ?? {}))
    : {};

  const campaignId = effectiveCreatedIds.campaignId;
  const launchReady = effectivelyBuilt && !!campaignId;

  // Account currency (from MetaConnection data — not in payload, derive gracefully)
  // We don't have the currency in the payload; use undefined → plain number guard
  const currency = undefined as string | undefined;

  return (
    <div style={{ maxWidth: 480 }}>
      <Card variant="tint" padding="md">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
          <Hammer size={20} color="var(--brand)" />
          <span style={{ fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-base)", color: "var(--text-strong)" }}>
            {p.goal || "Ad build"}
          </span>
        </div>

        {/* Strategy */}
        {p.reasoning && (
          <div style={{ marginBottom: "var(--space-3)", fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: "var(--leading-relaxed)" }}>
            {p.reasoning}
          </div>
        )}

        {/* Details rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
          {/* Objective */}
          {p.objective && (
            <DetailRow label="Objective" value={objectiveLabel(p.objective)} />
          )}
          {/* Targeting */}
          {p.targeting && (
            <DetailRow label="Targeting" value={targetingSummary(p.targeting)} />
          )}
          {/* Budget */}
          {p.dailyBudgetMinor != null && (
            <DetailRow label="Budget" value={fmtBudget(p.dailyBudgetMinor, currency)} />
          )}
          {/* Page */}
          {p.pageId && (
            <DetailRow label="Page" value={p.pageId} />
          )}
          {/* Start */}
          {p.startTime && (
            <DetailRow label="Start" value={p.startTime} />
          )}
        </div>

        {/* Creative preview */}
        {p.creative && (
          <div
            style={{
              background: "var(--surface-card)",
              borderRadius: "var(--radius-md)",
              padding: "10px 12px",
              marginBottom: "var(--space-4)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-1)",
            }}
          >
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"] }}>
              Creative
            </span>
            {p.creative.headline && (
              <span style={{ fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-sm)", color: "var(--text-strong)" }}>
                {p.creative.headline}
              </span>
            )}
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-body)", lineHeight: "var(--leading-relaxed)" }}>
              {p.creative.message}
            </span>
            <div style={{ display: "flex", gap: "var(--space-3)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              <span>CTA: {p.creative.cta}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.creative.link}</span>
            </div>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>
              {p.creative.kind} asset · {(p.creative.assetId ?? "").slice(0, 12)}…
            </span>
          </div>
        )}

        {/* Controls */}
        {effectivelyBuilt ? (
          /* Draft is built — offer Launch via v1 resume gate */
          launchResult ? (
            "actionCardId" in launchResult ? (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--success-700, #15803d)" }}>
                <CheckCircle2 size={16} />
                <span>Launch plan queued — approve the action card above to go live.</span>
              </div>
            ) : "metaFallback" in launchResult ? (
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                <span>Campaign created but IDs are incomplete — </span>
                <a
                  href="https://www.facebook.com/adsmanager"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--brand)", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  review & launch in Meta Ads Manager <ExternalLink size={12} />
                </a>
              </div>
            ) : null
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--success-700, #15803d)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <CheckCircle2 size={16} />
                <span>Draft built ✓ — review & <strong>Launch</strong></span>
              </div>
              {launchReady ? (
                <Button variant="primary" size="md" disabled={busy} onClick={launch}>
                  {busy ? (
                    <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                      Queuing…
                    </span>
                  ) : "Launch"}
                </Button>
              ) : (
                <a
                  href="https://www.facebook.com/adsmanager"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--brand)", fontSize: "var(--text-sm)", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  Review & launch in Meta Ads Manager <ExternalLink size={12} />
                </a>
              )}
            </div>
          )
        ) : partialAfterApprove ? (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--warning-700, #b45309)" }}>
            Build partially completed — some steps may need attention. Check Meta Ads Manager.
          </div>
        ) : failedAfterApprove ? (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--error-700, #b91c1c)" }}>
            Build failed — nothing was created.
          </div>
        ) : buildOutcome && buildOutcome.built === false && buildOutcome.reason ? (
          /* Auto-build was attempted but refused/failed — show why, offer manual approve */
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              Auto-build skipped ({buildOutcome.reason}). Click Approve to build now.
            </div>
            {!denied && !approveResult && (
              <div style={{ display: "flex", gap: "var(--space-3)" }}>
                <Button variant="primary" size="md" disabled={busy} onClick={approve}>
                  {busy ? (
                    <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                      Building…
                    </span>
                  ) : "Approve"}
                </Button>
                <Button variant="secondary" size="md" disabled={busy} onClick={() => setDenied(true)}>
                  Deny
                </Button>
              </div>
            )}
            {denied && (
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                Build declined — nothing was created.
              </div>
            )}
          </div>
        ) : denied ? (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            Build declined — nothing was created.
          </div>
        ) : (
          /* Pending approval */
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <Button variant="primary" size="md" disabled={busy} onClick={approve}>
              {busy ? (
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                  Building…
                </span>
              ) : "Approve"}
            </Button>
            <Button variant="secondary" size="md" disabled={busy} onClick={() => setDenied(true)}>
              Deny
            </Button>
          </div>
        )}

        {/* Errors */}
        {approveErr && (
          <div role="alert" style={{ marginTop: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--error-700, #b91c1c)" }}>
            {approveErr}
          </div>
        )}
        {launchErr && (
          <div role="alert" style={{ marginTop: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--error-700, #b91c1c)" }}>
            {launchErr}
          </div>
        )}

        {/* Trust footer */}
        {!effectivelyBuilt && !denied && !approveResult && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "var(--space-3)", fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>
            <ShieldCheck size={15} /> Otto builds this <strong>paused</strong> — nothing spends until you launch.
          </div>
        )}
      </Card>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}>
      <span style={{ color: "var(--text-faint)", minWidth: 72, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "var(--text-body)" }}>{value}</span>
    </div>
  );
}

export default OttoAdBuildCard;
