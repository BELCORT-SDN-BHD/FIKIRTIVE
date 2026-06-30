"use client";
import React, { useState } from "react";
import { Hammer, ShieldCheck, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const needsReviewAfterApprove = approveOk?.state === "needs_review";

  // Persisted needs-review (e.g. an AUTO build hit an interrupted prior attempt): the build
  // was refused to avoid duplicate ads. Surface the honest reason, offer NO one-click re-build.
  const persistedNeedsReview = buildOutcome?.state === "needs_review";
  const needsReview = needsReviewAfterApprove || persistedNeedsReview;
  const needsReviewReason =
    buildOutcome?.reason ||
    "A previous build was interrupted partway — I won't risk creating duplicate ads. " +
      "Please check your Meta Ads Manager, then ask me to build again.";

  // The effective "built" state: either persisted from auto-build or from this session's approve
  const effectivelyBuilt = isBuilt || builtAfterApprove;
  const effectiveCreatedIds = effectivelyBuilt
    ? (isBuilt ? createdIds : (approveOk?.createdIds ?? {}))
    : {};

  const { campaignId, adsetId, adId } = effectiveCreatedIds;
  // Launch only once all three created ids are present (launchAdDraft re-checks server-side).
  const launchReady = effectivelyBuilt && !!campaignId && !!adsetId && !!adId;

  // Account currency carried on the payload (sourced from the ad ACCOUNT at propose time).
  // fmtBudget falls back to a plain number when missing/invalid.
  const currency = p.currency;

  return (
    // leading-[1.65] pins the line-height this subtree currently INHERITS from the .fk
    // ancestor (--leading-relaxed); it survives S4 teardown (when .fk/otto-theme.css is
    // removed and .gb — which sets no line-height — applies at the root). Value-identical
    // today → zero visual change; without it the text compacts post-teardown.
    <div className="gb leading-[1.65]" style={{ maxWidth: 480 }}>
      {/* Card variant="tint" padding="md": bg=--brand-tint=#F4F4F3=bg-accent, radius=--radius-card=18px, pad=--pad-card=--space-6=p-6, border=--border-subtle */}
      <div className="rounded-[18px] border border-border bg-accent p-6">
        {/* Header */}
        <div className="mb-4 flex items-center gap-2">
          <Hammer size={20} className="text-primary" />
          <span className="text-[1rem] font-bold text-foreground">
            {p.goal || "Ad build"}
          </span>
        </div>

        {/* Strategy */}
        {p.reasoning && (
          <div className="mb-3 text-[0.875rem] leading-relaxed text-muted-foreground">
            {p.reasoning}
          </div>
        )}

        {/* Details rows */}
        <div className="mb-4 flex flex-col gap-2">
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
          <div className="mb-4 flex flex-col gap-1 rounded-[14px] bg-card px-3 py-[10px]">
            <span className="text-[0.75rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground/70">
              Creative
            </span>
            {p.creative.headline && (
              <span className="text-[0.875rem] font-semibold text-foreground">
                {p.creative.headline}
              </span>
            )}
            <span className="text-[0.875rem] leading-relaxed text-foreground">
              {p.creative.message}
            </span>
            <div className="flex gap-3 text-[0.75rem] text-muted-foreground">
              <span>CTA: {p.creative.cta}</span>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{p.creative.link}</span>
            </div>
            <span className="text-[0.75rem] text-muted-foreground/70">
              {p.creative.kind} asset · {(p.creative.assetId ?? "").slice(0, 12)}…
            </span>
          </div>
        )}

        {/* Controls */}
        {effectivelyBuilt ? (
          /* Draft is built — offer Launch via v1 resume gate */
          launchResult ? (
            "actionCardId" in launchResult ? (
              <div className="flex items-center gap-2 text-[0.875rem] text-[var(--success)]">
                <CheckCircle2 size={16} />
                <span>Launch plan queued — approve the action card above to go live.</span>
              </div>
            ) : "metaFallback" in launchResult ? (
              <div className="text-[0.875rem] text-muted-foreground">
                <span>Campaign created but IDs are incomplete — </span>
                <a
                  href="https://www.facebook.com/adsmanager"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline"
                >
                  review &amp; launch in Meta Ads Manager <ExternalLink size={12} />
                </a>
              </div>
            ) : null
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-[0.875rem] text-[var(--success)]">
                <CheckCircle2 size={16} />
                <span>Draft built ✓ — review &amp; <strong>Launch</strong></span>
              </div>
              {launchReady ? (
                <Button variant="default" size="default" disabled={busy} onClick={launch}>
                  {busy ? (
                    <span className="flex items-center gap-2">
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
                  className="inline-flex items-center gap-1 text-[0.875rem] text-primary underline"
                >
                  Review &amp; launch in Meta Ads Manager <ExternalLink size={12} />
                </a>
              )}
            </div>
          )
        ) : partialAfterApprove ? (
          <div className="text-[0.875rem] text-[var(--warning-soft-foreground)]">
            Build partially completed — some steps may need attention. Check Meta Ads Manager.
          </div>
        ) : failedAfterApprove ? (
          <div className="text-[0.875rem] text-[var(--error-soft-foreground)]">
            Build failed — nothing was created.
          </div>
        ) : needsReview ? (
          /* Interrupted prior build — refused to re-create. Honest reason, no one-click rebuild. */
          <div role="alert" className="text-[0.875rem] text-[var(--warning-soft-foreground)]">
            {needsReviewReason}
          </div>
        ) : buildOutcome && buildOutcome.built === false && buildOutcome.reason ? (
          /* Auto-build was attempted but refused/failed — show why, offer manual approve */
          <div className="flex flex-col gap-3">
            <div className="text-[0.875rem] text-muted-foreground">
              Auto-build skipped ({buildOutcome.reason}). Click Approve to build now.
            </div>
            {!denied && !approveResult && (
              <div className="flex gap-3">
                <Button variant="default" size="default" disabled={busy} onClick={approve}>
                  {busy ? (
                    <span className="flex items-center gap-2">
                      <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                      Building…
                    </span>
                  ) : "Approve"}
                </Button>
                <Button variant="outline" size="default" disabled={busy} onClick={() => setDenied(true)}>
                  Deny
                </Button>
              </div>
            )}
            {denied && (
              <div className="text-[0.875rem] text-muted-foreground">
                Build declined — nothing was created.
              </div>
            )}
          </div>
        ) : denied ? (
          <div className="text-[0.875rem] text-muted-foreground">
            Build declined — nothing was created.
          </div>
        ) : (
          /* Pending approval */
          <div className="flex gap-3">
            <Button variant="default" size="default" disabled={busy} onClick={approve}>
              {busy ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                  Building…
                </span>
              ) : "Approve"}
            </Button>
            <Button variant="outline" size="default" disabled={busy} onClick={() => setDenied(true)}>
              Deny
            </Button>
          </div>
        )}

        {/* Errors */}
        {approveErr && (
          <div role="alert" className="mt-2 text-[0.875rem] text-[var(--error-soft-foreground)]">
            {approveErr}
          </div>
        )}
        {launchErr && (
          <div role="alert" className="mt-2 text-[0.875rem] text-[var(--error-soft-foreground)]">
            {launchErr}
          </div>
        )}

        {/* Trust footer */}
        {!effectivelyBuilt && !denied && !approveResult && (
          <div className="mt-3 flex items-center gap-1.5 text-[0.75rem] text-muted-foreground/70">
            <ShieldCheck size={15} /> Otto builds this <strong>paused</strong> — nothing spends until you launch.
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-[0.875rem]">
      <span className="min-w-[72px] shrink-0 text-muted-foreground/70">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

export default OttoAdBuildCard;
