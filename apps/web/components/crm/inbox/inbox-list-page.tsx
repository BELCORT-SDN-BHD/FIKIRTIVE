"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Inbox as InboxIcon,
  LoaderCircle,
  Search,
  Unplug,
  X,
} from "lucide-react";
import { listConversations, searchConversations } from "@/lib/customer-inbox-ui-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  attentionPresentation,
  errorMessage,
  messageText,
  relativeTimeLabel,
  statusPresentation,
} from "./inbox-format";

type ListResult = Awaited<ReturnType<typeof listConversations>>;
type ListSuccess = Extract<ListResult, { ok: true }>;
type ListRow = ListSuccess["resource"][number];
type SearchResult = Awaited<ReturnType<typeof searchConversations>>;
type SearchSuccess = Extract<SearchResult, { ok: true }>;
type SearchRow = SearchSuccess["resource"][number];
type Row = ListRow | SearchRow;

type ViewFilter = "all" | "mine" | "unassigned" | "needs_reply";
type Mode = { kind: "view"; view: ViewFilter } | { kind: "search"; query: string };

const VIEW_TABS: { key: ViewFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "mine", label: "Mine" },
  { key: "unassigned", label: "Unassigned" },
  { key: "needs_reply", label: "Needs reply" },
];

function hasAttention(row: Row): row is ListRow {
  return "attention" in row;
}

function hasIdentityDetail(
  identity: Row["contactIdentity"],
): identity is ListRow["contactIdentity"] {
  return "externalId" in identity;
}

function DeniedState({ message }: { message: string }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground">
          <AlertCircle className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM Inbox</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This workspace is not available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Button asChild className="mt-6" variant="secondary"><Link href="/otto"><ArrowLeft />Return to Otto</Link></Button>
      </section>
    </main>
  );
}

export default function InboxListPage({ initialState }: { initialState: ListResult }) {
  if (!initialState.ok) return <DeniedState message={errorMessage(initialState.error)} />;
  return <InboxWorkspace initialState={initialState} />;
}

function InboxWorkspace({ initialState }: { initialState: ListSuccess }) {
  const [rows, setRows] = useState<Row[]>(initialState.resource);
  const [mode, setMode] = useState<Mode>({ kind: "view", view: "all" });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  async function loadView(view: ViewFilter) {
    setLoading(true);
    setReadError(null);
    try {
      const result = await listConversations({ view });
      if (!result.ok) return setReadError(errorMessage(result.error));
      setRows(result.resource);
      setMode({ kind: "view", view });
    } catch {
      setReadError("The Inbox request could not finish. Please retry.");
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setReadError(null);
    try {
      const result = await searchConversations({ query: trimmed });
      if (!result.ok) return setReadError(errorMessage(result.error));
      setRows(result.resource);
      setMode({ kind: "search", query: trimmed });
    } catch {
      setReadError("The search request could not finish. Please retry.");
    } finally {
      setLoading(false);
    }
  }

  function clearSearch() {
    setQuery("");
    void loadView(mode.kind === "view" ? mode.view : "all");
  }

  const activeView = mode.kind === "view" ? mode.view : null;

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/otto" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="size-4" />Return to Otto
            </Link>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-brand">CRM</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Inbox</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Every conversation your team and Otto have with a customer, in one place. Fikirtive shows what is stored; it never sends on your behalf.
            </p>
          </div>
          <Button asChild variant="secondary"><Link href="/crm/inbox/templates">Message templates</Link></Button>
        </header>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-soft-foreground">
          <Unplug className="mt-0.5 size-4 shrink-0" />
          <span>No messaging channel is connected in this workspace yet. Conversations shown here are internal records — none reflect live customer traffic until a channel is connected.</span>
        </div>

        <Card className="mt-6">
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Inbox filters">
              {VIEW_TABS.map((tab) => (
                <Button
                  key={tab.key}
                  type="button"
                  variant={activeView === tab.key ? "default" : "secondary"}
                  size="sm"
                  aria-pressed={activeView === tab.key}
                  disabled={loading}
                  onClick={() => { setQuery(""); void loadView(tab.key); }}
                >
                  {tab.label}
                </Button>
              ))}
            </div>
            <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto]" onSubmit={runSearch}>
              <Input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} placeholder="Search by contact name or message text" aria-label="Search conversations" />
              <Button type="submit" variant="secondary" disabled={loading || !query.trim()}>{loading ? <LoaderCircle className="animate-spin" /> : <Search />}Search</Button>
              {mode.kind === "search" ? (
                <Button type="button" variant="ghost" onClick={clearSearch} disabled={loading}><X />Clear search</Button>
              ) : null}
            </form>
            {readError ? <p className="text-sm text-destructive">{readError}</p> : null}
          </CardContent>
        </Card>

        {mode.kind === "search" ? (
          <p className="mt-5 text-sm text-muted-foreground">Search results for &ldquo;{mode.query}&rdquo;</p>
        ) : null}

        {rows.length === 0 ? (
          mode.kind === "search" ? (
            <section className="mt-4 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
              <Search className="mx-auto size-8 text-muted-foreground" />
              <h2 className="mt-4 text-lg font-semibold">No matches for &ldquo;{mode.query}&rdquo;</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Try a different name or word from the message. Nothing in this workspace was changed.</p>
              <Button className="mt-5" type="button" variant="secondary" onClick={clearSearch}><X />Clear search</Button>
            </section>
          ) : (
            <section className="mt-4 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
              <InboxIcon className="mx-auto size-8 text-muted-foreground" />
              <h2 className="mt-4 text-lg font-semibold">No conversations in this view yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                {activeView === "mine"
                  ? "Nothing is assigned to you right now."
                  : activeView === "unassigned"
                    ? "Every open conversation currently has an assignee."
                    : activeView === "needs_reply"
                      ? "No open conversation is currently waiting on a reply."
                      : "Once a conversation is recorded for this workspace, it will show up here."}
              </p>
            </section>
          )
        ) : (
          <section className="mt-4 grid gap-3">
            {rows.map((row) => <ConversationRow key={row.id} row={row} />)}
          </section>
        )}
      </div>
    </main>
  );
}

function ConversationRow({ row }: { row: Row }) {
  const status = statusPresentation(row.status);
  const last = row.messages[0];
  const lastPreview = last ? messageText(last.contentJson) : null;
  const identity = row.contactIdentity;
  const assigneeId = hasAttention(row) ? row.assigneeMembership?.id ?? null : row.assigneeMembershipId;
  const assigneeRole = hasAttention(row) ? row.assigneeMembership?.role ?? null : null;

  return (
    <Link href={`/crm/inbox/${row.id}`} className="block">
      <Card className="transition-colors hover:bg-secondary/40">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold">{identity.contact.name}</p>
              <Badge variant="outline">{identity.channel}</Badge>
              <Badge variant={status.variant}>{status.label}</Badge>
              {hasAttention(row) ? (
                <Badge variant={attentionPresentation(row.attention).variant}>{attentionPresentation(row.attention).label}</Badge>
              ) : null}
            </div>
            {hasIdentityDetail(identity) ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">{identity.handle ?? identity.label ?? identity.externalId}</p>
            ) : null}
            <p className="mt-2 truncate text-sm text-muted-foreground">
              {last
                ? `${last.direction === "inbound" ? "Customer" : "Sent"}: ${lastPreview && "text" in lastPreview ? lastPreview.text : "Unsupported message type"}`
                : "No messages recorded yet"}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <p className="text-xs text-muted-foreground">{relativeTimeLabel(last?.receivedAt ?? row.lastActivityAt)}</p>
            <p className="text-xs text-muted-foreground">{assigneeId ? `Assigned${assigneeRole ? ` · ${assigneeRole}` : ""}` : "Unassigned"}</p>
            <ArrowRight className="size-4 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
