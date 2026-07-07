/* @nsPage district="市政厅" page="admin" status="draft"
   sources="区划图·市政厅;蓝图第六章·市政厅 v2;X-01~X-05 判决" approvedAt="" pr="" */
"use client";

/**
 * 市政厅全后台(admin,单列)— 运营与账房(仅 BELCORT 内部,Otto 永久豁免)。
 *
 * 依据:PAGE-INVENTORY 十三·市政厅行(设计降级)+ 蓝图第六章·市政厅 v2 + GRILL X-01~X-05。
 * 定位「设计降级」(缝 7):不入逐页世界级 UIUX 舰队,只要求 token / 组件一致 —— 干净、精确、
 * 密度更高(§D4 form B 边框网格行、§L7 admin compact),但不追求对客的暖度与 Otto 在场。
 * Otto 永久豁免:此页零 Otto、零 coral(coral law:coral 只属 Otto,而 Otto 不进市政厅)。
 * 内容:
 *   · 现有 8 个 v2 section(Overview/Money/Tenants/Staff/Cases/Otto Ops/Audit/System)的可读入口;
 *   · SECTION_MATRIX 一张可读表(五级阶级 × section × 读/写/无)—— X-01;
 *   · 钱的阶级(X-02 授信上限)+ 冒充收紧(X-03)+ 双人确认(X-04)+ 内容可见深度(X-05)政策面;
 * 导航:§N 常规路由 + aria-current;admin 专属 underline tabs 合法(§N4)。零后台,数据全 mock。
 */

import * as React from "react";
import {
  Activity,
  Banknote,
  Bot,
  Building2,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MockNote } from "@/components/northstar/_shared";

/* ── 8 个 section(与现有 AdminV2Nav 同序;Otto Ops 不着 coral —— 市政厅豁免) ── */
type SectionId = "overview" | "money" | "tenants" | "staff" | "cases" | "otto" | "audit" | "system";

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "money", label: "Money", icon: Banknote },
  { id: "tenants", label: "Tenants", icon: Building2 },
  { id: "staff", label: "Staff & permissions", icon: ShieldCheck },
  { id: "cases", label: "Cases", icon: ClipboardList },
  { id: "otto", label: "Otto Ops", icon: Bot },
  { id: "audit", label: "Audit", icon: Activity },
  { id: "system", label: "System health", icon: Gauge },
];

/* ── SECTION_MATRIX(X-01 五级阶级 × 权限;放矩阵文件随时可调,此处 mock) ── */
const ROLES = ["viewer", "moderator", "finance", "admin", "super-admin"] as const;
type Role = (typeof ROLES)[number];
type Perm = "none" | "read" | "write";

const MATRIX: { area: string; perms: Record<Role, Perm> }[] = [
  { area: "Model & system", perms: { viewer: "read", moderator: "read", finance: "none", admin: "write", "super-admin": "write" } },
  { area: "Tenant accounts", perms: { viewer: "none", moderator: "read", finance: "read", admin: "write", "super-admin": "write" } },
  { area: "Money & credits", perms: { viewer: "none", moderator: "none", finance: "write", admin: "read", "super-admin": "write" } },
  { area: "Cases & content", perms: { viewer: "none", moderator: "write", finance: "none", admin: "read", "super-admin": "write" } },
  { area: "Staff & roles", perms: { viewer: "none", moderator: "none", finance: "none", admin: "read", "super-admin": "write" } },
  { area: "Audit log", perms: { viewer: "read", moderator: "read", finance: "read", admin: "read", "super-admin": "read" } },
];

const PERM_META: Record<Perm, { label: string; cls: string }> = {
  write: { label: "Write", cls: "bg-foreground text-background" },
  read: { label: "Read", cls: "bg-secondary text-foreground" },
  none: { label: "—", cls: "text-muted-foreground/50" },
};

/* ── 治理政策(X-02~X-05) ── */
const POLICIES = [
  {
    id: "X-02",
    title: "Spend limits by role",
    body: "Finance can move up to 1,000 credits per action and 3,000 per day. Anything larger queues for founder approval. Numbers live in the matrix file and change without a deploy.",
  },
  {
    id: "X-03",
    title: "Impersonation is tight",
    body: "Only super-admin can impersonate, always read-only, always with a reason on record. A banner stays visible and the session expires after 30 minutes. Every action is logged.",
  },
  {
    id: "X-04",
    title: "Two-person confirms",
    body: "Suspending or deleting a tenant, negative credit adjustments, tenant-wide model switches and data exports need a second person once the team is more than one. Until then: type-to-confirm plus a cooldown.",
  },
  {
    id: "X-05",
    title: "Content visibility depth",
    body: "Metadata only by default. Reading a full conversation needs an explicit open-case action, on record. Finance never sees content, only the books. Moderators see reported content for their job.",
  },
] as const;

/* ── Overview mock ── */
const MONEY_STATS = [
  { label: "Credits in circulation", value: "182.4K", note: "across 3 tenants" },
  { label: "Top-ups today", value: "RM 1,240", note: "2 payments" },
  { label: "Spend queued for review", value: "1", note: "over the finance cap" },
  { label: "Channel-fee wallet", value: "RM 86.50", note: "second ledger" },
];

const AUDIT_ROWS = [
  { at: "09:41", actor: "founder", action: "Adjusted credits", target: "Roti Bulan Bakery", tone: "read" as const },
  { at: "09:12", actor: "founder", action: "Opened case (content)", target: "Conversation cv-02", tone: "write" as const },
  { at: "08:50", actor: "system", action: "Nightly DB backup ok", target: "artlio-prod", tone: "read" as const },
  { at: "yesterday", actor: "finance", action: "Top-up refunded", target: "Warung Kopi Jaya", tone: "write" as const },
];

const TENANT_ROWS = [
  { name: "Roti Bulan Bakery", plan: "Team", credits: "1,240", status: "active" as const },
  { name: "Warung Kopi Jaya", plan: "Starter", credits: "180", status: "active" as const },
  { name: "Nasi Lemak Antarabangsa", plan: "Starter", credits: "0", status: "suspended" as const },
];

function StatCell({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-card p-3">
      <div className="text-[11px] leading-4 font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-[22px] leading-7 font-bold tracking-[-0.02em] text-foreground tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{note}</div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </div>
  );
}

export default function Page() {
  const [active, setActive] = React.useState<SectionId>("overview");

  return (
    <div className="flex min-h-full bg-background">
      {/* ── 内部 section 轨(admin 密度;非对客,故更紧) ── */}
      <nav
        aria-label="Admin sections"
        className="hidden w-56 shrink-0 flex-col border-r border-border p-3 lg:flex"
      >
        <div className="flex items-center gap-2 px-2 pb-3">
          <span className="flex size-6 items-center justify-center rounded-[8px] bg-foreground text-[11px] font-bold text-background">
            城
          </span>
          <span className="text-sm font-semibold text-foreground">City hall</span>
          <Badge variant="outline" className="ml-auto text-[10px]">
            v2
          </Badge>
        </div>
        <div className="grid gap-0.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const on = s.id === active;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-[10px] px-3 text-[13px] transition-colors duration-[120ms]",
                  on
                    ? "bg-secondary font-semibold text-foreground"
                    : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-4" strokeWidth={2} />
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-auto border-t border-border px-2 pt-3">
          <p className="text-[11px] leading-4 text-muted-foreground">
            BELCORT internal only. Otto is never present here.
          </p>
        </div>
      </nav>

      {/* ── 内容 ── */}
      <main className="min-w-0 flex-1 overflow-x-hidden px-6 pt-6 pb-24">
        {/* 移动端 section 选择(≤lg 轨收起) */}
        <div className="mb-4 flex flex-wrap gap-1.5 lg:hidden">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={cn(
                "h-8 rounded-full border px-3 text-[12px] font-medium transition-colors duration-[120ms]",
                s.id === active
                  ? "border-transparent bg-secondary text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl leading-[30px] font-bold tracking-[-0.02em] text-foreground">
            {SECTIONS.find((s) => s.id === active)?.label}
          </h1>
          <Badge variant="outline">Founders only</Badge>
          <div className="flex-1" />
          <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.04em] text-muted-foreground">
            signed in · founder
          </span>
        </header>

        {active === "overview" && (
          <div className="mt-6 flex flex-col gap-6">
            {/* 钱的阶级快照 */}
            <section>
              <SectionHeading>Money at a glance</SectionHeading>
              <div className="mt-2 grid grid-cols-2 gap-3 xl:grid-cols-4">
                {MONEY_STATS.map((s) => (
                  <StatCell key={s.label} {...s} />
                ))}
              </div>
            </section>

            {/* 最近审计(§D4 form B 边框网格行) */}
            <section>
              <SectionHeading>Recent audit</SectionHeading>
              <div className="mt-2 flex flex-col gap-1.5">
                {AUDIT_ROWS.map((r, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[60px_88px_1fr_auto] items-center gap-3 rounded-[10px] border border-border bg-card px-3 py-2.5"
                  >
                    <span className="font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">{r.at}</span>
                    <span className="font-mono text-[11px] leading-4 font-medium text-foreground">{r.actor}</span>
                    <span className="min-w-0 truncate text-[13px] text-foreground">
                      {r.action} <span className="text-muted-foreground">· {r.target}</span>
                    </span>
                    <Badge variant={r.tone === "write" ? "warning" : "outline"} className="text-[10px]">
                      {r.tone === "write" ? "write" : "read"}
                    </Badge>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {active === "money" && (
          <div className="mt-6 flex flex-col gap-6">
            <section>
              <SectionHeading>Money at a glance</SectionHeading>
              <div className="mt-2 grid grid-cols-2 gap-3 xl:grid-cols-4">
                {MONEY_STATS.map((s) => (
                  <StatCell key={s.label} {...s} />
                ))}
              </div>
            </section>
            <PolicyPanel only="X-02" />
          </div>
        )}

        {active === "tenants" && (
          <section className="mt-6">
            <SectionHeading>Tenants</SectionHeading>
            <div className="mt-2 flex flex-col gap-1.5">
              {TENANT_ROWS.map((t) => (
                <div
                  key={t.name}
                  className="grid grid-cols-[1fr_88px_96px_auto] items-center gap-3 rounded-[10px] border border-border bg-card px-3 py-3"
                >
                  <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{t.name}</span>
                  <span className="text-[12px] text-muted-foreground">{t.plan}</span>
                  <span className="text-right text-[13px] font-semibold text-foreground tabular-nums">
                    {t.credits} cr
                  </span>
                  <Badge variant={t.status === "suspended" ? "destructive" : "success"} className="text-[10px]">
                    {t.status}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">Showing all 3 tenants.</p>
          </section>
        )}

        {active === "staff" && (
          <div className="mt-6 flex flex-col gap-6">
            {/* SECTION_MATRIX 可读表(X-01) */}
            <section>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <SectionHeading>Permission matrix</SectionHeading>
                <span className="text-[11px] text-muted-foreground">
                  Five roles. Current team is founders only; roles fill in as real staff join.
                </span>
              </div>
              <div className="mt-2 overflow-x-auto rounded-[10px] border border-border">
                <table className="w-full min-w-[560px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border bg-secondary/40">
                      <th className="px-3 py-2.5 text-[11px] font-semibold text-muted-foreground">Area</th>
                      {ROLES.map((r) => (
                        <th
                          key={r}
                          className="px-3 py-2.5 text-center font-mono text-[11px] font-medium tracking-[0.02em] text-muted-foreground"
                        >
                          {r}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MATRIX.map((row) => (
                      <tr key={row.area} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2.5 text-[13px] font-medium text-foreground">{row.area}</td>
                        {ROLES.map((r) => {
                          const meta = PERM_META[row.perms[r]];
                          return (
                            <td key={r} className="px-3 py-2.5 text-center">
                              <span
                                className={cn(
                                  "inline-flex h-6 min-w-[52px] items-center justify-center rounded-full px-2.5 text-[11px] font-semibold",
                                  meta.cls,
                                )}
                              >
                                {meta.label}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <PolicyPanel only="X-04" />
            <PolicyPanel only="X-03" />
          </div>
        )}

        {active === "cases" && <PolicyPanel only="X-05" heading="Cases & content visibility" />}

        {active === "otto" && (
          <section className="mt-6 rounded-[var(--radius-card)] border border-border bg-card p-6">
            <SectionHeading>Otto operations</SectionHeading>
            <p className="mt-2 max-w-[560px] text-[13px] leading-[19px] text-muted-foreground">
              Platform-level view of Otto's tool runs, spend and guardrail trips across all tenants.
              This is the operator's console, not a chat surface. Otto has no presence in city hall
              and never acts here.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCell label="Tool runs today" value="1,204" note="all tenants" />
              <StatCell label="Guardrail trips" value="3" note="all blocked" />
              <StatCell label="Avg run cost" value="12 cr" note="last 24h" />
              <StatCell label="Failed + refunded" value="2" note="auto-refunded" />
            </div>
          </section>
        )}

        {active === "audit" && (
          <section className="mt-6">
            <SectionHeading>Audit log</SectionHeading>
            <div className="mt-2 flex flex-col gap-1.5">
              {[...AUDIT_ROWS, ...AUDIT_ROWS].map((r, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[60px_88px_1fr_auto] items-center gap-3 rounded-[10px] border border-border bg-card px-3 py-2.5"
                >
                  <span className="font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">{r.at}</span>
                  <span className="font-mono text-[11px] leading-4 font-medium text-foreground">{r.actor}</span>
                  <span className="min-w-0 truncate text-[13px] text-foreground">
                    {r.action} <span className="text-muted-foreground">· {r.target}</span>
                  </span>
                  <Badge variant={r.tone === "write" ? "warning" : "outline"} className="text-[10px]">
                    {r.tone === "write" ? "write" : "read"}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Every write is retained. The log is read-only for everyone, including super-admin.
            </p>
          </section>
        )}

        {active === "system" && (
          <section className="mt-6">
            <SectionHeading>System health</SectionHeading>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { label: "Web + worker", state: "Operational", ok: true },
                { label: "Prisma migrations", state: "Up to date", ok: true },
                { label: "Nightly DB backup", state: "Last: 08:50 today", ok: true },
                { label: "Generation providers", state: "fal · byteplus ok", ok: true },
              ].map((r) => (
                <div
                  key={r.label}
                  className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-4 py-3"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        r.ok ? "bg-[var(--success)]" : "bg-[var(--error)]",
                      )}
                      aria-hidden
                    />
                    <span className="text-[13px] font-medium text-foreground">{r.label}</span>
                  </div>
                  <span className="text-[12px] text-muted-foreground">{r.state}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <MockNote path="/northstar/cityhall/admin" />
      </main>
    </div>
  );
}

/* ── 治理政策面(X-02~X-05;可只显示一条) ── */
function PolicyPanel({ only, heading }: { only?: (typeof POLICIES)[number]["id"]; heading?: string }) {
  const items = only ? POLICIES.filter((p) => p.id === only) : POLICIES;
  return (
    <section className={only && !heading ? "" : "mt-6"}>
      <SectionHeading>{heading ?? "Governance policy"}</SectionHeading>
      <div className="mt-2 flex flex-col gap-2">
        {items.map((p) => (
          <div key={p.id} className="rounded-[10px] border border-border bg-card p-4">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] font-semibold tracking-[0.04em] text-muted-foreground">
                {p.id}
              </span>
              <h3 className="text-[14px] font-semibold text-foreground">{p.title}</h3>
            </div>
            <p className="mt-1.5 text-[13px] leading-[19px] text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
