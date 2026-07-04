"use client";

import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Bot,
  Building2,
  Eye,
  FileText,
  Gauge,
  History,
  Lock,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  saveModelDirective,
  saveModelEnabled,
  saveRuntimeConfig,
  saveUserRole,
  seedResearchDirectives,
} from "@/lib/admin-actions";
import { grantCreditsAction } from "@/lib/credit-actions";
import type {
  AdminV2Data,
  AdminV2Section,
  ApprovalItem,
  AuditPreview,
  CaseRow,
  MoneyLedgerRow,
  StaffRowV2,
  SystemIncident,
  TenantHealthRow,
} from "@/lib/admin-v2";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  section: AdminV2Section;
  data: AdminV2Data;
  selfEmail: string;
  currentRole: string;
};

const FOUNDER_OWNER_ID = "founder";
const displayCredits = (internal: number) => internal / 10;
const CONFIDENCE_LEVELS = ["high", "medium", "low", "untested"] as const;

const SECTION_META: Record<AdminV2Section, { title: string; eyebrow: string; description: string }> = {
  overview: {
    title: "Overview",
    eyebrow: "City Hall v2",
    description: "Risk, money, tenant, case, and queue signals from live admin data.",
  },
  money: {
    title: "Money",
    eyebrow: "Ledger and approval control",
    description: "Read-only spend records, founder credit balance, and grant-limit review candidates.",
  },
  tenants: {
    title: "Tenants",
    eyebrow: "Merchant operations",
    description: "Tenant balance, activity, invite, and lifecycle signals.",
  },
  staff: {
    title: "Staff & permissions",
    eyebrow: "Operator RBAC",
    description: "Role assignments and the section matrix that gates admin capabilities.",
  },
  cases: {
    title: "Cases",
    eyebrow: "Metadata-first review",
    description: "Guardian, Otto, queue, and media review rows without prompt, transcript, media, or raw payloads by default.",
  },
  otto: {
    title: "Otto Ops",
    eyebrow: "Agent operations",
    description: "Model availability, directive coverage, provider mode, and knowledge readiness.",
  },
  audit: {
    title: "Audit",
    eyebrow: "Action trace",
    description: "Recent admin and system actions without expanding raw payloads.",
  },
  system: {
    title: "System Health",
    eyebrow: "Queue and spend health",
    description: "Generation, reference, render, and spend signals from live job tables.",
  },
};

function fmtDate(iso: string | null) {
  if (!iso) return "No activity";
  return iso.slice(0, 16).replace("T", " ");
}

function usd(value: number) {
  return `$${value.toFixed(2)}`;
}

function toneBadge(tone: "neutral" | "info" | "success" | "warning" | "danger") {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "destructive";
  if (tone === "info") return "info";
  return "outline";
}

function severityBadge(severity: CaseRow["severity"]) {
  if (severity === "high") return "destructive";
  if (severity === "medium") return "warning";
  return "outline";
}

function riskBadge(risk: TenantHealthRow["risk"]) {
  if (risk === "blocked") return "destructive";
  if (risk === "watch") return "warning";
  return "success";
}

function sourceIcon(source: CaseRow["source"]) {
  if (source === "otto") return <Bot className="size-4 text-brand" />;
  if (source === "queue") return <Gauge className="size-4" />;
  if (source === "guardian") return <ShieldCheck className="size-4" />;
  return <FileText className="size-4" />;
}

function PageChrome({ section, data, children }: { section: AdminV2Section; data: AdminV2Data; children: React.ReactNode }) {
  const router = useRouter();
  const meta = SECTION_META[section];

  return (
    <TooltipProvider>
      <div className="mx-auto grid w-full max-w-[1280px] gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-muted-foreground">{meta.eyebrow}</p>
            <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-normal text-foreground md:text-[32px]">{meta.title}</h1>
            <p className="mt-1 max-w-[760px] text-sm leading-6 text-muted-foreground">{meta.description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden text-right text-xs text-muted-foreground sm:block">
              <span className="block">Last refreshed</span>
              <span className="font-mono">{fmtDate(data.generatedAt)}</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="secondary" size="icon" onClick={() => router.refresh()} aria-label="Refresh admin data">
                  <RefreshCw className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh admin data</TooltipContent>
            </Tooltip>
          </div>
        </header>
        {children}
      </div>
    </TooltipProvider>
  );
}

function Panel({ title, subtitle, action, children, className }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-2xl border border-border bg-card shadow-xs", className)}>
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="min-w-0 p-4">{children}</div>
    </section>
  );
}

function MetricCard({ label, value, detail, tone, href }: {
  label: string;
  value: string;
  detail: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  href?: string;
}) {
  const body = (
    <div className="grid h-full gap-2 rounded-[14px] border border-border bg-card p-4 shadow-xs transition-colors hover:bg-secondary/50">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Badge variant={toneBadge(tone)}>{tone === "danger" ? "Needs review" : tone}</Badge>
      </div>
      <span className="text-3xl font-semibold leading-none text-foreground">{value}</span>
      <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
  if (!href) return body;
  return (
    <Link href={href} className="block h-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
      {body}
    </Link>
  );
}

function Overview({ data, setCase }: { data: AdminV2Data; setCase: (row: CaseRow) => void }) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.riskSignals.map((signal) => (
          <MetricCard key={signal.id} label={signal.label} value={signal.value} detail={signal.detail} tone={signal.tone} href={signal.href} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <MoneyQueue rows={data.approvalQueue.slice(0, 6)} />
        <TenantWatchlist rows={data.tenants.slice(0, 6)} invitedCount={data.invitedCount} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <CasesPanel rows={data.cases.slice(0, 8)} onOpen={setCase} />
        <div className="grid gap-5">
          <SystemPanel rows={data.systemIncidents} />
          <AuditPanel rows={data.audit.slice(0, 6)} />
        </div>
      </div>
    </div>
  );
}

function MoneyQueue({ rows }: { rows: ApprovalItem[] }) {
  return (
    <Panel title="Money risk queue" subtitle="Grant-limit review candidates from the existing append-only ledger.">
      <div className="grid gap-2">
        {rows.length === 0 ? <EmptyState label="No recent grant or adjustment rows." /> : null}
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            className="grid w-full gap-2 rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-secondary md:grid-cols-[1fr_120px_132px] md:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{row.tenant}</span>
                <Badge variant={row.state === "over limit" ? "warning" : row.state === "adjustment" ? "destructive" : "outline"}>{row.state}</Badge>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{row.reason || row.createdBy || "No reason captured"}</p>
            </div>
            <div className="text-sm font-semibold text-foreground">{row.amount > 0 ? "+" : ""}{row.amount.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground md:text-right">{fmtDate(row.createdAt)}</div>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function TenantWatchlist({ rows, invitedCount }: { rows: TenantHealthRow[]; invitedCount: number }) {
  return (
    <Panel
      title="Tenant watchlist"
      subtitle={`${invitedCount} pending invites. Rows prioritize blocked, low-balance, and inactive tenants.`}
      action={<Button asChild variant="secondary" size="sm"><Link href="/admin/tenants">Open</Link></Button>}
    >
      <div className="grid gap-2">
        {rows.length === 0 ? <EmptyState label="No tenants yet." /> : null}
        {rows.map((row) => (
          <Link
            key={row.orgId}
            href={`/admin/tenants/${row.orgId}`}
            className="grid gap-2 rounded-xl border border-border bg-background p-3 hover:bg-secondary md:grid-cols-[1fr_92px_112px] md:items-center"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{row.ownerEmail || row.orgId}</span>
                <Badge variant={riskBadge(row.risk)}>{row.risk}</Badge>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{row.name}</p>
            </div>
            <span className="text-sm font-semibold text-foreground">{row.balance.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground md:text-right">{fmtDate(row.lastActiveAt)}</span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function CasesPanel({ rows, onOpen }: { rows: CaseRow[]; onOpen: (row: CaseRow) => void }) {
  return (
    <Panel
      title="Cases"
      subtitle="Metadata only by default. Opening a case asks for a reason before any sensitive-access step."
      action={<Button asChild variant="secondary" size="sm"><Link href="/admin/cases">All cases</Link></Button>}
    >
      <div className="grid gap-2">
        {rows.length === 0 ? <EmptyState label="No case metadata in the sampled window." /> : null}
        {rows.map((row) => (
          <CaseRowView key={`${row.source}:${row.id}`} row={row} onOpen={onOpen} />
        ))}
      </div>
    </Panel>
  );
}

function CaseRowView({ row, onOpen }: { row: CaseRow; onOpen: (row: CaseRow) => void }) {
  return (
    <div className="grid gap-2 rounded-xl border border-border bg-background p-3 md:grid-cols-[1fr_120px_112px_40px] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {sourceIcon(row.source)}
          <span className="truncate text-sm font-medium text-foreground">{row.type}</span>
          <Badge variant={severityBadge(row.severity)}>{row.severity}</Badge>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{row.tenant} · {row.projectName}</p>
      </div>
      <span className="text-xs text-muted-foreground">{row.status}</span>
      <span className="text-xs text-muted-foreground md:text-right">{fmtDate(row.createdAt)}</span>
      <Button type="button" variant="ghost" size="icon" className="size-9 justify-self-start md:justify-self-end" onClick={() => onOpen(row)} aria-label={`Open ${row.type}`}>
        <Eye className="size-4" />
      </Button>
    </div>
  );
}

function SystemPanel({ rows }: { rows: SystemIncident[] }) {
  return (
    <Panel title="System health" subtitle="Queue and spend indicators.">
      <div className="grid gap-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">{row.area}</span>
              <Badge variant={toneBadge(row.tone)}>{row.status}</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{row.detail}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AuditPanel({ rows }: { rows: AuditPreview[] }) {
  return (
    <Panel title="Recent admin activity" subtitle="Payloads remain collapsed in v2.">
      <div className="grid gap-2">
        {rows.length === 0 ? <EmptyState label="No recent audit events." /> : null}
        {rows.map((row) => (
          <div key={row.id} className="grid gap-1 rounded-xl border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium text-foreground">{row.type}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{fmtDate(row.createdAt)}</span>
            </div>
            <p className="truncate text-xs text-muted-foreground">{row.ownerId}{row.projectId ? ` · ${row.projectId}` : ""}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CreditActionPanel() {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const parsedAmount = Number(amount);
  const overLimit = Number.isFinite(parsedAmount) && Math.abs(parsedAmount) > 1000;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayedAmount = Number(amount);
    if (!Number.isInteger(displayedAmount) || displayedAmount === 0) {
      setMessage({ ok: false, text: "Enter a non-zero whole number of displayed credits." });
      return;
    }
    if (Math.abs(displayedAmount) > 1000) {
      setMessage({ ok: false, text: "Credit actions over 1,000 displayed credits require founder approval." });
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await grantCreditsAction({
      orgId: FOUNDER_OWNER_ID,
      displayedAmount,
      reason,
      idempotencyKey: `admin-v2-grant:${crypto.randomUUID()}`,
    }).catch(() => null);
    setSaving(false);
    if (!result) {
      setMessage({ ok: false, text: "Credit action failed." });
      return;
    }
    if ("error" in result) {
      setMessage({ ok: false, text: result.error });
      return;
    }
    setMessage({ ok: true, text: result.duplicate ? "Duplicate submit ignored." : "Credit ledger updated." });
    setAmount("");
    setReason("");
    router.refresh();
  }

  return (
    <Panel title="Credit action" subtitle="Founder workspace grant/adjustment. Existing ledger action is reused; server money logic is unchanged.">
      <form onSubmit={submit} className="grid gap-3 lg:grid-cols-[160px_1fr_auto] lg:items-end">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Displayed credits</span>
          <Input type="number" step="1" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="1000" required className="h-10 text-sm" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Reason</span>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="beta top-up or correction" maxLength={500} className="h-10 text-sm" />
        </label>
        <Button type="submit" disabled={saving || overLimit}>{saving ? "Applying" : "Apply"}</Button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={overLimit ? "warning" : "outline"}>{overLimit ? "Over finance limit" : "Within finance limit"}</Badge>
        <span>Finance direct actions cap at 1,000 displayed credits; founder approval is required over that.</span>
        {message ? <span className={message.ok ? "text-success" : "text-destructive"}>{message.text}</span> : null}
      </div>
    </Panel>
  );
}

function MoneySection({ data }: { data: AdminV2Data }) {
  const [ledgerFilter, setLedgerFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(data.money.ledger[0]?.id ?? "");
  const ledger = data.money.ledger.filter((row) => ledgerFilter === "all" || row.kind === ledgerFilter);
  const selected = data.money.ledger.find((row) => row.id === selectedId) ?? data.money.ledger[0];

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Founder balance" value={displayCredits(data.money.balance).toLocaleString()} detail="Displayed credits available to the founder workspace." tone="info" />
        <MetricCard label="Held credits" value={displayCredits(data.money.reserved).toLocaleString()} detail="Reserved by in-flight jobs." tone={data.money.reserved > 0 ? "warning" : "success"} />
        <MetricCard label="30-day spend" value={usd(data.money.totalUsd)} detail={`${data.money.jobCount} paid jobs with frozen spend snapshots.`} tone="neutral" />
        <MetricCard label="Grant reviews" value={String(data.approvalQueue.filter((row) => row.state === "over limit").length)} detail="Single-action limit: 1,000 displayed credits." tone="warning" />
      </div>

      <CreditActionPanel />

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <MoneyQueue rows={data.approvalQueue} />
        <Panel title="Spend by day" subtitle="Read-only media spend over the sampled 30-day window.">
          <div className="grid gap-2">
            {data.money.days.length === 0 ? <EmptyState label="No spend recorded in this window." /> : null}
            {data.money.days.slice(0, 12).map((row) => (
              <div key={row.day} className="grid gap-2 rounded-xl border border-border bg-background p-3 sm:grid-cols-[120px_1fr_90px] sm:items-center">
                <span className="font-mono text-xs text-muted-foreground">{row.day}</span>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.min(100, (row.usd / Math.max(1, data.money.totalUsd)) * 100)}%` }} />
                </div>
                <span className="text-sm font-semibold text-foreground sm:text-right">{usd(row.usd)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        title="Ledger"
        subtitle="Append-only credit movement. Select a row to inspect metadata."
        action={
          <Select value={ledgerFilter} onValueChange={setLedgerFilter}>
            <SelectTrigger size="sm" className="w-[132px] bg-card"><span>{ledgerFilter === "all" ? "All kinds" : ledgerFilter}</span></SelectTrigger>
            <SelectContent align="end">
              {["all", "GRANT", "RESERVE", "SETTLE", "REFUND", "ADJUST"].map((kind) => <SelectItem key={kind} value={kind}>{kind === "all" ? "All kinds" : kind}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      >
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="grid gap-2">
            {ledger.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedId(row.id)}
                className={cn(
                  "grid gap-2 rounded-xl border bg-background p-3 text-left md:grid-cols-[88px_100px_1fr_130px] md:items-center",
                  selected?.id === row.id ? "border-foreground" : "border-border hover:bg-secondary",
                )}
              >
                <Badge variant="outline">{row.kind}</Badge>
                <span className={cn("text-sm font-semibold", row.displayedDelta < 0 ? "text-destructive" : "text-foreground")}>
                  {row.displayedDelta > 0 ? "+" : ""}{row.displayedDelta.toLocaleString()}
                </span>
                <span className="truncate text-xs text-muted-foreground">{row.reason || row.createdBy || row.source}</span>
                <span className="font-mono text-xs text-muted-foreground md:text-right">{fmtDate(row.createdAt)}</span>
              </button>
            ))}
          </div>
          <LedgerInspector row={selected} />
        </div>
      </Panel>
    </div>
  );
}

function LedgerInspector({ row }: { row?: MoneyLedgerRow }) {
  if (!row) return <EmptyState label="No ledger row selected." />;
  return (
    <div className="rounded-xl border border-border bg-secondary p-4">
      <h3 className="text-sm font-semibold text-foreground">Selected ledger row</h3>
      <dl className="mt-3 grid gap-3 text-xs">
        <KeyValue label="ID" value={row.id} mono />
        <KeyValue label="Kind" value={row.kind} />
        <KeyValue label="Source" value={row.source} />
        <KeyValue label="Balance delta" value={`${row.displayedDelta > 0 ? "+" : ""}${row.displayedDelta.toLocaleString()}`} />
        <KeyValue label="Held delta" value={`${row.displayedReservedDelta > 0 ? "+" : ""}${row.displayedReservedDelta.toLocaleString()}`} />
        <KeyValue label="Created by" value={row.createdBy || "system"} />
        <KeyValue label="Reason" value={row.reason || "No reason"} />
      </dl>
    </div>
  );
}

function TenantsSection({ data }: { data: AdminV2Data }) {
  const [filter, setFilter] = useState("all");
  const rows = data.tenants.filter((row) => filter === "all" || row.risk === filter || row.status === filter);

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Tenants" value={String(data.tenants.length)} detail={`${data.invitedCount} invited and not signed in.`} tone="neutral" />
        <MetricCard label="Healthy" value={String(data.tenants.filter((row) => row.risk === "healthy").length)} detail="Active tenants with sufficient balance." tone="success" />
        <MetricCard label="Watch" value={String(data.tenants.filter((row) => row.risk === "watch").length)} detail="Low balance or inactive tenants." tone="warning" />
        <MetricCard label="Blocked" value={String(data.tenants.filter((row) => row.risk === "blocked").length)} detail="Suspended or revoked tenants." tone="danger" />
      </div>

      <Panel
        title="Tenant operations"
        subtitle="Balance, spend proxy, lifecycle status, and last activity."
        action={
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger size="sm" className="w-[138px] bg-card"><span>{filter === "all" ? "All tenants" : filter}</span></SelectTrigger>
            <SelectContent align="end">
              {["all", "healthy", "watch", "blocked", "active", "suspended", "revoked"].map((item) => <SelectItem key={item} value={item}>{item === "all" ? "All tenants" : item}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      >
        <div className="grid gap-2">
          {rows.length === 0 ? <EmptyState label="No tenants match this filter." /> : null}
          {rows.map((row) => (
            <Link
              key={row.orgId}
              href={`/admin/tenants/${row.orgId}`}
              className="grid gap-2 rounded-xl border border-border bg-background p-3 hover:bg-secondary lg:grid-cols-[1.4fr_110px_100px_100px_140px_36px] lg:items-center"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Building2 className="size-4 text-muted-foreground" />
                  <span className="truncate text-sm font-medium text-foreground">{row.ownerEmail || row.orgId}</span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{row.name}</p>
              </div>
              <Badge variant={riskBadge(row.risk)}>{row.risk}</Badge>
              <span className="text-sm font-semibold text-foreground">{row.balance.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground">{row.genCount} gens</span>
              <span className="font-mono text-xs text-muted-foreground">{fmtDate(row.lastActiveAt)}</span>
              <ArrowUpRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function StaffSection({ data, selfEmail }: { data: AdminV2Data; selfEmail: string }) {
  const [roleView, setRoleView] = useState("all");
  const rows = data.staff.rows.filter((row) => roleView === "all" || row.role === roleView);

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-5">
        {data.staff.roles.map((role) => (
          <MetricCard key={role} label={role} value={String(data.staff.rows.filter((row) => row.role === role).length)} detail="Current user rows with this operator role." tone={role === "super-admin" ? "info" : "neutral"} />
        ))}
      </div>
      <Panel
        title="Staff"
        subtitle="Existing save action is reused; self-role edits stay disabled."
        action={
          <Select value={roleView} onValueChange={setRoleView}>
            <SelectTrigger size="sm" className="w-[150px] bg-card"><span>{roleView === "all" ? "All roles" : roleView}</span></SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">All roles</SelectItem>
              {data.staff.roles.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      >
        <div className="grid gap-2">
          {rows.map((row) => <StaffRoleRow key={row.id} row={row} roles={data.staff.roles} selfEmail={selfEmail} />)}
        </div>
      </Panel>
      <Panel title="Section matrix" subtitle="Read and mutate permissions are derived from SECTION_MATRIX. super-admin supersedes every cell.">
        <div className="grid gap-2">
          {data.staff.matrix.map((row) => (
            <div key={row.section} className="grid gap-2 rounded-xl border border-border bg-background p-3 md:grid-cols-[1fr_1fr_1fr] md:items-center">
              <div>
                <span className="text-sm font-medium text-foreground">{row.label}</span>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{row.section}</p>
              </div>
              <RolePills label="Read" roles={row.read} />
              <RolePills label="Mutate" roles={row.mutate} />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function StaffRoleRow({ row, roles, selfEmail }: { row: StaffRowV2; roles: string[]; selfEmail: string }) {
  const router = useRouter();
  const isSelf = row.email.toLowerCase() === selfEmail.toLowerCase();
  const [role, setRole] = useState(row.role);
  const [base, setBase] = useState(row.role);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = role !== base;

  async function save() {
    if (!dirty || isSelf || saving) return;
    setSaving(true);
    setMessage(null);
    const result = await saveUserRole({ userId: row.id, role }).catch(() => null);
    setSaving(false);
    if (!result) {
      setMessage("Save failed.");
      return;
    }
    if ("error" in result) {
      setMessage(result.error);
      return;
    }
    setBase(role);
    setMessage("Saved.");
    router.refresh();
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-background p-3 md:grid-cols-[1fr_190px_120px_120px] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{row.email}</span>
          {isSelf ? <Badge variant="outline">You</Badge> : null}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{row.name || row.id}</p>
      </div>
      <Select value={role} onValueChange={setRole} disabled={isSelf || saving}>
        <SelectTrigger size="sm" className="w-full bg-card"><span>{role}</span></SelectTrigger>
        <SelectContent>
          {roles.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="button" variant="secondary" size="sm" disabled={!dirty || isSelf || saving} onClick={save}>
        {saving ? "Saving" : "Save"}
      </Button>
      <span className={cn("text-xs", message === "Saved." ? "text-success" : "text-muted-foreground")}>{message}</span>
    </div>
  );
}

function RolePills({ label, roles }: { label: string; roles: string[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {roles.length === 0 ? <Badge variant="outline">super-admin only</Badge> : roles.map((role) => <Badge key={role} variant="outline">{role}</Badge>)}
      </div>
    </div>
  );
}

function CasesSection({ data, setCase }: { data: AdminV2Data; setCase: (row: CaseRow) => void }) {
  const [source, setSource] = useState("all");
  const [severity, setSeverity] = useState("all");
  const rows = data.cases.filter((row) => (source === "all" || row.source === source) && (severity === "all" || row.severity === severity));

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-4">
        {(["guardian", "otto", "queue", "media"] as const).map((item) => (
          <MetricCard key={item} label={item} value={String(data.cases.filter((row) => row.source === item).length)} detail="Metadata rows in the sampled case stream." tone={item === "otto" ? "info" : "neutral"} />
        ))}
      </div>
      <Panel
        title="Case queue"
        subtitle="No prompts, transcripts, media URLs, or raw payloads are loaded into the table."
        action={
          <div className="flex items-center gap-2">
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger size="sm" className="w-[116px] bg-card"><span>{source === "all" ? "All source" : source}</span></SelectTrigger>
              <SelectContent align="end">
                {["all", "guardian", "otto", "queue", "media"].map((item) => <SelectItem key={item} value={item}>{item === "all" ? "All source" : item}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger size="sm" className="w-[112px] bg-card"><span>{severity === "all" ? "Severity" : severity}</span></SelectTrigger>
              <SelectContent align="end">
                {["all", "high", "medium", "low"].map((item) => <SelectItem key={item} value={item}>{item === "all" ? "Severity" : item}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        }
      >
        <div className="grid gap-2">
          {rows.length === 0 ? <EmptyState label="No cases match these filters." /> : null}
          {rows.map((row) => <CaseRowView key={`${row.source}:${row.id}`} row={row} onOpen={setCase} />)}
        </div>
      </Panel>
    </div>
  );
}

function OttoSection({ data, currentRole }: { data: AdminV2Data; currentRole: string }) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Provider" value={data.otto.provider} detail="Runtime provider mode from existing config." tone={data.otto.provider === "mock" ? "warning" : "info"} />
        <MetricCard label="Enabled models" value={`${data.otto.enabledModelCount}/${data.otto.modelCount}`} detail="Typed catalogs minus disabled overlay rows." tone="neutral" />
        <MetricCard label="Directive cells" value={`${data.otto.filledDirectiveCells}/${data.otto.directiveCells}`} detail="Enabled prompt directive cells with content." tone="info" />
        <MetricCard label="Family coverage" value={`${data.otto.coveredFamilies}/${data.otto.routedFamilies}`} detail="Routed video families with at least one directive." tone={data.otto.coveredFamilies === data.otto.routedFamilies ? "success" : "warning"} />
      </div>
      <RuntimeConfigPanel data={data} canModal={currentRole === "super-admin"} />
      <ModelControlsPanel data={data} />
      <DirectivesPanel data={data} />
      <KnowledgePanel data={data} />
    </div>
  );
}

function RuntimeConfigPanel({ data, canModal }: { data: AdminV2Data; canModal: boolean }) {
  const router = useRouter();
  const [provider, setProvider] = useState(data.otto.provider);
  const [providerBase, setProviderBase] = useState(data.otto.provider);
  const [enabled, setEnabled] = useState(data.otto.vision.enabled);
  const [maxImages, setMaxImages] = useState(data.otto.vision.maxImages);
  const [maxBytes, setMaxBytes] = useState(data.otto.vision.maxBytes);
  const [visionBase, setVisionBase] = useState(data.otto.vision);
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [visionMessage, setVisionMessage] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);
  const [savingVision, setSavingVision] = useState(false);
  const providerDirty = provider !== providerBase;
  const visionDirty = enabled !== visionBase.enabled || maxImages !== visionBase.maxImages || maxBytes !== visionBase.maxBytes;

  async function saveProvider() {
    if (!providerDirty || savingProvider) return;
    setSavingProvider(true);
    setProviderMessage(null);
    const result = await saveRuntimeConfig({ key: "cowork_provider", value: { provider } }).catch(() => null);
    setSavingProvider(false);
    if (!result) {
      setProviderMessage("Save failed.");
      return;
    }
    if ("error" in result) {
      setProviderMessage(result.error);
      return;
    }
    setProviderBase(provider);
    setProviderMessage("Saved.");
    router.refresh();
  }

  async function saveVision() {
    if (!visionDirty || savingVision) return;
    setSavingVision(true);
    setVisionMessage(null);
    const result = await saveRuntimeConfig({ key: "vision", value: { enabled, maxImages, maxBytes } }).catch(() => null);
    setSavingVision(false);
    if (!result) {
      setVisionMessage("Save failed.");
      return;
    }
    if ("error" in result) {
      setVisionMessage(result.error);
      return;
    }
    setVisionBase({ enabled, maxImages, maxBytes });
    setVisionMessage("Saved.");
    router.refresh();
  }

  return (
    <Panel title="Runtime controls" subtitle="Runtime config takes effect on the next Otto turn; server actions keep the existing audit trail.">
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-xl border border-border bg-background p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Otto provider</h3>
              <p className="mt-1 text-xs text-muted-foreground">Paid providers remain server-gated.</p>
            </div>
            <Badge variant={provider === "mock" ? "warning" : "info"}>{provider}</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Provider</span>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="w-full bg-card"><span>{provider}</span></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mock">mock</SelectItem>
                  <SelectItem value="fal">fal</SelectItem>
                  {canModal ? <SelectItem value="modal">modal</SelectItem> : null}
                </SelectContent>
              </Select>
            </label>
            <Button type="button" variant="secondary" disabled={!providerDirty || savingProvider} onClick={saveProvider}>
              {savingProvider ? "Saving" : "Save"}
            </Button>
          </div>
          {providerMessage ? <p className="mt-3 text-xs text-muted-foreground">{providerMessage}</p> : null}
        </div>

        <div className="rounded-xl border border-border bg-background p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Vision caps</h3>
              <p className="mt-1 text-xs text-muted-foreground">Reference image limits for Otto planner turns.</p>
            </div>
            <Badge variant={enabled ? "success" : "outline"}>{enabled ? "enabled" : "disabled"}</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[120px_120px_1fr_auto] sm:items-end">
            <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              enabled
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Images</span>
              <Input type="number" min={1} max={8} value={maxImages} onChange={(event) => setMaxImages(Number(event.target.value))} className="h-10 text-sm" />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Max bytes</span>
              <Input type="number" min={1} max={16000000} value={maxBytes} onChange={(event) => setMaxBytes(Number(event.target.value))} className="h-10 text-sm" />
            </label>
            <Button type="button" variant="secondary" disabled={!visionDirty || savingVision} onClick={saveVision}>
              {savingVision ? "Saving" : "Save"}
            </Button>
          </div>
          {visionMessage ? <p className="mt-3 text-xs text-muted-foreground">{visionMessage}</p> : null}
        </div>
      </div>
    </Panel>
  );
}

function ModelControlsPanel({ data }: { data: AdminV2Data }) {
  const [kind, setKind] = useState("all");
  const rows = data.otto.models.filter((row) => kind === "all" || row.kind === kind);

  return (
    <Panel
      title="Model controls"
      subtitle="Disable a typed model without changing the model catalog."
      action={
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger size="sm" className="w-[120px] bg-card"><span>{kind === "all" ? "All models" : kind}</span></SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All models</SelectItem>
            <SelectItem value="image">image</SelectItem>
            <SelectItem value="video">video</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      <div className="grid gap-2 md:grid-cols-2">
        {rows.map((row) => <ModelControlRow key={`${row.kind}:${row.id}`} row={row} />)}
      </div>
    </Panel>
  );
}

function ModelControlRow({ row }: { row: AdminV2Data["otto"]["models"][number] }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(row.enabled);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle(next: boolean) {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    const result = await saveModelEnabled({ modelId: row.id, enabled: next, notes: row.notes }).catch(() => null);
    setSaving(false);
    if (!result) {
      setMessage("Save failed.");
      return;
    }
    if ("error" in result) {
      setMessage(result.error);
      return;
    }
    setEnabled(next);
    setMessage("Saved.");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{row.id}</span>
            <Badge variant={row.kind === "video" ? "info" : "outline"}>{row.kind}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{row.family}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={enabled} disabled={saving} onChange={(event) => toggle(event.target.checked)} />
          {enabled ? "enabled" : "disabled"}
        </label>
      </div>
      {message ? <p className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}

function DirectivesPanel({ data }: { data: AdminV2Data }) {
  const router = useRouter();
  const [family, setFamily] = useState(data.otto.families[0] ?? "seedream");
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const rows = data.otto.directives.filter((row) => row.family === family);

  async function seed() {
    if (seeding) return;
    setSeeding(true);
    setSeedMessage(null);
    const result = await seedResearchDirectives().catch(() => null);
    setSeeding(false);
    if (!result) {
      setSeedMessage("Seed failed.");
      return;
    }
    if ("error" in result) {
      setSeedMessage(result.error);
      return;
    }
    setSeedMessage(`Inserted ${result.inserted}, refreshed ${result.refreshed}.`);
    router.refresh();
  }

  return (
    <Panel
      title="Prompt directives"
      subtitle="Edit the family x mode instruction cells Otto reads on the next enhance turn."
      action={
        <div className="flex items-center gap-2">
          <Select value={family} onValueChange={setFamily}>
            <SelectTrigger size="sm" className="w-[132px] bg-card"><span>{family}</span></SelectTrigger>
            <SelectContent align="end">
              {data.otto.families.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" variant="secondary" size="sm" disabled={seeding} onClick={seed}>{seeding ? "Seeding" : "Seed"}</Button>
        </div>
      }
    >
      {seedMessage ? <p className="mb-3 text-xs text-muted-foreground">{seedMessage}</p> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((row) => <DirectiveCell key={`${row.family}:${row.mode}`} cell={row} />)}
      </div>
    </Panel>
  );
}

function DirectiveCell({ cell }: { cell: AdminV2Data["otto"]["directives"][number] }) {
  const router = useRouter();
  const [directive, setDirective] = useState(cell.directive);
  const [confidence, setConfidence] = useState(cell.confidence);
  const [enabled, setEnabled] = useState(cell.enabled);
  const [base, setBase] = useState({ directive: cell.directive, confidence: cell.confidence, enabled: cell.enabled, exists: cell.exists, source: cell.source });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = directive !== base.directive || confidence !== base.confidence || enabled !== base.enabled;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setMessage(null);
    const result = await saveModelDirective({
      family: cell.family,
      mode: cell.mode,
      directive,
      notes: cell.notes,
      confidence,
      enabled,
      source: base.exists ? base.source : "founder",
    }).catch(() => null);
    setSaving(false);
    if (!result) {
      setMessage("Save failed.");
      return;
    }
    if ("error" in result) {
      setMessage(result.error);
      return;
    }
    setBase({ directive, confidence, enabled, exists: true, source: base.exists ? base.source : "founder" });
    setMessage("Saved.");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-foreground">{cell.mode}</span>
          {!base.exists ? <Badge variant="outline">unset</Badge> : null}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          enabled
        </label>
      </div>
      <Textarea value={directive} onChange={(event) => setDirective(event.target.value)} rows={4} maxLength={2000} placeholder="family-neutral base (no directive)" className="mt-3 min-h-24 text-sm" />
      <div className="mt-3 grid gap-2 sm:grid-cols-[150px_1fr_auto] sm:items-center">
        <Select value={confidence} onValueChange={setConfidence}>
          <SelectTrigger size="sm" className="w-full bg-card"><span>{confidence}</span></SelectTrigger>
          <SelectContent>
            {CONFIDENCE_LEVELS.map((level) => <SelectItem key={level} value={level}>{level}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{message}</span>
        <Button type="button" variant="secondary" size="sm" disabled={!dirty || saving} onClick={save}>{saving ? "Saving" : "Save"}</Button>
      </div>
    </div>
  );
}

function KnowledgePanel({ data }: { data: AdminV2Data }) {
  return (
    <Panel title="Knowledge text" subtitle="Planner prompt, project brief default, and reference description template.">
      <div className="grid gap-3">
        {data.otto.knowledge.map((row) => <KnowledgeTextRow key={row.key} row={row} />)}
      </div>
    </Panel>
  );
}

function KnowledgeTextRow({ row }: { row: AdminV2Data["otto"]["knowledge"][number] }) {
  const router = useRouter();
  const [value, setValue] = useState(row.value);
  const [base, setBase] = useState(row.value);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = value !== base;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setMessage(null);
    const result = await saveRuntimeConfig({ key: row.key, value: { text: value } }).catch(() => null);
    setSaving(false);
    if (!result) {
      setMessage("Save failed.");
      return;
    }
    if ("error" in result) {
      setMessage(result.error);
      return;
    }
    setBase(value);
    setMessage("Saved.");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{row.title}</h3>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{row.key}</p>
        </div>
        <Badge variant={row.present ? "success" : "warning"}>{row.present ? "stored" : "default"}</Badge>
      </div>
      <Textarea value={value} onChange={(event) => setValue(event.target.value)} rows={row.key === "planner_system" ? 8 : 4} className="mt-3 min-h-28 text-sm" />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{message}</span>
        <Button type="button" variant="secondary" size="sm" disabled={!dirty || saving} onClick={save}>{saving ? "Saving" : "Save"}</Button>
      </div>
    </div>
  );
}

function AuditSection({ data }: { data: AdminV2Data }) {
  const [query, setQuery] = useState("");
  const rows = data.audit.filter((row) => row.type.toLowerCase().includes(query.toLowerCase()) || row.ownerId.toLowerCase().includes(query.toLowerCase()));

  return (
    <Panel
      title="Audit stream"
      subtitle="The v2 table shows metadata only; raw payload expansion stays out of the default workflow."
      action={<Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter events" className="h-9 w-[200px] text-sm" />}
    >
      <div className="grid gap-2">
        {rows.length === 0 ? <EmptyState label="No audit events match this filter." /> : null}
        {rows.map((row) => (
          <div key={row.id} className="grid gap-2 rounded-xl border border-border bg-background p-3 md:grid-cols-[1fr_1fr_140px] md:items-center">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <History className="size-4 text-muted-foreground" />
                <span className="truncate text-sm font-medium text-foreground">{row.type}</span>
              </div>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{row.id}</p>
            </div>
            <p className="truncate text-xs text-muted-foreground">{row.ownerId}{row.projectId ? ` · ${row.projectId}` : ""}</p>
            <span className="font-mono text-xs text-muted-foreground md:text-right">{fmtDate(row.createdAt)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SystemSection({ data }: { data: AdminV2Data }) {
  return (
    <div className="grid gap-5">
      <SystemPanel rows={data.systemIncidents} />
      <Panel title="Recent paid jobs" subtitle="Frozen spend snapshots from GenJob and RefGenJob.">
        <div className="grid gap-2">
          {data.money.jobs.length === 0 ? <EmptyState label="No paid jobs in the sampled window." /> : null}
          {data.money.jobs.slice(0, 40).map((job) => (
            <div key={`${job.source}:${job.id}`} className="grid gap-2 rounded-xl border border-border bg-background p-3 lg:grid-cols-[90px_1fr_120px_90px_120px] lg:items-center">
              <Badge variant={job.status === "FAILED" ? "destructive" : "outline"}>{job.status}</Badge>
              <div className="min-w-0">
                <span className="truncate text-sm font-medium text-foreground">{job.label}</span>
                <p className="mt-1 truncate text-xs text-muted-foreground">{job.id}</p>
              </div>
              <span className="text-xs text-muted-foreground">{job.model}</span>
              <span className="text-sm font-semibold text-foreground">{usd(job.spentUsd)}</span>
              <span className="font-mono text-xs text-muted-foreground lg:text-right">{fmtDate(job.finishedAt)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function KeyValue({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 break-words text-foreground", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function CaseDialog({ row, onClose }: { row: CaseRow | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [revealed, setRevealed] = useState(false);
  const canReveal = reason.trim().length >= 8;

  function close() {
    setReason("");
    setRevealed(false);
    onClose();
  }

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-[min(620px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Open case</DialogTitle>
          <DialogDescription>
            Enter an access reason before continuing. This page does not load prompt, transcript, media, or raw payload data by default.
          </DialogDescription>
        </DialogHeader>
        {row ? (
          <div className="grid gap-4">
            <div className="rounded-xl border border-border bg-secondary p-3">
              <div className="flex flex-wrap items-center gap-2">
                {sourceIcon(row.source)}
                <span className="text-sm font-semibold text-foreground">{row.type}</span>
                <Badge variant={severityBadge(row.severity)}>{row.severity}</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{row.tenant} · {row.projectName} · {fmtDate(row.createdAt)}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {row.metadata.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}
              </div>
            </div>
            <label className="grid gap-2">
              <span className="text-xs font-medium text-muted-foreground">Access reason</span>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Review guardian block before merchant support reply." />
            </label>
            {revealed ? (
              <div className="rounded-xl border border-info/25 bg-info-soft p-4 text-sm text-info-soft-foreground">
                <div className="flex items-center gap-2 font-semibold">
                  <Lock className="size-4" />
                  Sensitive read remains sealed
                </div>
                <p className="mt-2 leading-6">
                  Reason captured locally for the prototype interaction. Production reveal needs an audited server action before fetching prompts, transcripts, media, or payloads.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
                Sensitive content is sealed. The button stays disabled until a reason is entered.
              </div>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={close}>Close</Button>
          <Button type="button" disabled={!canReveal} onClick={() => setRevealed(true)}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminDashboardV2({ section, data, selfEmail, currentRole }: Props) {
  const [selectedCase, setSelectedCase] = useState<CaseRow | null>(null);
  const content = useMemo(() => {
    if (section === "money") return <MoneySection data={data} />;
    if (section === "tenants") return <TenantsSection data={data} />;
    if (section === "staff") return <StaffSection data={data} selfEmail={selfEmail} />;
    if (section === "cases") return <CasesSection data={data} setCase={setSelectedCase} />;
    if (section === "otto") return <OttoSection data={data} currentRole={currentRole} />;
    if (section === "audit") return <AuditSection data={data} />;
    if (section === "system") return <SystemSection data={data} />;
    return <Overview data={data} setCase={setSelectedCase} />;
  }, [currentRole, data, section, selfEmail]);

  return (
    <PageChrome section={section} data={data}>
      {content}
      <CaseDialog row={selectedCase} onClose={() => setSelectedCase(null)} />
    </PageChrome>
  );
}
