"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  Building2,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Database,
  Eye,
  FileText,
  Filter,
  Gauge,
  History,
  KeyRound,
  LayoutDashboard,
  Lock,
  MessageSquare,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";

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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type AdminV2Section =
  | "overview"
  | "money"
  | "tenants"
  | "staff"
  | "cases"
  | "otto"
  | "audit"
  | "system";

type SignalTone = "danger" | "warning" | "info" | "success" | "neutral";

type RiskSignal = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: SignalTone;
  icon: LucideIcon;
};

type ApprovalItem = {
  id: string;
  tenant: string;
  owner: string;
  amount: string;
  limit: string;
  requestedBy: string;
  status: "needs-founder" | "within-limit" | "cooldown" | "blocked";
  reason: string;
  age: string;
};

type TenantHealthRow = {
  id: string;
  name: string;
  owner: string;
  balance: number;
  reserved: number;
  spend24h: string;
  status: "active" | "watch" | "suspended";
  lastActive: string;
  risk: SignalTone;
};

type CaseRow = {
  id: string;
  tenant: string;
  owner: string;
  source: "Content" | "Otto";
  kind: "media" | "conversation" | "guardian";
  status: "sealed" | "opened" | "reported";
  severity: "low" | "medium" | "high";
  openedBy: string;
  updatedAt: string;
  metadata: string;
  sensitivePreview: {
    prompt: string;
    transcript: string;
    payload: string;
  };
};

type SystemIncident = {
  id: string;
  service: string;
  state: "healthy" | "degraded" | "failed";
  detail: string;
  count: number;
  updatedAt: string;
};

type AuditPreview = {
  id: string;
  type: string;
  actor: string;
  target: string;
  result: "allowed" | "denied" | "review";
  age: string;
};

const sections: { id: AdminV2Section; label: string; short: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", short: "Overview", icon: LayoutDashboard },
  { id: "money", label: "Money", short: "Money", icon: Wallet },
  { id: "tenants", label: "Tenants", short: "Tenants", icon: Building2 },
  { id: "staff", label: "Staff & permissions", short: "Staff", icon: Users },
  { id: "cases", label: "Cases", short: "Cases", icon: ClipboardList },
  { id: "otto", label: "Otto Ops", short: "Otto", icon: Bot },
  { id: "audit", label: "Audit", short: "Audit", icon: History },
  { id: "system", label: "System Health", short: "System", icon: Activity },
];

const riskSignals: RiskSignal[] = [
  { id: "approvals", label: "Pending approvals", value: "7", detail: "3 above finance limit", tone: "warning", icon: ShieldCheck },
  { id: "credit", label: "Credit risk", value: "12", detail: "low balance tenants", tone: "danger", icon: CreditCard },
  { id: "cases", label: "Open cases", value: "18", detail: "5 require founder review", tone: "info", icon: ClipboardList },
  { id: "queue", label: "Queue failures", value: "4", detail: "1 provider degradation", tone: "success", icon: Server },
];

const approvalQueue: ApprovalItem[] = [
  {
    id: "ap-1041",
    tenant: "Kopi Tujuh",
    owner: "maya@kopitujuh.my",
    amount: "1,800 credits",
    limit: "Over single limit",
    requestedBy: "finance@fikirtive.com",
    status: "needs-founder",
    reason: "Campaign launch credit bridge",
    age: "11 min",
  },
  {
    id: "ap-1038",
    tenant: "ARTLIO Studio",
    owner: "ops@artlio.co",
    amount: "-240 credits",
    limit: "Negative adjustment",
    requestedBy: "super-admin",
    status: "cooldown",
    reason: "Refund mismatch after duplicate settle",
    age: "27 min",
  },
  {
    id: "ap-1036",
    tenant: "Batik Bay",
    owner: "founder@batikbay.my",
    amount: "720 credits",
    limit: "Within finance limit",
    requestedBy: "finance@fikirtive.com",
    status: "within-limit",
    reason: "Stripe pack reconciliation",
    age: "42 min",
  },
  {
    id: "ap-1031",
    tenant: "Nasi House",
    owner: "admin@nasihouse.my",
    amount: "4,600 credits",
    limit: "Over daily limit",
    requestedBy: "finance@fikirtive.com",
    status: "blocked",
    reason: "Agency bulk account migration",
    age: "2 hr",
  },
];

const tenants: TenantHealthRow[] = [
  { id: "org_kopi", name: "Kopi Tujuh", owner: "maya@kopitujuh.my", balance: 42, reserved: 18, spend24h: "312 cr", status: "watch", lastActive: "4 min ago", risk: "warning" },
  { id: "org_artlio", name: "ARTLIO Studio", owner: "ops@artlio.co", balance: 612, reserved: 28, spend24h: "84 cr", status: "active", lastActive: "18 min ago", risk: "success" },
  { id: "org_batik", name: "Batik Bay", owner: "founder@batikbay.my", balance: 96, reserved: 6, spend24h: "51 cr", status: "active", lastActive: "1 hr ago", risk: "info" },
  { id: "org_nasi", name: "Nasi House", owner: "admin@nasihouse.my", balance: 0, reserved: 0, spend24h: "0 cr", status: "suspended", lastActive: "2 days ago", risk: "danger" },
];

const cases: CaseRow[] = [
  {
    id: "case-882",
    tenant: "Kopi Tujuh",
    owner: "maya@kopitujuh.my",
    source: "Otto",
    kind: "conversation",
    status: "sealed",
    severity: "high",
    openedBy: "none",
    updatedAt: "8 min ago",
    metadata: "Thread with generation denial and 2 paid attempts",
    sensitivePreview: {
      prompt: "Create a rainy-night campaign with a celebrity lookalike holding the product.",
      transcript: "User asked Otto to preserve brand mood, then requested a restricted likeness.",
      payload: "{\"guardian\":\"blocked_likeness\",\"turns\":9,\"spendRef\":\"otto-turn-7\"}",
    },
  },
  {
    id: "case-879",
    tenant: "ARTLIO Studio",
    owner: "ops@artlio.co",
    source: "Content",
    kind: "media",
    status: "reported",
    severity: "medium",
    openedBy: "moderator@fikirtive.com",
    updatedAt: "31 min ago",
    metadata: "Reported video result, model seedance-2-fast, 720p",
    sensitivePreview: {
      prompt: "Generate a hyper-real short video for a gallery launch invitation.",
      transcript: "No chat transcript attached to this media case.",
      payload: "{\"model\":\"seedance-2-fast\",\"job\":\"gj_721\",\"status\":\"reported\"}",
    },
  },
  {
    id: "case-871",
    tenant: "Batik Bay",
    owner: "founder@batikbay.my",
    source: "Otto",
    kind: "guardian",
    status: "sealed",
    severity: "low",
    openedBy: "none",
    updatedAt: "2 hr ago",
    metadata: "Guardian warning on product claim wording",
    sensitivePreview: {
      prompt: "Write high-converting ad copy claiming instant weight loss from tea.",
      transcript: "Otto suggested safer phrasing and asked for substantiation.",
      payload: "{\"guardian\":\"unsupported_claim\",\"resolution\":\"soft_denial\"}",
    },
  },
];

const incidents: SystemIncident[] = [
  { id: "sys-1", service: "Generation jobs", state: "healthy", detail: "24 queued, 6 generating", count: 30, updatedAt: "now" },
  { id: "sys-2", service: "Reference jobs", state: "degraded", detail: "3 failures on image remix", count: 3, updatedAt: "9 min ago" },
  { id: "sys-3", service: "Render jobs", state: "healthy", detail: "1 rendering, no failed jobs", count: 1, updatedAt: "12 min ago" },
  { id: "sys-4", service: "BytePlus provider", state: "failed", detail: "1 transient poll timeout", count: 1, updatedAt: "17 min ago" },
];

const audits: AuditPreview[] = [
  { id: "ae-924", type: "case.open", actor: "moderator@fikirtive.com", target: "case-879", result: "allowed", age: "3 min" },
  { id: "ae-921", type: "credits.grant", actor: "finance@fikirtive.com", target: "Kopi Tujuh", result: "review", age: "11 min" },
  { id: "ae-918", type: "impersonate.start", actor: "founder@fikirtive.com", target: "ARTLIO Studio", result: "allowed", age: "33 min" },
  { id: "ae-913", type: "section.denied", actor: "viewer@fikirtive.com", target: "Money", result: "denied", age: "1 hr" },
];

const ledgerCategories = [
  { label: "Otto conversation", value: "416 cr", detail: "148 turns", tone: "info" as const },
  { label: "Image generation", value: "1,082 cr", detail: "1,082 images", tone: "success" as const },
  { label: "Video generation", value: "2,736 cr", detail: "312 clips", tone: "warning" as const },
  { label: "Search/research", value: "184 cr", detail: "37 jobs", tone: "neutral" as const },
];

const sectionLabel = Object.fromEntries(sections.map((section) => [section.id, section.short])) as Record<AdminV2Section, string>;
const roleLabel: Record<string, string> = {
  "super-admin": "Super-admin",
  finance: "Finance",
  ops: "Ops",
  moderator: "Moderator",
  viewer: "Viewer",
};
const dateRangeLabel: Record<string, string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
};
const moneyFilterLabel: Record<string, string> = {
  all: "All states",
  "needs-founder": "Founder review",
  "within-limit": "Within limit",
  cooldown: "Cooldown",
  blocked: "Blocked",
};

function matchesSearch(query: string, values: Array<string | number | null | undefined>) {
  if (!query) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(query));
}

const permissionRows = [
  { section: "Money", viewer: "none", ops: "none", finance: "read / grant", moderator: "none", super: "approve" },
  { section: "Tenants", viewer: "none", ops: "read", finance: "wallet read", moderator: "none", super: "write / approve" },
  { section: "Cases", viewer: "metadata", ops: "metadata", finance: "none", moderator: "open case", super: "open / approve" },
  { section: "Otto Ops", viewer: "read", ops: "write", finance: "none", moderator: "none", super: "approve switches" },
  { section: "System", viewer: "read", ops: "write", finance: "none", moderator: "none", super: "write" },
];

function badgeVariant(tone: SignalTone): "success" | "warning" | "info" | "destructive" | "outline" {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "destructive";
  if (tone === "info") return "info";
  return "outline";
}

function statusTone(status: ApprovalItem["status"]): SignalTone {
  if (status === "within-limit") return "success";
  if (status === "needs-founder" || status === "cooldown") return "warning";
  return "danger";
}

function caseTone(caseRow: CaseRow): SignalTone {
  if (caseRow.severity === "high") return "danger";
  if (caseRow.severity === "medium") return "warning";
  return "info";
}

function incidentTone(state: SystemIncident["state"]): SignalTone {
  if (state === "healthy") return "success";
  if (state === "degraded") return "warning";
  return "danger";
}

function Panel({
  title,
  kicker,
  action,
  children,
  className,
}: {
  title: string;
  kicker?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 max-w-full rounded-2xl border border-border bg-card shadow-[var(--shadow-xs)]", className)}>
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          {kicker ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{kicker}</p> : null}
          <h2 className="truncate text-sm font-semibold tracking-normal text-foreground">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function IconButton({
  label,
  children,
  onClick,
  pressed,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={label} aria-pressed={pressed} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

function MetricCard({ signal }: { signal: RiskSignal }) {
  const Icon = signal.icon;
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-[14px] border border-border bg-card p-[15px] shadow-[var(--shadow-xs)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{signal.label}</p>
          <p className="mt-2 text-3xl font-semibold leading-none tracking-normal text-foreground">{signal.value}</p>
        </div>
        <span className={cn("shrink-0 rounded-lg p-2", signal.tone === "danger" ? "bg-error-soft text-error-soft-foreground" : signal.tone === "warning" ? "bg-warning-soft text-warning-soft-foreground" : signal.tone === "info" ? "bg-info-soft text-info-soft-foreground" : "bg-success-soft text-success-soft-foreground")}>
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Badge variant={badgeVariant(signal.tone)}>{signal.tone}</Badge>
        <span className="truncate text-xs text-muted-foreground">{signal.detail}</span>
      </div>
    </div>
  );
}

function MoneyQueue({
  filter,
  setFilter,
  rows = approvalQueue,
}: {
  filter: string;
  setFilter: (next: string) => void;
  rows?: ApprovalItem[];
}) {
  const visible = rows.filter((item) => filter === "all" || item.status === filter);
  return (
    <Panel
      title="Money risk queue"
      kicker="Approvals"
      action={
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger size="sm" className="w-[150px] bg-card">
            <span className="truncate">{moneyFilterLabel[filter]}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            <SelectItem value="needs-founder">Founder review</SelectItem>
            <SelectItem value="within-limit">Within limit</SelectItem>
            <SelectItem value="cooldown">Cooldown</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      <div className="hidden lg:grid lg:grid-cols-[1.1fr_0.8fr_0.8fr_0.9fr_88px] lg:gap-3">
        <TableHead>Tenant</TableHead>
        <TableHead>Amount</TableHead>
        <TableHead>Limit</TableHead>
        <TableHead>Reason</TableHead>
        <TableHead>Age</TableHead>
      </div>
      <div className="mt-2 grid gap-2">
        {visible.length === 0 ? <EmptyState label="No money risk rows match this view." /> : null}
        {visible.map((item) => (
          <div key={item.id} className="rounded-lg border border-border bg-background px-3 py-3 lg:grid lg:grid-cols-[1.1fr_0.8fr_0.8fr_0.9fr_88px] lg:items-center lg:gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{item.tenant}</p>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <Badge variant={badgeVariant(statusTone(item.status))}>{item.status.replace("-", " ")}</Badge>
                <p className="truncate text-xs text-muted-foreground">{item.owner}</p>
              </div>
            </div>
            <Field label="Amount" value={item.amount} />
            <Field label="Limit" value={item.limit} />
            <Field label="Reason" value={item.reason} />
            <Field label="Age" value={item.age} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function TenantWatchlist({
  selectedTenantId,
  setSelectedTenantId,
  rows = tenants,
}: {
  selectedTenantId: string;
  setSelectedTenantId: (next: string) => void;
  rows?: TenantHealthRow[];
}) {
  return (
    <Panel title="Tenant watchlist" kicker="Wallet + activity" action={<Badge variant="outline">{rows.length} tenants</Badge>}>
      <div className="hidden lg:grid lg:grid-cols-[1.1fr_0.75fr_0.75fr_0.85fr_0.75fr] lg:gap-3">
        <TableHead>Tenant</TableHead>
        <TableHead>Balance</TableHead>
        <TableHead>Reserved</TableHead>
        <TableHead>Spend 24h</TableHead>
        <TableHead>Last active</TableHead>
      </div>
      <div className="mt-2 grid gap-2">
        {rows.length === 0 ? <EmptyState label="No tenants match this view." /> : null}
        {rows.map((tenant) => (
          <button
            key={tenant.id}
            type="button"
            aria-pressed={tenant.id === selectedTenantId}
            onClick={() => setSelectedTenantId(tenant.id)}
            className={cn(
              "w-full rounded-lg border px-3 py-3 text-left transition-colors lg:grid lg:grid-cols-[1.1fr_0.75fr_0.75fr_0.85fr_0.75fr] lg:items-center lg:gap-3",
              tenant.id === selectedTenantId ? "border-foreground bg-secondary" : "border-border bg-background hover:bg-secondary",
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{tenant.name}</p>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <Badge variant={badgeVariant(tenant.risk)}>{tenant.status}</Badge>
                <p className="truncate text-xs text-muted-foreground">{tenant.owner}</p>
              </div>
            </div>
            <Field label="Balance" value={`${tenant.balance} cr`} />
            <Field label="Reserved" value={`${tenant.reserved} cr`} />
            <Field label="Spend 24h" value={tenant.spend24h} />
            <Field label="Last active" value={tenant.lastActive} />
          </button>
        ))}
      </div>
    </Panel>
  );
}

function CasesPanel({
  onOpenCase,
  compact = false,
  rows = cases,
}: {
  onOpenCase: (caseRow: CaseRow) => void;
  compact?: boolean;
  rows?: CaseRow[];
}) {
  const visible = compact ? rows.slice(0, 2) : rows;
  return (
    <Panel title="Cases" kicker="Metadata default" action={<Badge variant="info">sealed by default</Badge>}>
      <div className="hidden lg:grid lg:grid-cols-[0.8fr_1fr_0.75fr_0.75fr_1.2fr_64px] lg:gap-3">
        <TableHead>Case</TableHead>
        <TableHead>Tenant</TableHead>
        <TableHead>Source</TableHead>
        <TableHead>Severity</TableHead>
        <TableHead>Metadata</TableHead>
        <TableHead>Open</TableHead>
      </div>
      <div className="mt-2 grid gap-2">
        {visible.length === 0 ? <EmptyState label="No cases match this view." /> : null}
        {visible.map((caseRow) => (
          <div key={caseRow.id} className="rounded-lg border border-border bg-background px-3 py-3 lg:grid lg:grid-cols-[0.8fr_1fr_0.75fr_0.75fr_1.2fr_64px] lg:items-center lg:gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{caseRow.id}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{caseRow.updatedAt}</p>
            </div>
            <Field label="Tenant" value={caseRow.tenant} />
            <div className="mt-3 lg:mt-0">
              <Badge variant={caseRow.source === "Otto" ? "soft" : "outline"}>{caseRow.source}</Badge>
            </div>
            <div className="mt-3 lg:mt-0">
              <Badge variant={badgeVariant(caseTone(caseRow))}>{caseRow.severity}</Badge>
            </div>
            <Field label="Metadata" value={caseRow.metadata} />
            <div className="mt-3 flex justify-end lg:mt-0">
              <IconButton label={`Open ${caseRow.id}`} onClick={() => onOpenCase(caseRow)}>
                <Eye className="size-4" />
              </IconButton>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SystemPanel({ compact = false, rows = incidents }: { compact?: boolean; rows?: SystemIncident[] }) {
  const visible = compact ? rows.slice(0, 3) : rows;
  return (
    <Panel title="System health" kicker="Queues + providers" action={<Badge variant="warning">1 degraded</Badge>}>
      <div className="grid gap-2">
        {visible.length === 0 ? <EmptyState label="No system rows match this view." /> : null}
        {visible.map((incident) => (
          <div key={incident.id} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background px-3 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", incident.state === "healthy" ? "bg-success" : incident.state === "degraded" ? "bg-warning" : "bg-error")} />
                <p className="truncate text-sm font-semibold text-foreground">{incident.service}</p>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{incident.detail}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-foreground">{incident.count}</p>
              <Badge variant={badgeVariant(incidentTone(incident.state))}>{incident.state}</Badge>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AuditPanel({ rows = audits }: { rows?: AuditPreview[] }) {
  return (
    <Panel title="Recent admin activity" kicker="ActionEvent" action={<Badge variant="outline">live audit shape</Badge>}>
      <div className="grid gap-2">
        {rows.length === 0 ? <EmptyState label="No audit rows match this view." /> : null}
        {rows.map((event) => (
          <div key={event.id} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background px-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{event.type}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{event.actor}{" -> "}{event.target}</p>
            </div>
            <div className="text-right">
              <Badge variant={event.result === "denied" ? "destructive" : event.result === "review" ? "warning" : "success"}>{event.result}</Badge>
              <p className="mt-1 text-xs text-muted-foreground">{event.age}</p>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function TenantDetail({ tenant }: { tenant: TenantHealthRow }) {
  const available = Math.max(0, tenant.balance - tenant.reserved);
  const reservePercent = tenant.balance > 0 ? Math.min(100, Math.round((tenant.reserved / tenant.balance) * 100)) : 0;
  return (
    <Panel title="Selected tenant" kicker="Operational context" action={<Badge variant={badgeVariant(tenant.risk)}>{tenant.status}</Badge>}>
      <div className="grid gap-4">
        <div>
          <h3 className="text-xl font-semibold tracking-normal text-foreground">{tenant.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{tenant.owner}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Balance" value={`${tenant.balance}`} />
          <MiniStat label="Reserved" value={`${tenant.reserved}`} />
          <MiniStat label="Available" value={`${available}`} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Reserved share</span>
            <span>{reservePercent}%</span>
          </div>
          <Progress value={reservePercent} />
        </div>
        <div className="grid gap-2 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Spend 24h</span>
            <span className="text-sm font-semibold text-foreground">{tenant.spend24h}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Last active</span>
            <span className="text-sm font-semibold text-foreground">{tenant.lastActive}</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 min-w-0 lg:mt-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground lg:hidden">{label}</p>
      <p className="truncate text-sm text-foreground">{value}</p>
    </div>
  );
}

function TableHead({ children }: { children: React.ReactNode }) {
  return <div className="px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{children}</div>;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background px-3 py-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function PlaceholderSection({ section, children }: { section: AdminV2Section; children: React.ReactNode }) {
  const current = sections.find((item) => item.id === section)!;
  const Icon = current.icon;
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <span className="rounded-xl border border-border bg-card p-3 text-muted-foreground">
          <Icon className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">{current.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Prototype surface with local state and mock data.</p>
        </div>
      </div>
      {children}
    </div>
  );
}

export function AdminDashboardV2Prototype() {
  const [activeSection, setActiveSection] = React.useState<AdminV2Section>("overview");
  const [role, setRole] = React.useState("super-admin");
  const [dateRange, setDateRange] = React.useState("24h");
  const [moneyFilter, setMoneyFilter] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [showFilterSummary, setShowFilterSummary] = React.useState(false);
  const [lastRefreshLabel, setLastRefreshLabel] = React.useState("");
  const [selectedTenantId, setSelectedTenantId] = React.useState(tenants[0].id);
  const [caseToOpen, setCaseToOpen] = React.useState<CaseRow | null>(null);
  const [caseReason, setCaseReason] = React.useState("");
  const [caseUnlocked, setCaseUnlocked] = React.useState(false);
  const [ottoEnabled, setOttoEnabled] = React.useState(true);
  const [providerEnabled, setProviderEnabled] = React.useState(true);
  const query = search.trim().toLowerCase();
  const visibleApprovalQueue = React.useMemo(
    () =>
      approvalQueue.filter((item) =>
        matchesSearch(query, [item.tenant, item.owner, item.amount, item.limit, item.requestedBy, item.status, item.reason, item.age]),
      ),
    [query],
  );
  const visibleTenants = React.useMemo(
    () =>
      tenants.filter((tenant) =>
        matchesSearch(query, [tenant.name, tenant.owner, tenant.balance, tenant.reserved, tenant.spend24h, tenant.status, tenant.lastActive]),
      ),
    [query],
  );
  const visibleCases = React.useMemo(
    () =>
      cases.filter((caseRow) =>
        matchesSearch(query, [caseRow.id, caseRow.tenant, caseRow.owner, caseRow.source, caseRow.kind, caseRow.status, caseRow.severity, caseRow.metadata]),
      ),
    [query],
  );
  const visibleIncidents = React.useMemo(
    () => incidents.filter((incident) => matchesSearch(query, [incident.service, incident.state, incident.detail, incident.count, incident.updatedAt])),
    [query],
  );
  const visibleAudits = React.useMemo(
    () => audits.filter((event) => matchesSearch(query, [event.type, event.actor, event.target, event.result, event.age])),
    [query],
  );

  const selectedTenant = visibleTenants.find((tenant) => tenant.id === selectedTenantId) ?? visibleTenants[0] ?? null;
  const active = sections.find((section) => section.id === activeSection) ?? sections[0];
  const ActiveIcon = active.icon;

  function refreshMockData() {
    setLastRefreshLabel(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  }

  function openCase(caseRow: CaseRow) {
    setCaseToOpen(caseRow);
    setCaseReason("");
    setCaseUnlocked(false);
  }

  function renderSection() {
    if (activeSection === "overview") {
      return (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {riskSignals.map((signal) => <MetricCard key={signal.id} signal={signal} />)}
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
            <MoneyQueue filter={moneyFilter} setFilter={setMoneyFilter} rows={visibleApprovalQueue} />
            <TenantWatchlist selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId} rows={visibleTenants} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <CasesPanel compact rows={visibleCases} onOpenCase={openCase} />
            <SystemPanel compact rows={visibleIncidents} />
          </div>
          <AuditPanel rows={visibleAudits} />
        </div>
      );
    }
    if (activeSection === "money") {
      return (
        <PlaceholderSection section="money">
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <MoneyQueue filter={moneyFilter} setFilter={setMoneyFilter} rows={visibleApprovalQueue} />
            <Panel title="Ledger categories" kicker="Credit taxonomy" action={<Badge variant="outline">{dateRange}</Badge>}>
              <div className="grid gap-3 sm:grid-cols-2">
                {ledgerCategories.map((item) => (
                  <div key={item.label} className="rounded-lg border border-border bg-background p-4">
                    <Badge variant={badgeVariant(item.tone)}>{item.label}</Badge>
                    <p className="mt-3 text-2xl font-semibold text-foreground">{item.value}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
          <Panel title="Grant limits" kicker="Role money hierarchy" action={<Badge variant="warning">founder approval over limit</Badge>}>
            <div className="grid gap-2 md:grid-cols-3">
              <MiniStat label="Finance single" value="1,000 cr" />
              <MiniStat label="Finance daily" value="3,000 cr" />
              <MiniStat label="Negative adjust" value="typed confirm" />
            </div>
          </Panel>
        </PlaceholderSection>
      );
    }
    if (activeSection === "tenants") {
      return (
        <PlaceholderSection section="tenants">
          <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
            <TenantWatchlist selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId} rows={visibleTenants} />
            {selectedTenant ? <TenantDetail tenant={selectedTenant} /> : <EmptyState label="No tenant detail available for this search." />}
          </div>
        </PlaceholderSection>
      );
    }
    if (activeSection === "staff") {
      return (
        <PlaceholderSection section="staff">
          <Panel title="Permission matrix" kicker="Section x role x action" action={<Badge variant="outline">active role: {role}</Badge>}>
            <div className="hidden lg:grid lg:grid-cols-[1fr_repeat(5,0.8fr)] lg:gap-2">
              <TableHead>Section</TableHead>
              <TableHead>Viewer</TableHead>
              <TableHead>Ops</TableHead>
              <TableHead>Finance</TableHead>
              <TableHead>Moderator</TableHead>
              <TableHead>Super-admin</TableHead>
            </div>
            <div className="mt-2 grid gap-2">
              {permissionRows.map((row) => (
                <div key={row.section} className="rounded-lg border border-border bg-background p-3 lg:grid lg:grid-cols-[1fr_repeat(5,0.8fr)] lg:items-center lg:gap-2">
                  <p className="text-sm font-semibold text-foreground">{row.section}</p>
                  <Field label="Viewer" value={row.viewer} />
                  <Field label="Ops" value={row.ops} />
                  <Field label="Finance" value={row.finance} />
                  <Field label="Moderator" value={row.moderator} />
                  <Field label="Super-admin" value={row.super} />
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Staff queue" kicker="Invites + deactivation" action={<Badge variant="success">founders only now</Badge>}>
            <div className="grid gap-2 md:grid-cols-3">
              <MiniStat label="Active staff" value="3" />
              <MiniStat label="Pending invites" value="2" />
              <MiniStat label="Denied reads" value="5" />
            </div>
          </Panel>
        </PlaceholderSection>
      );
    }
    if (activeSection === "cases") {
      return (
        <PlaceholderSection section="cases">
          <CasesPanel rows={visibleCases} onOpenCase={openCase} />
        </PlaceholderSection>
      );
    }
    if (activeSection === "otto") {
      return (
        <PlaceholderSection section="otto">
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Runtime controls" kicker="Otto Ops" action={<Badge variant="soft">Otto only</Badge>}>
              <div className="grid gap-3">
                <ToggleRow label="Otto planner" detail="Agents runtime accepting turns" checked={ottoEnabled} onCheckedChange={setOttoEnabled} />
                <ToggleRow label="BytePlus media provider" detail="Seedream and Seedance dispatch" checked={providerEnabled} onCheckedChange={setProviderEnabled} />
                <ToggleRow label="Knowledge fallback" detail="Directive fallback if skill route misses" checked={true} onCheckedChange={() => {}} />
              </div>
            </Panel>
            <Panel title="Knowledge health" kicker="Prompt + model controls" action={<Badge variant="success">stable</Badge>}>
              <div className="grid gap-2">
                <MiniStat label="Directives" value="42" />
                <MiniStat label="Model routes" value="9" />
                <MiniStat label="Guardian rules" value="16" />
              </div>
            </Panel>
          </div>
        </PlaceholderSection>
      );
    }
    if (activeSection === "audit") {
      return (
        <PlaceholderSection section="audit">
          <AuditPanel rows={visibleAudits} />
        </PlaceholderSection>
      );
    }
    return (
      <PlaceholderSection section="system">
        <SystemPanel rows={visibleIncidents} />
      </PlaceholderSection>
    );
  }

  return (
    <TooltipProvider>
      <div className="gb min-h-screen w-full max-w-full overflow-x-hidden bg-background text-foreground">
        <div className="flex min-h-screen w-full max-w-full flex-col overflow-x-hidden md:flex-row">
          <aside className="hidden w-[222px] shrink-0 border-r border-[#EAEAE8] bg-[#F8F8F7] p-[14px_10px] md:flex md:flex-col">
            <div className="px-2 pb-3 pt-1">
              <div className="flex items-center gap-3">
                <div className="flex size-[30px] items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Gauge className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[17px] font-bold text-foreground">FIKIRTIVE Admin</p>
                  <p className="truncate text-xs text-muted-foreground">City Hall v2</p>
                </div>
              </div>
            </div>
            <nav className="mt-2 grid gap-px">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = section.id === activeSection;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      "flex h-[34px] items-center gap-[9px] rounded-[9px] px-[9px] text-left text-[13.5px] font-medium transition-colors",
                      isActive ? "bg-[#EAEAE8] text-foreground font-semibold" : "text-[#3A3A38] hover:bg-[#EAEAE8] hover:text-foreground",
                    )}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <Icon className={cn("size-[17px]", isActive ? "text-foreground" : "text-[#76766F]")} />
                    <span className="truncate">{section.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="mt-auto border-t border-[#EAEAE8] pt-3">
              <div className="rounded-[14px] border border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Lock className="size-4 text-muted-foreground" />
                  <p className="text-xs font-semibold text-foreground">Founder wall</p>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Staff membership replaces this in production v2.</p>
              </div>
            </div>
          </aside>

          <main className="min-w-0 max-w-full flex-1 overflow-x-hidden">
            <header className="max-w-[1180px] px-4 pb-3 pt-5 md:px-7 md:pt-[22px]">
              <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="md:hidden">
                    <Select value={activeSection} onValueChange={(next) => setActiveSection(next as AdminV2Section)}>
                      <SelectTrigger className="w-[170px] bg-card">
                        <span className="truncate">{sectionLabel[activeSection]}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {sections.map((section) => (
                          <SelectItem key={section.id} value={section.id}>{section.short}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ActiveIcon className="hidden size-5 text-muted-foreground md:block" />
                      <h1 className="truncate text-xl font-semibold tracking-normal text-foreground md:text-2xl">{active.label}</h1>
                    </div>
                    <p className="mt-1 hidden text-sm text-muted-foreground sm:block">Operations, money safety, cases, staff permissions, and system health.</p>
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="relative min-w-0 flex-[1_1_190px] sm:flex-none">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tenants, cases, actions" className="h-9 pl-9 text-sm" />
                  </div>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger size="sm" className="w-[132px] bg-card sm:w-[142px]">
                      <span className="truncate">{roleLabel[role]}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="super-admin">Super-admin</SelectItem>
                      <SelectItem value="finance">Finance</SelectItem>
                      <SelectItem value="ops">Ops</SelectItem>
                      <SelectItem value="moderator">Moderator</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={dateRange} onValueChange={setDateRange}>
                    <SelectTrigger size="sm" className="w-[92px] bg-card sm:w-[110px]">
                      <span className="truncate">{dateRangeLabel[dateRange]}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24h">24h</SelectItem>
                      <SelectItem value="7d">7d</SelectItem>
                      <SelectItem value="30d">30d</SelectItem>
                    </SelectContent>
                  </Select>
                  <IconButton label="Filter view" pressed={showFilterSummary} onClick={() => setShowFilterSummary((open) => !open)}>
                    <Filter className="size-4" />
                  </IconButton>
                  <IconButton label="Refresh mock data" onClick={refreshMockData}>
                    <RefreshCw className="size-4" />
                  </IconButton>
                </div>
              </div>
            </header>

            <div className="w-full max-w-[1180px] overflow-x-hidden px-4 pb-7 md:px-7">
              {showFilterSummary ? (
                <div className="mb-4 grid gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">View filters</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Search narrows approvals, tenants, cases, audit, and system rows in this preview.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{active.label}</Badge>
                    <Badge variant="outline">{roleLabel[role]}</Badge>
                    <Badge variant="outline">{dateRangeLabel[dateRange]}</Badge>
                    <Badge variant="outline">{moneyFilterLabel[moneyFilter]}</Badge>
                  </div>
                </div>
              ) : null}
              {search.trim() ? (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <p className="min-w-0 truncate text-sm text-muted-foreground">Showing local matches for <span className="font-semibold text-foreground">{search}</span></p>
                  <Button variant="ghost" size="sm" onClick={() => setSearch("")}>Clear</Button>
                </div>
              ) : null}
              {lastRefreshLabel ? (
                <div className="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                  Mock data refreshed at <span className="font-mono font-semibold text-foreground">{lastRefreshLabel}</span>
                </div>
              ) : null}
              {renderSection()}
            </div>
          </main>
        </div>

        <Dialog open={!!caseToOpen} onOpenChange={(open) => {
          if (!open) {
            setCaseToOpen(null);
            setCaseReason("");
            setCaseUnlocked(false);
          }
        }}>
          <DialogContent className="max-w-[min(720px,calc(100vw-2rem))]">
            {caseToOpen ? (
              <>
                <DialogHeader>
                  <DialogTitle>Open {caseToOpen.id}</DialogTitle>
                  <DialogDescription>{caseToOpen.tenant} · {caseToOpen.source} · {caseToOpen.metadata}</DialogDescription>
                </DialogHeader>
                {!caseUnlocked ? (
                  <div className="grid gap-4">
                    <div className="rounded-xl border border-border bg-secondary p-4">
                      <div className="flex items-center gap-2">
                        <Lock className="size-4 text-muted-foreground" />
                        <p className="text-sm font-semibold text-foreground">Sensitive content sealed</p>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">Full prompt, transcript, media notes, and raw payload unlock only after an audited reason.</p>
                    </div>
                    <div className="grid gap-2">
                      <label htmlFor="case-reason" className="text-sm font-semibold text-foreground">Reason</label>
                      <Textarea
                        id="case-reason"
                        value={caseReason}
                        onChange={(event) => setCaseReason(event.target.value)}
                        placeholder="Enter audit reason"
                        className="min-h-24 bg-card"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <SensitiveBlock icon={MessageSquare} label="Prompt" value={caseToOpen.sensitivePreview.prompt} />
                    <SensitiveBlock icon={FileText} label="Transcript" value={caseToOpen.sensitivePreview.transcript} />
                    <SensitiveBlock icon={Database} label="Payload" value={caseToOpen.sensitivePreview.payload} mono />
                  </div>
                )}
                <DialogFooter>
                  {!caseUnlocked ? (
                    <Button disabled={caseReason.trim().length < 8} onClick={() => setCaseUnlocked(true)}>
                      <KeyRound className="size-4" />
                      Open case
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => setCaseToOpen(null)}>
                      <CheckCircle2 className="size-4" />
                      Close case
                    </Button>
                  )}
                </DialogFooter>
              </>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function ToggleRow({
  label,
  detail,
  checked,
  onCheckedChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

function SensitiveBlock({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">{label}</p>
      </div>
      <p className={cn("text-sm leading-6 text-foreground", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}
