"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowLeft, LoaderCircle, Megaphone } from "lucide-react";
import { createBroadcastRun } from "@/lib/customer-broadcast-ui-actions";
import type { getBroadcastComposerOptions, getMemberDirectory } from "@/lib/customer-broadcast-gateway";
import { Button } from "@/components/ui/button";
import { errorMessage, isDenialErrorCode, purposeLabel } from "./broadcast-format";

type OptionsResult = Awaited<ReturnType<typeof getBroadcastComposerOptions>>;
type OptionsSuccess = Extract<OptionsResult, { ok: true }>;
type Options = OptionsSuccess["resource"];
type DirectoryResult = Awaited<ReturnType<typeof getMemberDirectory>>;

const selectClass =
  "min-h-11 w-full rounded-[var(--radius-input)] border border-border bg-background px-3 text-sm text-foreground shadow-[var(--shadow-xs)] focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

function Notice({ title, message }: { title: string; message: string }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground">
          <AlertCircle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM Broadcasts</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Button asChild className="mt-6" variant="secondary"><Link href="/crm/broadcasts"><ArrowLeft />Back to broadcasts</Link></Button>
      </section>
    </main>
  );
}

export default function BroadcastComposerPage({
  initialOptions,
  initialDirectory,
}: {
  initialOptions: OptionsResult;
  initialDirectory: DirectoryResult;
}) {
  const router = useRouter();
  // A stable key for this composer instance so a double-submit never creates two runs.
  const [idempotencyKey] = useState(() => `bc-${crypto.randomUUID()}`);
  const [channelScopeId, setChannelScopeId] = useState("");
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  if (!initialOptions.ok && isDenialErrorCode(initialOptions.error)) {
    return <Notice title="This workspace is not available" message={errorMessage(initialOptions.error)} />;
  }
  const options: Options | null = initialOptions.ok ? initialOptions.resource : null;
  const directory = initialDirectory.ok ? initialDirectory.resource : null;
  const isOwner = directory?.self.role === "owner";

  if (!isOwner) {
    return (
      <Notice
        title="Only an owner can create a broadcast"
        message="You can review broadcasts, but creating, freezing, confirming, or running one is limited to an owner account."
      />
    );
  }
  if (!options) {
    return <Notice title="Could not load the composer" message={errorMessage(initialOptions.ok ? "INVALID_ARGUMENT" : initialOptions.error)} />;
  }

  const selectedScope = options.channelScopes.find((s) => s.id === channelScopeId) ?? null;
  const templatesForScope = options.templateVersions.filter(
    (v) => !selectedScope || v.template.channelScopeId === selectedScope.id,
  );
  const selectedTemplate = templatesForScope.find((v) => v.id === templateVersionId) ?? null;
  const selectedPurpose = selectedTemplate?.broadcastPurpose ?? null;

  const canSubmit = Boolean(channelScopeId && segmentId && selectedPurpose) && !submitting;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedScope || !segmentId) return;
    setSubmitting(true);
    setErrorCode(null);
    try {
      const result = await createBroadcastRun({
        channelScopeId: selectedScope.id,
        channel: selectedScope.channel,
        templateVersionId,
        campaignId: campaignId || null,
        creationIdempotencyKey: idempotencyKey,
      });
      if ("error" in result) {
        setErrorCode(result.error);
        return;
      }
      // Carry the chosen segment forward so the detail page pre-selects it for the freeze step.
      router.push(`/crm/broadcasts/${result.resource.id}?segment=${encodeURIComponent(segmentId)}`);
    } catch {
      setErrorCode("NETWORK");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-2xl">
        <Link href="/crm/broadcasts" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" />Back to broadcasts
        </Link>
        <div className="mt-4 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand"><Megaphone className="size-5" /></span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">New broadcast</h1>
            <p className="text-sm text-muted-foreground">Choose the channel, template, and audience. Nothing is sent — the next step is a simulated run.</p>
          </div>
        </div>

        <form className="mt-8 grid gap-6" onSubmit={onSubmit}>
          <label className="grid gap-2">
            <span className="text-sm font-semibold">Channel account</span>
            <select className={selectClass} value={channelScopeId} onChange={(e) => { setChannelScopeId(e.target.value); setTemplateVersionId(""); }} disabled={submitting}>
              <option value="">Select a channel account…</option>
              {options.channelScopes.map((scope) => (
                <option key={scope.id} value={scope.id}>{scope.channel} · {scope.scopeKey}</option>
              ))}
            </select>
            {options.channelScopes.length === 0 ? (
              <span className="text-xs text-muted-foreground">No channel account exists in this workspace yet.</span>
            ) : null}
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold">Template version</span>
            <select className={selectClass} value={templateVersionId} onChange={(e) => setTemplateVersionId(e.target.value)} disabled={submitting}>
              <option value="">Select a template…</option>
              {templatesForScope.map((v) => (
                <option key={v.id} value={v.id} disabled={!v.broadcastPurpose}>
                  {v.template.name} · v{v.revision} ({v.broadcastPurpose ? purposeLabel(v.broadcastPurpose) : "Unavailable"})
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-2">
            <span className="text-sm font-semibold">Purpose</span>
            <div className={`${selectClass} flex items-center`} aria-live="polite">
              {selectedPurpose ? purposeLabel(selectedPurpose) : "Select a template to see its purpose"}
            </div>
            <span className="text-xs text-muted-foreground">Purpose comes from the template&apos;s stored classification and cannot be changed here.</span>
          </div>

          <label className="grid gap-2">
            <span className="text-sm font-semibold">Campaign <span className="font-normal text-muted-foreground">(optional grouping)</span></span>
            <select className={selectClass} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={submitting}>
              <option value="">No campaign</option>
              {options.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold">Audience segment</span>
            <select className={selectClass} value={segmentId} onChange={(e) => setSegmentId(e.target.value)} disabled={submitting}>
              <option value="">Select a segment…</option>
              {options.segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">Contacts with unknown permission stay in the audience — they are flagged, never dropped.</span>
          </label>

          {errorCode ? <p className="text-sm text-destructive">{errorMessage(errorCode)}</p> : null}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!canSubmit}>{submitting ? <LoaderCircle className="animate-spin" /> : null}Create broadcast</Button>
            <Button asChild type="button" variant="ghost"><Link href="/crm/broadcasts">Cancel</Link></Button>
          </div>
        </form>
      </div>
    </main>
  );
}
