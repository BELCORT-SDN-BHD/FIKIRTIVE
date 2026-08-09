"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clock3,
  History,
  IdCard,
  LoaderCircle,
  Save,
  ShieldAlert,
} from "lucide-react";
import { setContactConsent, setContactDnd, updateContact } from "@/lib/crm-actions";
import { crmConsentBadge, CRM_PRE_LEDGER_OPT_OUT_NOTE } from "@/lib/crm-consent-labels";
import { channelLabel, purposeLabel } from "@/lib/crm-labels";
import { getContact, type CrmContactDetailRow } from "@/lib/crm-view-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type DetailResult = Awaited<ReturnType<typeof getContact>>;

function dateTimeLabel(value: Date | string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

const SOURCE_LABELS: Record<string, string> = {
  explicit_inbox_optin: "Verified inbox opt-in",
  unsubscribe_link: "Unsubscribe link",
  resubscribe_link: "Re-subscribe link",
  stop_keyword: "STOP keyword",
  start_keyword: "START keyword",
  double_optin: "Double opt-in",
  crm_manual: "CRM manual assertion",
  import: "CSV import assertion",
  legacy_contact_snapshot: "Legacy snapshot",
  historical_verified_revoke: "Verified historical revoke",
  historical_verified_stop: "Verified historical STOP",
  stop_purpose_expansion: "STOP purpose expansion",
};

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function ErrorProfile({ message }: { message: string }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-4xl">
        <Link href="/crm/contacts" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back to contacts</Link>
        <section className="mt-7 rounded-[var(--radius-card)] border border-error-soft bg-card p-6 shadow-sm">
          <AlertCircle className="size-6 text-destructive" />
          <h1 className="mt-4 text-2xl font-semibold">Contact is not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        </section>
      </div>
    </main>
  );
}

export default function ContactProfilePage({ initialState }: { initialState: DetailResult }) {
  if (!("ok" in initialState)) return <ErrorProfile message={initialState.error} />;
  return <ContactProfileWorkspace initialContact={initialState.contact} />;
}

function ContactProfileWorkspace({ initialContact }: { initialContact: CrmContactDetailRow }) {
  const [contact, setContact] = useState(initialContact);
  const [name, setName] = useState(initialContact.name);
  const [stage, setStage] = useState<"New" | "Active" | "Dormant">(
    initialContact.lifecycleStage === "Active" || initialContact.lifecycleStage === "Dormant"
      ? initialContact.lifecycleStage
      : "New",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // #752 — one badge, shared with the contacts list, fed by the one consent predicate.
  const consent = crmConsentBadge(contact.consentState);

  async function refreshProfile() {
    const result = await getContact(contact.id);
    if (!("ok" in result)) return setError(result.error);
    setContact(result.contact);
    setName(result.contact.name);
    if (result.contact.lifecycleStage === "New" || result.contact.lifecycleStage === "Active" || result.contact.lifecycleStage === "Dormant") {
      setStage(result.contact.lifecycleStage);
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy("profile");
    setError(null);
    setNotice(null);
    try {
      const result = await updateContact({ contactId: contact.id, patch: { name, lifecycleStage: stage } });
      if (!("ok" in result)) return setError(result.error);
      await refreshProfile();
      setNotice("Contact profile updated. Receipt totals, identities, consent, and DND were not overwritten.");
    } catch {
      setError("The profile request could not finish. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  async function recordConsent(action: "grant" | "revoke") {
    setBusy(`consent:${action}`);
    setError(null);
    setNotice(null);
    try {
      const result = await setContactConsent({
        contactId: contact.id,
        action,
        requestId: crypto.randomUUID(),
      });
      if (!("ok" in result)) return setError(result.error);
      await refreshProfile();
      setNotice("Merchant assertion recorded in consent history. Verified customer consent did not change.");
    } catch {
      setError("The consent request could not finish. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  async function changeDnd(enabled: boolean) {
    setBusy("dnd");
    setError(null);
    setNotice(null);
    try {
      const result = await setContactDnd({
        contactId: contact.id,
        enabled,
        requestId: crypto.randomUUID(),
      });
      if (!("ok" in result)) return setError(result.error);
      await refreshProfile();
      setNotice(enabled ? "Do not disturb recorded." : "Do not disturb cleared.");
    } catch {
      setError("The do-not-disturb request could not finish. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-7xl">
        <header className="border-b border-border pb-7">
          <Link href="/crm/contacts" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-4" />Back to contacts</Link>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">CRM · Contact profile</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{contact.name}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                Records are the merchant&apos;s asset. Fikirtive records facts and reminds; it does not delete the record, decide consent, or merge identities.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{contact.lifecycleStage}</Badge>
              <Badge variant={consent.variant}>{consent.label}</Badge>
              {contact.doNotDisturb ? <Badge variant="destructive">Do not disturb</Badge> : null}
            </div>
          </div>
        </header>

        {error ? <div className="mt-5 rounded-xl border border-error-soft bg-error-soft p-4 text-sm text-destructive">{error}</div> : null}
        {notice ? <div className="mt-5 rounded-xl border border-success/25 bg-success-soft p-4 text-sm text-success-soft-foreground">{notice}</div> : null}

        <div className="mt-6 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="grid content-start gap-5">
            <Card>
              <CardHeader><CardTitle>Standard fields</CardTitle><CardDescription>Edit only profile fields. Order totals remain read-only facts.</CardDescription></CardHeader>
              <CardContent>
                <form className="grid gap-4" onSubmit={saveProfile}>
                  <label className="grid gap-2 text-sm font-semibold">Name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} /></label>
                  <label className="grid gap-2 text-sm font-semibold">Lifecycle stage<Select value={stage} onValueChange={(value) => setStage(value as typeof stage)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="New">New</SelectItem><SelectItem value="Active">Active</SelectItem><SelectItem value="Dormant">Dormant</SelectItem></SelectContent></Select></label>
                  <div className="rounded-xl bg-muted/45 p-4 text-sm"><p className="text-xs text-muted-foreground">Lifetime order receipts</p><p className="mt-1 font-semibold">{contact.totalOrdersMyr === null ? "No receipt total connected" : `RM${contact.totalOrdersMyr}`}</p></div>
                  <Button type="submit" disabled={!name.trim() || busy !== null}>{busy === "profile" ? <LoaderCircle className="animate-spin" /> : <Save />}Save fields</Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Do not disturb</CardTitle><CardDescription>A separate merchant control. Clearing it never creates consent.</CardDescription></CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
                  <div><p className="text-sm font-semibold">Block proactive contact</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Recorded as an append-only DND fact.</p></div>
                  <Switch checked={contact.doNotDisturb} disabled={busy !== null} onCheckedChange={(checked) => void changeDnd(checked)} aria-label="Do not disturb" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Identity records</CardTitle><CardDescription>Read-only in this slice. No attach, merge, or unmerge action is available.</CardDescription></CardHeader>
              <CardContent className="grid gap-3">
                {contact.identities.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center"><IdCard className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 text-sm font-semibold">No stored identities</p></div>
                ) : contact.identities.map((identity) => (
                  <div key={identity.id} className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">{channelLabel(identity.channel)}</p><Badge variant="outline">Read-only</Badge></div>
                    <p className="mt-2 break-all text-sm">{identity.externalId}</p>
                    {identity.handle || identity.label ? <p className="mt-1 text-xs text-muted-foreground">{identity.label ?? identity.handle}</p> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid content-start gap-5">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Consent history</CardTitle><CardDescription className="mt-1">WhatsApp × marketing projection plus append-only facts, newest first.</CardDescription></div><Badge variant={consent.variant}>{consent.label}</Badge></div>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl border border-warning/25 bg-warning-soft p-4 text-sm leading-6 text-warning-soft-foreground">
                  Unknown is not opt-out and not verified opt-in. A manual entry records what the merchant reports; the platform does not decide the customer&apos;s stance.
                </div>
                {/*
                  #752 — the whole fact, on the page a merchant opens to find out why the segments
                  page excluded this customer. It is shown whenever the fence applies, not only on
                  an empty history: re-recording an opt-out adds events without lifting the fence.
                */}
                {contact.consentState.unresolvedLegacyOptOut ? (
                  <div className="mt-3 rounded-xl border border-destructive/25 bg-error-soft p-4 text-sm leading-6 text-error-soft-foreground">
                    {CRM_PRE_LEDGER_OPT_OUT_NOTE}
                  </div>
                ) : null}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void recordConsent("grant")}>{busy === "consent:grant" ? <LoaderCircle className="animate-spin" /> : <Check />}Record reported opt-in</Button>
                  <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void recordConsent("revoke")}>{busy === "consent:revoke" ? <LoaderCircle className="animate-spin" /> : <ShieldAlert />}Record reported opt-out</Button>
                </div>

                <div className="mt-5 grid gap-3">
                  {contact.consentEvents.length === 0 ? (
                    /*
                      #752 — "The current state remains unknown" is true of the ledger but says
                      nothing about why a fenced contact is treated the way she is, so the fenced
                      branch points at the note above instead of restating it.

                      It may not restate it as a PROMISE either. This line used to say the opt-out
                      "keeps this contact out of audiences". When #752 removed that, the reason was
                      that the product did not enforce it at all — the fence reached the matcher
                      only as the `marketingConsent` fact, so a segment whose rules never mentioned
                      contactability selected her anyway. #806/#807 closed that: selection now goes
                      through one gate and the send gate answers `block` on the fence. The promise
                      still may not come back, for a narrower reason — a merchant who deliberately
                      segments on "known opt-out" does get her, so "out of audiences" would still
                      overclaim. Both halves of what is left are checkable — the list really is
                      empty, and the legacy opt-out really does predate this history. The note above
                      renders under exactly this same `unresolvedLegacyOptOut` condition, so "above"
                      is guaranteed by construction, not by hope.
                    */
                    <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center"><History className="mx-auto size-6 text-muted-foreground" /><h2 className="mt-3 text-sm font-semibold">No consent facts recorded</h2><p className="mt-2 text-sm text-muted-foreground">{contact.consentState.unresolvedLegacyOptOut ? "There is nothing to show here: the opt-out described above predates this history." : "The current state remains unknown."}</p></div>
                  ) : contact.consentEvents.map((event) => (
                    <div key={event.id} className="rounded-xl border border-border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">{event.action === "grant" ? "Grant recorded" : "Revoke recorded"}</p><p className="mt-1 text-xs text-muted-foreground">{channelLabel(event.channel)} · {purposeLabel(event.purpose)}</p></div><Badge variant={event.evidenceStatus === "verified" ? "success" : event.evidenceStatus === "asserted" ? "warning" : "outline"}>{titleCase(event.evidenceStatus)}</Badge></div>
                      <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2"><div><dt>Source</dt><dd className="mt-0.5 font-medium text-foreground">{SOURCE_LABELS[event.sourceKind] ?? titleCase(event.sourceKind)}</dd></div><div><dt>Recorded</dt><dd className="mt-0.5 font-medium text-foreground">{dateTimeLabel(event.receivedAt)}</dd></div><div><dt>Actor</dt><dd className="mt-0.5 font-medium text-foreground">{titleCase(event.actorKind)}</dd></div><div><dt>Entry mode</dt><dd className="mt-0.5 font-medium text-foreground">{titleCase(event.entryMode)}</dd></div></dl>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Record timeline</CardTitle><CardDescription>Basic dates only. Last seen is not treated as an order or consent fact.</CardDescription></CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <TimelineFact label="Created" value={dateTimeLabel(contact.createdAt)} />
                <TimelineFact label="First touch" value={dateTimeLabel(contact.firstTouchAt)} />
                <TimelineFact label="Last seen" value={dateTimeLabel(contact.lastSeenAt)} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}

function TimelineFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-muted/45 p-4"><Clock3 className="size-4 text-muted-foreground" /><p className="mt-3 text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>;
}
