"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowLeft, FileText, LoaderCircle, Plus, RefreshCw, ShieldAlert, Unplug } from "lucide-react";
import {
  createMessageTemplate,
  createMessageTemplateVersion,
  listTemplates,
} from "@/lib/customer-inbox-ui-actions";
import type { listChannelScopes } from "@/lib/customer-inbox-gateway";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dateTimeLabel, errorMessage, isDenialErrorCode } from "./inbox-format";

type ListResult = Awaited<ReturnType<typeof listTemplates>>;
type ListSuccess = Extract<ListResult, { ok: true }>;
type TemplateRow = ListSuccess["resource"][number];
type VersionRow = TemplateRow["versions"][number];
type ScopesResult = Awaited<ReturnType<typeof listChannelScopes>>;
type ScopesSuccess = Extract<ScopesResult, { ok: true }>;
type ChannelScopeRow = ScopesSuccess["resource"][number];

const selectClass =
  "min-h-11 w-full rounded-[var(--radius-input)] border border-border bg-background px-3 text-sm text-foreground shadow-[var(--shadow-xs)] focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

function submissionReason(state: string): string {
  if (state === "draft") return "Not yet submitted to a provider.";
  return `Local record: ${state.replaceAll("_", " ")}.`;
}
function reviewReason(state: string): string {
  if (state === "not_submitted") return "No review requested — provider submission isn't available yet.";
  return `Local record: ${state.replaceAll("_", " ")}.`;
}
function availabilityReason(state: string): string {
  if (state === "unavailable") return "No provider approval exists; this version cannot be sent.";
  return `Local record: ${state.replaceAll("_", " ")}.`;
}

function parseVariablesInput(raw: string): { key: string; sample: string }[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split("=");
      return { key: key.trim(), sample: rest.join("=").trim() };
    })
    .filter((variable) => variable.key.length > 0);
}

function DeniedState({ message }: { message: string }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground">
          <AlertCircle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This workspace is not available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Button asChild className="mt-6" variant="secondary"><Link href="/otto"><ArrowLeft />Return to Otto</Link></Button>
      </section>
    </main>
  );
}

export default function InboxTemplatesPage({
  initialState,
  initialScopes,
}: {
  initialState: ListResult;
  initialScopes: ScopesResult;
}) {
  if (!initialState.ok && isDenialErrorCode(initialState.error)) {
    return <DeniedState message={errorMessage(initialState.error)} />;
  }
  return (
    <TemplatesWorkspace
      initialTemplates={initialState.ok ? initialState.resource : []}
      initialErrorCode={initialState.ok ? null : initialState.error}
      scopes={initialScopes.ok ? initialScopes.resource : []}
      scopesErrorCode={initialScopes.ok ? null : initialScopes.error}
    />
  );
}

// Read failures that aren't a `{ code, message }` result from the ui-actions wrapper —
// a thrown transport/network error has no stable CustomerInboxErrorCode to show.
type ReadError = { kind: "code"; code: string } | { kind: "network" };

function readErrorMessage(error: ReadError): string {
  return error.kind === "code" ? errorMessage(error.code) : "The template request could not finish. Please retry.";
}

function TemplatesWorkspace({
  initialTemplates,
  initialErrorCode,
  scopes,
  scopesErrorCode,
}: {
  initialTemplates: TemplateRow[];
  initialErrorCode: string | null;
  scopes: ChannelScopeRow[];
  scopesErrorCode: string | null;
}) {
  const [templates, setTemplates] = useState<TemplateRow[]>(initialTemplates);
  const [scopeFilter, setScopeFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<ReadError | null>(
    initialErrorCode ? { kind: "code", code: initialErrorCode } : null,
  );

  const [channelScopeId, setChannelScopeId] = useState("");
  const [name, setName] = useState("");
  const [locale, setLocale] = useState("en_MY");
  const [creating, setCreating] = useState(false);
  const [createNotice, setCreateNotice] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // #495 — the displayed selection IS the submitted value: both the channelScopeId and the
  // channel come from the one workspace row the merchant picked, never from free text.
  const selectedScope = scopes.find((scope) => scope.id === channelScopeId) ?? null;

  async function refresh(nextScope = scopeFilter) {
    setLoading(true);
    setReadError(null);
    try {
      const result = await listTemplates(nextScope.trim() ? { channelScopeId: nextScope.trim() } : {});
      if (!result.ok) return setReadError({ kind: "code", code: result.error });
      setTemplates(result.resource);
    } catch {
      setReadError({ kind: "network" });
    } finally {
      setLoading(false);
    }
  }

  async function submitFilter(event: FormEvent) {
    event.preventDefault();
    await refresh();
  }

  async function submitTemplate(event: FormEvent) {
    event.preventDefault();
    if (!selectedScope || !name.trim() || !locale.trim()) return;
    setCreating(true);
    setCreateError(null);
    setCreateNotice(null);
    try {
      const result = await createMessageTemplate({
        channelScopeId: selectedScope.id,
        channel: selectedScope.channel,
        name: name.trim(),
        locale: locale.trim(),
      });
      if (!result.ok) return setCreateError(errorMessage(result.error));
      setName("");
      setCreateNotice("Template created as a local record. It has no provider submission yet.");
      await refresh();
    } catch {
      setCreateError("The template could not be created. Please retry.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-6xl">
        <Link href="/otto" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" />Return to Otto
        </Link>

        <header className="mt-4 border-b border-border pb-7">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">CRM</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Message templates</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            A logical template groups immutable versions. Every state shown here is a local Fikirtive record — not Meta or
            WhatsApp template status. No submission path exists yet.
          </p>
        </header>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>Submission, review, and availability below reflect what Fikirtive has stored, never a live provider decision.</span>
        </div>

        {scopesErrorCode ? (
          <Card className="mt-6">
            <CardHeader><CardTitle>New template</CardTitle><CardDescription>Every template belongs to one of this workspace&apos;s channel accounts.</CardDescription></CardHeader>
            <CardContent>
              <p className="text-sm text-destructive">
                The channel account list could not load ({scopesErrorCode}). Refresh the page to retry.
              </p>
            </CardContent>
          </Card>
        ) : scopes.length === 0 ? (
          <Card className="mt-6">
            <CardHeader><CardTitle>New template</CardTitle><CardDescription>Every template belongs to one of this workspace&apos;s channel accounts.</CardDescription></CardHeader>
            <CardContent>
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <Unplug className="mx-auto size-6 text-muted-foreground" />
                <p className="mt-3 text-sm font-semibold">No messaging channel is connected in this workspace yet</p>
                {/* #541 — no CTA into Connections: Messaging has no connect button there yet. */}
                <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                  Messaging channels are not available to connect yet. Templates open up once a channel can be connected.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mt-6">
            <CardHeader><CardTitle>New template</CardTitle><CardDescription>Pick the channel account the template belongs to — the selected account is exactly what is submitted.</CardDescription></CardHeader>
            <CardContent>
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitTemplate}>
                <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">Channel account
                  <select className={selectClass} value={channelScopeId} onChange={(event) => setChannelScopeId(event.target.value)} disabled={creating} aria-label="Channel account">
                    <option value="">Select a channel account…</option>
                    {scopes.map((scope) => (
                      <option key={scope.id} value={scope.id}>{scope.channel} · {scope.scopeKey}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">Template name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={128} aria-label="Template name" /></label>
                <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">Locale<Input value={locale} onChange={(event) => setLocale(event.target.value)} maxLength={32} aria-label="Locale" /></label>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={creating || !selectedScope || !name.trim() || !locale.trim()}>
                    {creating ? <LoaderCircle className="animate-spin" /> : <Plus />}Create template
                  </Button>
                </div>
              </form>
              {createError ? <p className="mt-3 text-sm text-destructive">{createError}</p> : null}
              {createNotice ? <p className="mt-3 text-sm text-success">{createNotice}</p> : null}
            </CardContent>
          </Card>
        )}

        <Card className="mt-5">
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={submitFilter}>
              <Input value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)} maxLength={256} placeholder="Filter by channel account ID (optional)" aria-label="Filter by channel account ID" />
              <Button type="submit" variant="secondary" disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : null}Apply filter</Button>
            </form>
            {readError ? (
              <p className="mt-3 text-sm text-destructive">
                {readErrorMessage(readError)}
                {readError.kind === "code" ? ` (${readError.code})` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {readError && templates.length === 0 ? (
          <section className="mt-5 rounded-[var(--radius-card)] border border-dashed border-destructive/40 bg-card px-6 py-14 text-center shadow-sm">
            <AlertCircle className="mx-auto size-8 text-destructive" />
            <h2 className="mt-4 text-lg font-semibold">Templates could not load</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{readErrorMessage(readError)}</p>
            {readError.kind === "code" ? <p className="mt-2 text-xs font-mono text-muted-foreground">Error code: {readError.code}</p> : null}
            <Button className="mt-5" type="button" variant="secondary" onClick={() => void refresh()} disabled={loading}>
              {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Retry
            </Button>
          </section>
        ) : templates.length === 0 ? (
          <section className="mt-5 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
            <FileText className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No templates recorded yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {scopes.length === 0
                ? "Templates appear here once a channel is connected and the first template is created."
                : "Create one above, or clear the channel scope filter."}
            </p>
          </section>
        ) : (
          <section className="mt-5 grid gap-4">
            {templates.map((template) => <TemplateCard key={template.id} template={template} onChanged={() => void refresh()} />)}
          </section>
        )}
      </div>
    </main>
  );
}

function TemplateCard({ template, onChanged }: { template: TemplateRow; onChanged: () => void }) {
  const [body, setBody] = useState("");
  const [variablesInput, setVariablesInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submitVersion(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createMessageTemplateVersion({
        templateId: template.id,
        body,
        variables: parseVariablesInput(variablesInput),
      });
      if (!result.ok) return setError(errorMessage(result.error));
      setBody("");
      setVariablesInput("");
      setNotice("Version saved as an immutable local record.");
      onChanged();
    } catch {
      setError("The version could not be saved. Please retry.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{template.name}</CardTitle>
            <CardDescription className="mt-1">{template.channel} · {template.locale} · scope {template.channelScope.scopeKey}</CardDescription>
          </div>
          {template.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {template.versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No versions recorded yet.</p>
        ) : (
          <div className="grid gap-3">
            {template.versions.map((version) => <VersionCard key={version.id} version={version} />)}
          </div>
        )}

        <form className="grid gap-2 border-t border-border pt-4" onSubmit={submitVersion}>
          <label className="text-xs font-semibold text-muted-foreground">New version body</label>
          <Textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={4096} rows={3} placeholder="Message body, e.g. Hello {{name}}" aria-label="Template version body" />
          <label className="text-xs font-semibold text-muted-foreground">Variables (one per line, key=sample value)</label>
          <Textarea value={variablesInput} onChange={(event) => setVariablesInput(event.target.value)} maxLength={2000} rows={2} placeholder="name=Aisyah" aria-label="Template variables" />
          <Button type="submit" size="sm" variant="secondary" className="w-fit" disabled={creating || !body.trim()}>
            {creating ? <LoaderCircle className="animate-spin" /> : <Plus />}Add version
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {notice ? <p className="text-sm text-success">{notice}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}

function VersionCard({ version }: { version: VersionRow }) {
  const definition = version.definitionJson as { body?: string; variables?: { key: string; sample: string }[] };
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Version {version.revision}</p>
        <p className="text-xs text-muted-foreground">Created {dateTimeLabel(version.createdAt)}</p>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-muted/45 p-3 text-sm">{definition.body ?? ""}</p>
      {definition.variables && definition.variables.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Variables: {definition.variables.map((variable) => `${variable.key}=${variable.sample}`).join(", ")}</p>
      ) : null}
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg border border-border p-2.5">
          <dt className="flex items-center justify-between gap-2 font-semibold">Submission<Badge variant="outline">{version.submissionState}</Badge></dt>
          <dd className="mt-1.5 text-muted-foreground">{submissionReason(version.submissionState)}</dd>
          <dd className="mt-1 text-muted-foreground">{version.submittedAt ? dateTimeLabel(version.submittedAt) : "Not recorded"}</dd>
        </div>
        <div className="rounded-lg border border-border p-2.5">
          <dt className="flex items-center justify-between gap-2 font-semibold">Review<Badge variant="outline">{version.reviewState}</Badge></dt>
          <dd className="mt-1.5 text-muted-foreground">{reviewReason(version.reviewState)}</dd>
          <dd className="mt-1 text-muted-foreground">{version.reviewedAt ? dateTimeLabel(version.reviewedAt) : "Not recorded"}</dd>
        </div>
        <div className="rounded-lg border border-border p-2.5">
          <dt className="flex items-center justify-between gap-2 font-semibold">Availability<Badge variant="outline">{version.availabilityState}</Badge></dt>
          <dd className="mt-1.5 text-muted-foreground">{availabilityReason(version.availabilityState)}</dd>
          <dd className="mt-1 text-muted-foreground">{version.frozenAt ? dateTimeLabel(version.frozenAt) : "Not recorded"}</dd>
        </div>
      </dl>
    </div>
  );
}
