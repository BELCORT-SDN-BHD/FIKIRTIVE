"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowLeft, LoaderCircle, Megaphone, Unplug } from "lucide-react";
import { orgRolesAllow } from "@fikirtive/core/org-roles";
import { createBroadcastRun } from "@/lib/customer-broadcast-ui-actions";
import type { getBroadcastComposerOptions, getMemberDirectory } from "@/lib/customer-broadcast-gateway";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  channelConnectionFromAccounts,
  channelConnectionHeadline,
  channelUnavailableCopy,
  hasChannelAccountOnFile,
} from "@/lib/crm-channel-connection";
import { channelAccountLabel, errorMessage, isDenialErrorCode, purposeLabel } from "./broadcast-format";

type OptionsResult = Awaited<ReturnType<typeof getBroadcastComposerOptions>>;
type OptionsSuccess = Extract<OptionsResult, { ok: true }>;
type Options = OptionsSuccess["resource"];
type DirectoryResult = Awaited<ReturnType<typeof getMemberDirectory>>;

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
  const selfRoles = directory ? (directory.self.roles ?? [directory.self.role]) : [];
  const canManage = orgRolesAllow(selfRoles, "broadcast.manage");

  if (!canManage) {
    return (
      <Notice
        title="Broadcast management access is required"
        message="You can review broadcasts, but your current access cannot create, freeze, confirm, or run one."
      />
    );
  }
  if (!options) {
    return <Notice title="Could not load the composer" message={errorMessage(initialOptions.ok ? "INVALID_ARGUMENT" : initialOptions.error)} />;
  }

  // #727 — one authority decides whether this workspace has a channel and supplies the words.
  const connection = channelConnectionFromAccounts(options.channelScopes);
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
          <span className="grid size-11 place-items-center rounded-xl bg-accent text-foreground"><Megaphone className="size-5" /></span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">New broadcast</h1>
            <p className="text-sm text-muted-foreground">Choose the channel, template, and audience. Nothing is sent — the next step is a simulated run.</p>
          </div>
        </div>

        <form className="mt-8 flex flex-col gap-6" onSubmit={onSubmit}>
          <FieldGroup className="gap-6">
          {/* 判官 r2 P1-1: the dropdown exists when an ACCOUNT exists. A lapsed connection still
              leaves an identity this form can name, and the banner above already says the
              connection is not live — the form does not get to invent a second refusal. */}
          {hasChannelAccountOnFile(connection) === false ? (
            // #495/#541 — a zero-channel workspace gets an honest empty state instead of an
            // empty dropdown. No CTA into Connections: Messaging has no connect button there
            // yet, so that button was a dead end. Create stays disabled until a channel
            // account exists.
            <Field>
              <FieldLabel>Channel account</FieldLabel>
              <div className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center">
                <Unplug className="mx-auto size-6 text-muted-foreground" />
                {/* #727 — same words as every other CRM surface, from the one authority. */}
                <p className="mt-3 text-sm font-semibold">{channelConnectionHeadline(connection)}</p>
                <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                  {channelUnavailableCopy("A broadcast goes out through a connected channel account.")}
                </p>
              </div>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="broadcast-channel-account">Channel account</FieldLabel>
              <Select value={channelScopeId} onValueChange={(value) => { setChannelScopeId(value); setTemplateVersionId(""); }} disabled={submitting}>
                <SelectTrigger id="broadcast-channel-account" className="w-full" aria-label="Channel account">
                  <SelectValue placeholder="Select a channel account…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {options.channelScopes.map((scope) => (
                      <SelectItem key={scope.id} value={scope.id}>{channelAccountLabel(scope)}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="broadcast-template-version">Template version</FieldLabel>
            <Select value={templateVersionId} onValueChange={setTemplateVersionId} disabled={submitting}>
              <SelectTrigger id="broadcast-template-version" className="w-full" aria-label="Template version">
                <SelectValue placeholder="Select a template…" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {templatesForScope.map((version) => (
                    <SelectItem key={version.id} value={version.id} disabled={!version.broadcastPurpose}>
                      {version.template.name} · v{version.revision} ({version.broadcastPurpose ? purposeLabel(version.broadcastPurpose) : "Unavailable"})
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="broadcast-purpose">Purpose</FieldLabel>
            <Input id="broadcast-purpose" readOnly aria-live="polite" value={selectedPurpose ? purposeLabel(selectedPurpose) : "Select a template to see its purpose"} />
            <FieldDescription>Purpose comes from the template&apos;s stored classification and cannot be changed here.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="broadcast-campaign">Campaign <span className="font-normal text-muted-foreground">(optional grouping)</span></FieldLabel>
            <Select value={campaignId || "__no_campaign__"} onValueChange={(value) => setCampaignId(value === "__no_campaign__" ? "" : value)} disabled={submitting}>
              <SelectTrigger id="broadcast-campaign" className="w-full" aria-label="Campaign"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="__no_campaign__">No campaign</SelectItem>
                  {options.campaigns.map((campaign) => <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="broadcast-audience-segment">Audience segment</FieldLabel>
            <Select value={segmentId} onValueChange={setSegmentId} disabled={submitting}>
              <SelectTrigger id="broadcast-audience-segment" className="w-full" aria-label="Audience segment"><SelectValue placeholder="Select a segment…" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {options.segments.map((segment) => <SelectItem key={segment.id} value={segment.id}>{segment.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>Contacts with unknown permission stay in the audience — they are flagged, never dropped.</FieldDescription>
          </Field>
          </FieldGroup>

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
