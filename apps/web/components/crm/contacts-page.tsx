"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  FileUp,
  LoaderCircle,
  Plus,
  Search,
  ShieldAlert,
  Users,
} from "lucide-react";
import { createContact, importContacts, type ImportContactsResult } from "@/lib/crm-actions";
import { crmConsentBadge } from "@/lib/crm-consent-labels";
import { contactSourceLabel, identityGradePresentation } from "@/lib/crm-labels";
import { listContacts } from "@/lib/crm-view-data";
import { MY_DATE_FORMAT } from "@/lib/my-date-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ListResult = Awaited<ReturnType<typeof listContacts>>;
type ListSuccess = Extract<ListResult, { ok: true }>;
type ImportSuccess = Extract<ImportContactsResult, { ok: true }>;

/**
 * r2 (判词 5232132441 P2②) — what the import actually did with the phone columns, counted from
 * the rows it is printed above. A file with no phone column says nothing about phones, because
 * "phone numbers were saved" would then be a sentence about something that never happened.
 *
 * r3 (r2 判词追加 P2) — the broadcast caveat is tied to `stored`, not to the sentence as a whole.
 * In the all-conflict shape (nothing stored, everything skipped) this file created no unverified
 * number at all, and the numbers it skipped live on other contacts where they may already be
 * channel-verified and perfectly usable. "Saved numbers are not used for broadcasts" there is a
 * claim about rows this import did not write, so it may only appear when something was written.
 */
export function importPhoneSummary(rows: ImportSuccess["rows"]): string {
  const stored = rows.reduce((total, row) => total + row.storedPhoneCount, 0);
  const skipped = rows.reduce((total, row) => total + row.skippedPhoneCount, 0);
  const parts: string[] = [];
  if (stored) {
    parts.push(`${stored} phone ${stored === 1 ? "number" : "numbers"} saved as not verified`);
  }
  if (skipped) {
    parts.push(`${skipped} skipped because ${skipped === 1 ? "it is" : "they are"} already saved on another contact`);
  }
  if (!parts.length) return "No phone numbers were stored from this file.";
  const caveat = stored ? " Saved numbers are not used for broadcasts." : "";
  return `${parts.join(" · ")}.${caveat}`;
}
type CreateSuccess = Extract<Awaited<ReturnType<typeof createContact>>, { ok: true }>;
type StageFilter = "all" | "New" | "Active" | "Dormant";

function dateLabel(value: Date | string): string {
  return MY_DATE_FORMAT.format(new Date(value));
}

function DeniedState({ message }: { message: string }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground">
          <AlertCircle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM contacts</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This workspace is not available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Button asChild className="mt-6" variant="secondary"><Link href="/otto"><ArrowLeft />Return to Otto</Link></Button>
      </section>
    </main>
  );
}

export default function ContactsPage({ initialState }: { initialState: ListResult }) {
  if (!("ok" in initialState)) return <DeniedState message={initialState.error} />;
  return <ContactsWorkspace initialState={initialState} />;
}

function ContactsWorkspace({ initialState }: { initialState: ListSuccess }) {
  const [contacts, setContacts] = useState(initialState.contacts);
  const [totalCount, setTotalCount] = useState(initialState.totalCount);
  const [nextCursor, setNextCursor] = useState(initialState.nextCursor);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<StageFilter>("all");
  // The filter that actually produced the rows on screen — typing in the search box does not
  // change it until the search runs, so "load more" always continues the visible list.
  const [applied, setApplied] = useState<{ query: string; stage: StageFilter }>({ query: "", stage: "all" });
  // Search and "load more" share one read lane. Only the newest request may write the list,
  // its total, or its cursor — a slow page that lands after a newer search is dropped, never
  // appended into a list it does not belong to.
  const readSequence = useRef(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [newStage, setNewStage] = useState<"New" | "Active" | "Dormant">("New");
  const [creating, setCreating] = useState(false);
  const [createNotice, setCreateNotice] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<CreateSuccess["possibleDuplicates"]>([]);

  const [csvName, setCsvName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportSuccess | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function refreshContacts(nextQuery = query, nextStage = stage) {
    const sequence = ++readSequence.current;
    setLoading(true);
    setReadError(null);
    try {
      const result = await listContacts({
        query: nextQuery,
        ...(nextStage === "all" ? {} : { lifecycleStage: nextStage }),
      });
      if (sequence !== readSequence.current) return;
      if (!("ok" in result)) return setReadError(result.error);
      setContacts(result.contacts);
      setTotalCount(result.totalCount);
      setNextCursor(result.nextCursor);
      setApplied({ query: nextQuery, stage: nextStage });
    } catch {
      if (sequence !== readSequence.current) return;
      setReadError("The contacts request could not finish. Please retry.");
    } finally {
      if (sequence === readSequence.current) setLoading(false);
    }
  }

  async function loadMoreContacts() {
    if (!nextCursor) return;
    const sequence = ++readSequence.current;
    setLoadingMore(true);
    setReadError(null);
    try {
      const result = await listContacts({
        query: applied.query,
        ...(applied.stage === "all" ? {} : { lifecycleStage: applied.stage }),
        cursor: nextCursor,
      });
      if (sequence !== readSequence.current) return;
      if (!("ok" in result)) return setReadError(result.error);
      setContacts((current) => [...current, ...result.contacts]);
      setTotalCount(result.totalCount);
      setNextCursor(result.nextCursor);
    } catch {
      if (sequence !== readSequence.current) return;
      setReadError("The contacts request could not finish. Please retry.");
    } finally {
      if (sequence === readSequence.current) setLoadingMore(false);
    }
  }

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    await refreshContacts();
  }

  async function submitContact(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    setCreateNotice(null);
    setDuplicates([]);
    try {
      const result = await createContact({ name, lifecycleStage: newStage, source: "manual" });
      if (!("ok" in result)) return setCreateError(result.error);
      setName("");
      setCreateNotice("Contact saved. No phone number or consent was inferred.");
      setDuplicates(result.possibleDuplicates);
      await refreshContacts();
    } catch {
      setCreateError("The contact request could not finish. Please retry.");
    } finally {
      setCreating(false);
    }
  }

  async function chooseCsv(file: File | undefined) {
    setImportResult(null);
    setImportError(null);
    if (!file) {
      setCsvName(null);
      setCsvText(null);
      return;
    }
    try {
      setCsvName(file.name);
      setCsvText(await file.text());
    } catch {
      setCsvName(null);
      setCsvText(null);
      setImportError("The CSV could not be read.");
    }
  }

  async function startImport() {
    if (!csvText) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await importContacts({ csv: csvText, importId: crypto.randomUUID() });
      if (!("ok" in result)) return setImportError(result.error);
      setImportResult(result);
      await refreshContacts();
    } catch {
      setImportError("The import request could not finish. Please retry.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/otto" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="size-4" />Return to Otto
            </Link>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Contacts</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Records are the merchant&apos;s asset. Fikirtive records facts and reminders; it never merges, deletes, or decides for the merchant.
            </p>
          </div>
          <Button asChild><Link href="#add-contact"><Plus />New contact</Link></Button>
        </header>

        <details className="group mt-6 rounded-xl border border-warning/25 bg-warning-soft text-sm text-warning-soft-foreground">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span>Unknown consent stays included in your records and audience selection.</span>
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="border-t border-warning/20 px-4 pb-3 pt-2 leading-6">
            It is not verified opt-in or permission to send, and it is never fabricated from an import or an existing contact.
          </p>
        </details>

        <Card className="mt-6">
          <CardHeader><CardTitle>Contact records</CardTitle><CardDescription>Search by name or a stored number, then filter by lifecycle stage.</CardDescription></CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-[1fr_180px_auto]" onSubmit={submitSearch}>
              <Input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} placeholder="Search contacts" aria-label="Search contacts" />
              <Select value={stage} onValueChange={(value) => setStage(value as StageFilter)}>
                <SelectTrigger aria-label="Filter lifecycle"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All lifecycle stages</SelectItem><SelectItem value="New">New</SelectItem><SelectItem value="Active">Active</SelectItem><SelectItem value="Dormant">Dormant</SelectItem></SelectContent>
              </Select>
              <Button type="submit" variant="secondary" disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <Search />}Search</Button>
            </form>
            {readError ? <p className="mt-3 text-sm text-destructive">{readError}</p> : null}
          </CardContent>
        </Card>

        {contacts.length === 0 ? (
          <section className="mt-5 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
            <Users className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No contacts found</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Add a contact, import a CSV, or change the current search and lifecycle filter.</p>
          </section>
        ) : (
          <>
            <p className="mt-5 text-sm text-muted-foreground" aria-live="polite">
              {nextCursor
                ? `Showing ${contacts.length} of ${totalCount} contacts`
                : `Showing all ${totalCount} ${totalCount === 1 ? "contact" : "contacts"}`}
            </p>
            <section className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {contacts.map((contact) => {
              const consent = crmConsentBadge(contact.consentState);
              return (
                <Card key={contact.id} className="min-w-0">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate">{contact.name}</CardTitle><CardDescription className="mt-1">{contact.lifecycleStage} · {contactSourceLabel(contact.source)}</CardDescription></div><Badge variant={consent.variant}>{consent.label}</Badge></div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2 rounded-xl bg-muted/45 p-3 text-sm">
                      <p className="truncate">{contact.identities[0] ? `${contact.identities[0].externalId} · ${identityGradePresentation(contact.identities[0].verificationStatus).label}` : "No stored number"}</p>
                      <p className="text-xs text-muted-foreground">Last seen {dateLabel(contact.lastSeenAt)}</p>
                      {contact.doNotDisturb ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive"><ShieldAlert className="size-3.5" />Do not disturb</span> : null}
                    </div>
                    <Button asChild className="mt-4 w-full" variant="secondary"><Link href={`/crm/contacts/${contact.id}`}>Open profile<ArrowRight /></Link></Button>
                  </CardContent>
                </Card>
              );
            })}
            </section>
            {nextCursor ? (
              <Button type="button" className="mt-4" variant="secondary" disabled={loading || loadingMore} onClick={loadMoreContacts}>
                {loadingMore ? <LoaderCircle className="animate-spin" /> : <ArrowDown />}
                Load more contacts
              </Button>
            ) : null}
          </>
        )}

        <div id="add-contact" className="mt-10 grid scroll-mt-8 gap-5 border-t border-border pt-8 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Add contact</CardTitle><CardDescription>Create a standard profile, then add a phone number on the contact page.</CardDescription></CardHeader>
            <CardContent>
              <form className="grid gap-3 sm:grid-cols-[1fr_170px_auto]" onSubmit={submitContact}>
                <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} placeholder="Contact name" aria-label="Contact name" />
                <Select value={newStage} onValueChange={(value) => setNewStage(value as typeof newStage)}>
                  <SelectTrigger aria-label="Lifecycle stage"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="New">New</SelectItem><SelectItem value="Active">Active</SelectItem><SelectItem value="Dormant">Dormant</SelectItem></SelectContent>
                </Select>
                <Button type="submit" disabled={!name.trim() || creating}>{creating ? <LoaderCircle className="animate-spin" /> : <Plus />}Save</Button>
              </form>
              {createError ? <p className="mt-3 text-sm text-destructive">{createError}</p> : null}
              {createNotice ? <p className="mt-3 text-sm text-success">{createNotice}</p> : null}
              {duplicates.length ? (
                <p className="mt-3 text-sm text-warning-soft-foreground">
                  Possible duplicates: {duplicates.map((suggestion, index) => <span key={suggestion.contactId}>{index ? ", " : ""}<Link className="font-semibold underline" href={`/crm/contacts/${suggestion.contactId}`}>{suggestion.name}</Link> ({suggestion.reasons.join(", ")})</span>)}. Review only; nothing was merged.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Import CSV</CardTitle><CardDescription>Columns: name, lifecycle_stage, consent, phone or whatsapp, email. Consent accepts opt_in, opt_out, unknown, or blank. Imported phone numbers are saved as not verified and are not used for broadcasts; a number without a country code is read as Malaysia (+60). Email is checked for duplicates but is not stored yet.</CardDescription></CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input type="file" accept=".csv,text/csv" onChange={(event) => void chooseCsv(event.currentTarget.files?.[0])} aria-label="Choose contacts CSV" />
                <Button type="button" variant="secondary" disabled={!csvText || importing} onClick={startImport}>{importing ? <LoaderCircle className="animate-spin" /> : <FileUp />}Import</Button>
              </div>
              {csvName ? <p className="mt-2 text-xs text-muted-foreground">Ready: {csvName}</p> : null}
              {importError ? <p className="mt-3 text-sm text-destructive">{importError}</p> : null}
              {importResult ? (
                <div className="mt-3 rounded-xl border border-border bg-muted/45 p-3 text-sm">
                  <p className="font-semibold">{importResult.importedCount} imported · {importResult.failedCount} failed</p>
                  {/*
                    r2 (判词 5232132441 P2②) — this line used to announce that phone numbers were
                    saved no matter what the file contained: no phone column, every number already
                    on someone else, or every row failed all read the same. It is now counted from
                    the rows themselves, so it can only say what actually happened.
                  */}
                  <p className="mt-1 text-muted-foreground">{importPhoneSummary(importResult.rows)}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {importResult ? (
          <Card className="mt-5">
            <CardHeader><CardTitle>Import results</CardTitle><CardDescription>Duplicate matches are suggestions only. Consent entries are merchant assertions, not verified customer actions.</CardDescription></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {importResult.rows.map((row) => (
                <div key={row.rowNumber} className="rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3"><p className="font-semibold">Row {row.rowNumber}: {row.name}</p><Badge variant={row.status === "failed" ? "destructive" : row.status === "imported" ? "success" : "warning"}>{row.status.replaceAll("_", " ")}</Badge></div>
                  {row.contactId ? <Link className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-foreground underline-offset-4 hover:underline" href={`/crm/contacts/${row.contactId}`}>Open profile<ArrowRight className="size-4" /></Link> : null}
                  {row.possibleDuplicates.length ? <p className="mt-2 text-xs text-muted-foreground">Suggestions: {row.possibleDuplicates.map((item) => item.name).join(", ")}. Nothing was merged.</p> : null}
                  {row.warnings.map((warning) => <p key={warning} className="mt-2 text-xs leading-5 text-warning-soft-foreground">{warning}</p>)}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
