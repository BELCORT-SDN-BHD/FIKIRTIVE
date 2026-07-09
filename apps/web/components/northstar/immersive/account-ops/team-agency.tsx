"use client";

/**
 * Agency 楼层(WHATPASS 八章:整城 registry 空白的最大缺口)—— 多客户伞层的**占位体**。
 * 一个 agency 老板一个入口管手上所有客户店:切客户、看全部客户健康度、一键从行业模板开新店。
 * 下半页是治理层(权限矩阵 / 花钱额度 / 审计留痕 / 品牌化月报)与远期转售层(明确标 demo)。
 *
 * §O3 硬约束:Account/团队/席位类 = Otto avatar none, dock only —— 钱与信任决策读作用户自己的,
 * 全页零 coral、零 OttoAvatar,确认按钮一律 INK。primary client = 真租户(NS_BRAND),
 * 其余为 agency-preview 占位客户;图从 NS_IMAGES 取(nsImage)。铁律:纯 client、零后台 import。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Building2, Check, ChevronDown, Copy, FileText, Minus, Plus, ShieldCheck, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader, StatCard } from "@/components/northstar/_shared";
import { NS_BRAND, nsImage } from "@/components/northstar/_mock";
import {
  activeAgencyClient,
  addAgencyClient,
  agencyClientsView,
  hasMilestone,
  markMilestone,
  recentEvents,
  switchAgencyClient,
  teamMembers,
  useStore,
  NS_AGENCY_SNAPSHOTS,
  type NsAgencyClient,
  type NsAgencySnapshot,
} from "../_store";
import { ACCOUNT_OPS_BASE as BASE, Card, CardHeader, TeamNav } from "./kit";

/* ── 品牌化客户月报(G-12 占位:预览 + 生成 + live 链接,logo 占位) ─────────── */
function AgencyReport({ clientName }: { clientName: string }) {
  const [copied, setCopied] = React.useState(false);
  const copyLink = () => {
    setCopied(true);
    toast("Live link copied", { description: "Anyone with the link sees the report — no account needed." });
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Card>
      <CardHeader
        title="Client report"
        desc="A monthly RM report you can hand to a client — their logo, your numbers. No more manual slides."
      />
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-secondary">
          <FileText className="size-5 text-foreground" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{clientName} · June report</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Reach, engagement and orders in ringgit — built from live numbers.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={copyLink}>
            <Copy strokeWidth={2} />
            {copied ? "Copied" : "Copy live link"}
          </Button>
          <Button size="sm" onClick={() => toast("Generating report", { description: `${clientName}'s branded PDF is on the way.` })}>
            Generate report
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ── 客户健康卡 ─────────────────────────────────────────────────────────── */
function ClientCard({ client, active, onSelect }: { client: NsAgencyClient; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex flex-col gap-3 rounded-[18px] border bg-card p-4 text-left transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-ring",
        active ? "border-primary ring-[2px] ring-ring/40" : "border-border hover:bg-accent",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="size-10 shrink-0 overflow-hidden rounded-[10px] bg-secondary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={nsImage("storefront", client.logoSeed)} alt="" className="size-full object-cover" width={40} height={40} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{client.name}</p>
            {client.isPrimary && <Badge variant="info">You</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{client.owner} · {client.city}</p>
        </div>
        <Badge variant={client.health === "good" ? "success" : "warning"}>
          {client.health === "good" ? "Healthy" : "Needs a look"}
        </Badge>
      </div>
      <dl className="grid grid-cols-3 gap-2 border-t border-border pt-3">
        <div>
          <dt className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">Waiting</dt>
          <dd className="mt-0.5 text-sm font-semibold text-foreground tabular-nums">{client.pendingApprovals}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">Credits</dt>
          <dd className="mt-0.5 text-sm font-semibold text-foreground tabular-nums">{client.creditBalance.toLocaleString("en-MY")}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">Posted</dt>
          <dd className="mt-0.5 truncate text-[13px] font-medium text-foreground">{client.lastPublished}</dd>
        </div>
      </dl>
    </button>
  );
}

/* ── 权限矩阵(section × role;✓ / 需审批 / ✗) ────────────────────────────── */
type Cell = "yes" | "approval" | "no";
const MATRIX_ROLES = ["Owner", "Manager", "Editor"] as const;
const MATRIX_ROWS: { area: string; cells: Record<(typeof MATRIX_ROLES)[number], Cell> }[] = [
  { area: "Create & draft", cells: { Owner: "yes", Manager: "yes", Editor: "yes" } },
  { area: "Schedule & publish", cells: { Owner: "yes", Manager: "yes", Editor: "approval" } },
  { area: "Spend credits", cells: { Owner: "yes", Manager: "yes", Editor: "approval" } },
  { area: "Connect channels", cells: { Owner: "yes", Manager: "yes", Editor: "no" } },
  { area: "Team & billing", cells: { Owner: "yes", Manager: "no", Editor: "no" } },
];

function CellMark({ cell }: { cell: Cell }) {
  if (cell === "yes") return <Check className="size-4 text-success-soft-foreground" strokeWidth={2.5} aria-label="Allowed" />;
  if (cell === "approval")
    return <span className="text-[11px] font-semibold text-warning-soft-foreground">Needs approval</span>;
  return <Minus className="size-4 text-muted-foreground" strokeWidth={2} aria-label="Not allowed" />;
}

/* ── 按角色的花钱额度(X-02 拍板数字) ────────────────────────────────────── */
const SPEND_CAPS: { role: string; single: string; daily: string }[] = [
  { role: "Owner", single: "No cap", daily: "No cap" },
  { role: "Manager", single: "1,000 credits", daily: "3,000 credits" },
  { role: "Editor", single: "Approval first", daily: "Approval first" },
];

export function TeamAgency() {
  useStore();
  const clients = agencyClientsView();
  const active = activeAgencyClient();
  const members = teamMembers();

  const totalPending = clients.reduce((s, c) => s + c.pendingApprovals, 0);
  const needAttention = clients.filter((c) => c.health === "attention").length;

  // 新客户向导(占位:选行业模板 → 预览会写什么 → 填资料 → 开店 + 里程碑)
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [snapshot, setSnapshot] = React.useState<NsAgencySnapshot | null>(null);
  const [form, setForm] = React.useState({ name: "", owner: "", city: "" });
  const [switcherOpen, setSwitcherOpen] = React.useState(false);

  const openWizard = () => {
    setSnapshot(null);
    setForm({ name: "", owner: "", city: "" });
    setWizardOpen(true);
  };

  const createClient = () => {
    if (!snapshot || !form.name.trim()) return;
    const firstEver = !clients.some((c) => c.fromSnapshot);
    addAgencyClient({ name: form.name, owner: form.owner, city: form.city, snapshotId: snapshot.id });
    setWizardOpen(false);
    // 首个从模板开出的客户 = GM-02 里程碑时刻(克制:只庆祝一次)
    if (firstEver && !hasMilestone("agency-first-client")) {
      markMilestone("agency-first-client");
      toast("First client opened 🎉", { description: `${form.name.trim()} is set up from the ${snapshot.name} template.` });
    } else {
      toast("Client opened", { description: `${form.name.trim()} is ready — switch to it any time.` });
    }
  };

  // 审计留痕:成员基线(从当前成员派生)+ 本会话真实的成员/agency 事件(最新在前)
  const liveAudit = recentEvents(40).filter(
    (e) => e.type === "member_invited" || e.type === "member_updated" || e.type === "member_removed",
  );
  const seedAudit = members
    .filter((m) => !m.role.includes("Owner"))
    .map((m) => (m.status === "pending" ? `Invited ${m.name} as ${m.role.toLowerCase()}` : `${m.name} joined as ${m.role.toLowerCase()}`));

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Agency"
        subtitle="One login for every client store. Switch between them, see them all at a glance, open new ones in minutes."
        actions={
          <>
            <TeamNav />
            <Button size="sm" onClick={openWizard}>
              <Plus strokeWidth={2} />
              New client
            </Button>
          </>
        }
      />

      {/* 预览定位条:讲清这是 agency 总控室(占位楼层),不误读为已上线的多租户 */}
      <div className="mt-6 flex items-start gap-2.5 rounded-[14px] border border-border bg-secondary/50 px-4 py-3">
        <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          A preview of the agency control room for shops that run multiple client stores. Your own store,{" "}
          <span className="font-medium text-foreground">{NS_BRAND.name}</span>, is the first client here.
        </p>
      </div>

      {/* 客户切换器(占位:切换即换 active + 事件流) */}
      <div className="mt-6">
        <div className="relative">
          <button
            type="button"
            onClick={() => setSwitcherOpen((v) => !v)}
            aria-expanded={switcherOpen}
            className="flex w-full items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="size-8 shrink-0 overflow-hidden rounded-[8px] bg-secondary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={nsImage("storefront", active.logoSeed)} alt="" className="size-full object-cover" width={32} height={32} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">Working on</p>
              <p className="truncate text-sm font-semibold text-foreground">{active.name}</p>
            </div>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", switcherOpen && "rotate-180")} strokeWidth={2} />
          </button>
          {switcherOpen && (
            <div className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-[14px] border border-border bg-popover shadow-lg">
              {clients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    switchAgencyClient(c.id);
                    setSwitcherOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-[120ms] hover:bg-accent"
                >
                  <span className="size-7 shrink-0 overflow-hidden rounded-[7px] bg-secondary">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={nsImage("storefront", c.logoSeed)} alt="" className="size-full object-cover" width={28} height={28} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{c.name}</span>
                  {c.id === active.id && <Check className="size-4 text-foreground" strokeWidth={2.5} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Agency 总览 */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Clients" value={String(clients.length)} delta={{ dir: "flat", text: "Stores you run" }} />
        <StatCard label="Waiting on you" value={String(totalPending)} delta={{ dir: "flat", text: "Approvals across all clients" }} />
        <StatCard
          label="Needs a look"
          value={String(needAttention)}
          delta={needAttention > 0 ? { dir: "down", text: "Low balance or stale" } : { dir: "flat", text: "All healthy" }}
        />
      </div>

      {/* 客户健康卡墙 */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-foreground">All clients</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {clients.map((c) => (
            <ClientCard key={c.id} client={c} active={c.id === active.id} onSelect={() => switchAgencyClient(c.id)} />
          ))}
          <button
            type="button"
            onClick={openWizard}
            className="flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-border bg-card p-4 text-center transition-colors duration-[120ms] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-secondary">
              <Plus className="size-5 text-foreground" strokeWidth={2} />
            </span>
            <span className="text-[13px] font-semibold text-foreground">Open a new client</span>
            <span className="text-xs text-muted-foreground">From an industry template</span>
          </button>
        </div>
      </div>

      {/* 治理层:权限矩阵 */}
      <div className="mt-8">
        <Card>
          <CardHeader title="Who can do what" desc="A single readable table of what each role may do. Otto is never a role here — this is for people." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-t border-border">
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">Area</th>
                  {MATRIX_ROLES.map((r) => (
                    <th key={r} className="px-4 py-2.5 text-center text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">{r}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX_ROWS.map((row) => (
                  <tr key={row.area} className="border-t border-border">
                    <td className="px-4 py-2.5 text-[13px] font-medium text-foreground">{row.area}</td>
                    {MATRIX_ROLES.map((r) => (
                      <td key={r} className="px-4 py-2.5 text-center">
                        <span className="inline-flex justify-center"><CellMark cell={row.cells[r]} /></span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* 治理层:按角色花钱额度(X-02 数字) */}
      <div className="mt-6">
        <Card>
          <CardHeader title="Spend limits by role" desc="How much a person can spend before it lands in your approval queue." />
          {SPEND_CAPS.map((cap) => (
            <div key={cap.role} className="flex items-center gap-3 border-t border-border px-4 py-3">
              <Badge variant={cap.role === "Owner" ? "info" : "outline"}>{cap.role}</Badge>
              <div className="ml-auto flex items-center gap-6 text-right">
                <div>
                  <p className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">Per job</p>
                  <p className="text-[13px] font-semibold text-foreground tabular-nums">{cap.single}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">Per day</p>
                  <p className="text-[13px] font-semibold text-foreground tabular-nums">{cap.daily}</p>
                </div>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
            <ShieldCheck className="size-3.5 text-muted-foreground" strokeWidth={2} />
            <p className="text-xs text-muted-foreground">Over the cap, the spend waits in <Link href={`${BASE}/team/approvals`} className="font-semibold text-foreground hover:underline">approvals</Link> for you.</p>
          </div>
        </Card>
      </div>

      {/* 治理层:审计留痕时间线 */}
      <div className="mt-6">
        <Card>
          <CardHeader title="Team changes" desc="Every invite, role change and removal — so you can trace who changed what." />
          <ul className="divide-y divide-border">
            {liveAudit.map((e) => (
              <li key={e.at} className="flex items-start gap-3 px-4 py-2.5">
                <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                <span className="min-w-0 text-[13px] leading-[18px] text-foreground">{e.label}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">Just now</span>
              </li>
            ))}
            {seedAudit.map((label, i) => (
              <li key={`seed-${i}`} className="flex items-start gap-3 px-4 py-2.5">
                <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                <span className="min-w-0 text-[13px] leading-[18px] text-foreground">{label}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* 品牌化客户月报(G-12 占位) */}
      <div className="mt-6">
        <AgencyReport clientName={active.name} />
      </div>

      {/* 远期转售层(明确标 demo,最轻原型:money-path 远期,原型仅 UI 占位) */}
      <div className="mt-8">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" strokeWidth={2} />
          <h2 className="text-sm font-semibold text-foreground">Coming to your agency floor</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          A preview of what an agency plan will add. These are placeholders — nothing here charges money or goes live yet.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {AGENCY_FUTURE.map((f) => (
            <div key={f.title} className="rounded-[14px] border border-dashed border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-semibold text-foreground">{f.title}</p>
                <Badge variant="outline" className="ml-auto">Demo</Badge>
              </div>
              <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Back to your team in{" "}
        <Link href={`${BASE}/team/members`} className="font-semibold text-foreground hover:underline">members</Link>
        {" "}and{" "}
        <Link href={`${BASE}/team/approvals`} className="font-semibold text-foreground hover:underline">approvals</Link>.
      </p>

      {/* 新客户向导 */}
      <Dialog open={wizardOpen} onOpenChange={(o) => !o && setWizardOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{snapshot ? `Open ${snapshot.name}` : "Pick an industry"}</DialogTitle>
            <DialogDescription>
              {snapshot
                ? "Here's what gets set up. You can change any of it after."
                : "A template pre-fills a brand kit, starter campaigns, auto-replies and Otto's skills — 10 hours of setup in 10 minutes."}
            </DialogDescription>
          </DialogHeader>

          {!snapshot ? (
            <div className="flex flex-col gap-2">
              {NS_AGENCY_SNAPSHOTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSnapshot(s)}
                  className="flex items-center gap-3 rounded-[12px] border border-border bg-card px-3.5 py-3 text-left transition-colors duration-[120ms] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground">{s.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.desc}</p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                </button>
              ))}
              <p className="mt-1 text-xs text-muted-foreground">
                Or reuse a setup you already tuned — <span className="font-medium text-foreground">save any client as your own template</span> (coming with agency plans).
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* 导入前预览「会写什么」(FB5 影响清单先行) */}
              <div className="rounded-[12px] border border-border bg-secondary/40 p-3.5">
                <p className="text-xs font-semibold text-foreground">What this writes</p>
                <ul className="mt-2 space-y-1.5">
                  {snapshot.writes.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] leading-[18px] text-foreground">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-success-soft-foreground" strokeWidth={2.5} />
                      <span className="min-w-0">{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-foreground">Client name</span>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Kopitiam Lapan Lapan" aria-label="Client name" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-foreground">Owner</span>
                  <Input value={form.owner} onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))} placeholder="Michelle Tan" aria-label="Owner" />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-foreground">City</span>
                  <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder="Petaling Jaya" aria-label="City" />
                </label>
              </div>
            </div>
          )}

          <DialogFooter className="flex-row justify-between gap-3">
            {snapshot ? (
              <Button variant="ghost" size="sm" onClick={() => setSnapshot(null)}>Back</Button>
            ) : (
              <span />
            )}
            {snapshot && (
              <Button size="sm" disabled={!form.name.trim()} onClick={createClient}>
                Open client
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── 远期转售层占位(旧判决多为「以后」,原型仅 UI 占位,真接线须过 money-safety-review) ── */
const AGENCY_FUTURE: { title: string; body: string }[] = [
  { title: "Branded client reports", body: "Auto-build a monthly RM report with the client's logo, export a PDF or share a live link." },
  { title: "Reseller markup", body: "Set a markup on the credits you pass to a client — resell like a data plan." },
  { title: "Referral tracking", body: "See the clients you referred and the share you've earned." },
  { title: "Self-serve sign-up (SaaS mode)", body: "Let a client sign up and pay on their own — a store opens automatically." },
  { title: "Free approver seats", body: "Buy creator seats, get approver seats free so your whole team can review." },
  { title: "Prospecting health check", body: "Generate a marketing check-up for a local business as an ice-breaker." },
];
