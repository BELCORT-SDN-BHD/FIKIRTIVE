"use client";

import { type FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BadgeDollarSign, DoorOpen, Eye, ShieldAlert, UserRoundSearch } from "lucide-react";
import type { TenantDetail as Detail } from "@/lib/tenant-admin";
import {
  cutTenantSessions,
  grantTenantCredits,
  impersonateTenant,
  setMembershipStatus,
} from "@/lib/tenant-actions";
import { refundCreditsAction, completeManualRefund } from "@/lib/refund-actions";
import { FINANCE_ADJUST_LIMITS, FINANCE_PER_ACTION_LIMIT_MESSAGE } from "@fikirtive/core/finance-limits";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function fmtDate(iso: string) {
  return iso.slice(0, 16).replace("T", " ");
}

function fmtUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

function statusVariant(status: string) {
  if (status === "active") return "success";
  if (status === "suspended" || status === "revoked") return "destructive";
  return "outline";
}

function Panel({ title, subtitle, action, children }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card shadow-xs">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail?: string; tone?: "neutral" | "warning" | "danger" }) {
  return (
    <div className={cn(
      "rounded-[14px] border border-border bg-card p-4 shadow-xs",
      tone === "warning" && "border-warning/30 bg-warning-soft/40",
      tone === "danger" && "border-destructive/30 bg-error-soft/40",
    )}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold leading-none text-foreground">{value}</p>
      {detail ? <p className="mt-2 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export function TenantDetail({ detail }: { detail: Detail }) {
  const { orgId, name, ownerEmail, status, balance, reserved, spentUsd, projectCount, genCount, ledger, audit, adjustRolling30dDisplay, adjustRolling30dLimitDisplay, creditPacks } = detail;
  const router = useRouter();
  const grantBusyRef = useRef(false);

  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantMsg, setGrantMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [cutBusy, setCutBusy] = useState(false);
  const [cutMsg, setCutMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // MONEY-A14 人工退款。**退款单号在表单里生成一次就不再变**:它同时是账本 refId 和 Stripe 的
  // idempotency key,每点一次就换一个新号,等于把幂等保护自己关掉。重试要用同一个号。
  const [refundAmount, setRefundAmount] = useState("");
  const [refundPi, setRefundPi] = useState("");
  const [refundPack, setRefundPack] = useState(String(creditPacks[0]?.credits ?? ""));
  const [refundReason, setRefundReason] = useState("");
  const [refundPartial, setRefundPartial] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundMsg, setRefundMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [refundTicket, setRefundTicket] = useState(() => crypto.randomUUID());
  const refundBusyRef = useRef(false);

  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState("");
  const [impersonateBusy, setImpersonateBusy] = useState(false);
  const [impersonateMsg, setImpersonateMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canImpersonate = impersonateReason.trim().length >= 8;
  const parsedGrantAmount = Number(grantAmount);
  const grantOverLimit = Number.isFinite(parsedGrantAmount) && Math.abs(parsedGrantAmount) > FINANCE_ADJUST_LIMITS.perActionDisplay;

  async function submitGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (grantBusyRef.current) return;
    grantBusyRef.current = true;
    try {
      const displayedAmount = Number(grantAmount);
      if (!Number.isInteger(displayedAmount) || displayedAmount === 0) {
        setGrantMsg({ ok: false, text: "Enter a non-zero whole number of credits." });
        return;
      }
      if (Math.abs(displayedAmount) > FINANCE_ADJUST_LIMITS.perActionDisplay) {
        setGrantMsg({ ok: false, text: FINANCE_PER_ACTION_LIMIT_MESSAGE });
        return;
      }
      setGrantBusy(true);
      setGrantMsg(null);
      const result = await grantTenantCredits({
        orgId,
        displayedAmount,
        reason: grantReason,
        idempotencyKey: `admin-tenant-grant:${crypto.randomUUID()}`,
      });
      setGrantBusy(false);
      if ("error" in result) {
        setGrantMsg({ ok: false, text: result.error });
        return;
      }
      setGrantMsg({ ok: true, text: `Applied ${displayedAmount > 0 ? "+" : ""}${displayedAmount} credits.` });
      setGrantAmount("");
      setGrantReason("");
      router.refresh();
    } finally {
      grantBusyRef.current = false;
    }
  }

  async function submitRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (refundBusyRef.current) return;
    refundBusyRef.current = true;
    try {
      const displayedAmount = Number(refundAmount);
      if (!Number.isInteger(displayedAmount) || displayedAmount <= 0) {
        setRefundMsg({ ok: false, text: "Enter a whole number of credits to refund." });
        return;
      }
      if (!confirm(`Refund ${displayedAmount} credits to ${ownerEmail || orgId} and take the credits back? This moves real money.`)) return;
      setRefundBusy(true);
      setRefundMsg(null);
      const result = await refundCreditsAction({
        orgId,
        displayedAmount,
        paymentIntentId: refundPi.trim(),
        packCredits: Number(refundPack),
        refundId: refundTicket,
        allowPartial: refundPartial,
        reason: refundReason,
      });
      setRefundBusy(false);
      if ("error" in result) {
        // 单号**不换**:失败的下一步通常是「用同一个号再跑一次」(Stripe 那一步幂等),
        // 换号会把这层保护关掉。
        setRefundMsg({ ok: false, text: result.error });
        return;
      }
      if (result.status === "pending") {
        // Stripe 受理了但还没到终态:credits 仍然锁着,**单号不换** —— 收口要用同一个号。
        setRefundMsg({
          ok: true,
          text: `Stripe accepted ${result.refundId} but has not settled it yet. The credits stay held. Do NOT start another refund — press "Finish pending refund" once Stripe reports succeeded.`,
        });
        router.refresh();
        return;
      }
      setRefundMsg({
        ok: true,
        text: `Refunded ${result.displayedAmount} credits (RM${(result.amountMinor / 100).toFixed(2)}, ${result.refundId})${result.status === "already-settled" ? " — already done earlier, nothing moved twice" : ""}. Log it in docs/ops/manual-money-ledger.md.`,
      });
      setRefundAmount("");
      setRefundPi("");
      setRefundReason("");
      setRefundPartial(false);
      setRefundTicket(crypto.randomUUID()); // 这一单结清了,下一单换新号
      router.refresh();
    } finally {
      refundBusyRef.current = false;
      setRefundBusy(false);
    }
  }

  /** 收口一张受理中的退款单:去 Stripe 重读状态,succeeded 才落账。不会发起第二笔退款。 */
  async function finishPendingRefund() {
    if (refundBusyRef.current) return;
    refundBusyRef.current = true;
    setRefundBusy(true);
    try {
      const result = await completeManualRefund({ orgId, refundId: refundTicket });
      if ("error" in result) {
        setRefundMsg({ ok: false, text: result.error });
        return;
      }
      if (result.status === "pending") {
        setRefundMsg({ ok: true, text: `Stripe still reports ${result.refundId} as not settled. The credits stay held — try again later.` });
        return;
      }
      setRefundMsg({
        ok: true,
        text: `Settled ${result.displayedAmount} credits (RM${(result.amountMinor / 100).toFixed(2)}, ${result.refundId}). Log it in docs/ops/manual-money-ledger.md.`,
      });
      setRefundAmount("");
      setRefundPi("");
      setRefundReason("");
      setRefundPartial(false);
      setRefundTicket(crypto.randomUUID());
      router.refresh();
    } finally {
      refundBusyRef.current = false;
      setRefundBusy(false);
    }
  }

  async function toggleStatus() {
    const isSuspended = status === "suspended";
    const nextStatus = isSuspended ? "active" : "suspended";
    if (!isSuspended && !confirm("Suspend this tenant? They will be locked out immediately.")) return;
    setStatusBusy(true);
    setStatusMsg(null);
    const result = await setMembershipStatus(orgId, nextStatus);
    setStatusBusy(false);
    if ("error" in result) {
      setStatusMsg({ ok: false, text: result.error });
      return;
    }
    setStatusMsg({ ok: true, text: `Status set to ${nextStatus}.` });
    router.refresh();
  }

  async function cutSessions() {
    if (!confirm("Sign this merchant out now? All active sessions will be deleted.")) return;
    setCutBusy(true);
    setCutMsg(null);
    const result = await cutTenantSessions(orgId);
    setCutBusy(false);
    if ("error" in result) {
      setCutMsg({ ok: false, text: result.error });
      return;
    }
    setCutMsg({ ok: true, text: `Signed out ${result.cut} session${result.cut === 1 ? "" : "s"}.` });
    router.refresh();
  }

  async function startImpersonating() {
    if (!canImpersonate || impersonateBusy) return;
    setImpersonateBusy(true);
    setImpersonateMsg(null);
    const result = await impersonateTenant(orgId, impersonateReason);
    setImpersonateBusy(false);
    if ("error" in result) {
      setImpersonateMsg({ ok: false, text: result.error });
      return;
    }
    router.push("/");
  }

  return (
    <div className="mx-auto grid w-full max-w-[1180px] gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 w-fit">
            <Link href="/admin/tenants"><ArrowLeft className="size-4" />Tenants</Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Tenant detail</p>
            <Badge variant={statusVariant(status)}>{status}</Badge>
          </div>
          <h1 className="mt-1 truncate text-[28px] font-semibold leading-tight text-foreground md:text-[32px]">{ownerEmail || name || orgId}</h1>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{orgId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/admin/cases?tenant=${encodeURIComponent(orgId)}`}><Eye className="size-4" />Cases</Link>
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setImpersonateOpen(true)}>
            <UserRoundSearch className="size-4" />Impersonate
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Balance" value={balance.toLocaleString()} detail="Displayed credits" tone={balance < 500 ? "warning" : "neutral"} />
        <Metric label="Reserved" value={reserved.toLocaleString()} detail="In-flight hold" tone={reserved > 0 ? "warning" : "neutral"} />
        <Metric label="True cost" value={fmtUsd(spentUsd)} detail="Frozen USD spend" />
        <Metric label="Projects" value={String(projectCount)} />
        <Metric label="Generations" value={String(genCount)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel title="Credit action" subtitle="Grant or adjust displayed credits. Existing ledger action and idempotency stay unchanged.">
          <form onSubmit={submitGrant} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Credits</span>
                <Input type="number" step="1" inputMode="numeric" value={grantAmount} onChange={(event) => setGrantAmount(event.target.value)} placeholder="500" required className="h-10 text-sm" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Reason</span>
                <Input value={grantReason} onChange={(event) => setGrantReason(event.target.value)} maxLength={500} placeholder="support correction or beta top-up" className="h-10 text-sm" />
              </label>
              <Button type="submit" disabled={grantBusy || grantOverLimit}>{grantBusy ? "Applying" : "Apply"}</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={grantOverLimit ? "warning" : "outline"}>{grantOverLimit ? "Over finance limit" : "Within finance limit"}</Badge>
              {/* MONEY-A14:真正会拒绝你的是**累计**,不是单笔 —— 所以累计就摆在按钮旁边。 */}
              <Badge variant={adjustRolling30dDisplay > adjustRolling30dLimitDisplay ? "destructive" : "outline"}>
                {adjustRolling30dDisplay.toLocaleString()} / {adjustRolling30dLimitDisplay.toLocaleString()} manual credits in 30 days
              </Badge>
              <span>Negative values deduct credits if the account can stay non-negative.</span>
              {grantMsg ? <span className={grantMsg.ok ? "text-success" : "text-destructive"}>{grantMsg.text}</span> : null}
            </div>
          </form>
        </Panel>

        <Panel title="Access controls" subtitle="Lifecycle controls stay super-admin-only via existing tenant actions.">
          <div className="grid gap-3 md:grid-cols-3">
            <button type="button" onClick={toggleStatus} disabled={statusBusy} className="rounded-xl border border-border bg-background p-4 text-left transition-colors hover:bg-secondary disabled:opacity-50">
              <ShieldAlert className="size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold text-foreground">{status === "suspended" ? "Resume tenant" : "Suspend tenant"}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Flip membership status and mirror the Better Auth ban state.</p>
            </button>
            <button type="button" onClick={cutSessions} disabled={cutBusy} className="rounded-xl border border-border bg-background p-4 text-left transition-colors hover:bg-secondary disabled:opacity-50">
              <DoorOpen className="size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold text-foreground">Cut sessions</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Delete active Better Auth sessions for this tenant.</p>
            </button>
            <button type="button" onClick={() => setImpersonateOpen(true)} disabled={impersonateBusy} className="rounded-xl border border-border bg-background p-4 text-left transition-colors hover:bg-secondary disabled:opacity-50">
              <UserRoundSearch className="size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold text-foreground">Impersonate</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Requires a reason before starting the audited session.</p>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {statusMsg ? <span className={statusMsg.ok ? "text-success" : "text-destructive"}>{statusMsg.text}</span> : null}
            {cutMsg ? <span className={cutMsg.ok ? "text-success" : "text-destructive"}>{cutMsg.text}</span> : null}
            {impersonateMsg ? <span className={impersonateMsg.ok ? "text-success" : "text-destructive"}>{impersonateMsg.text}</span> : null}
          </div>
        </Panel>
      </div>

      <Panel
        title="Manual refund"
        subtitle="Locks the credits first, then refunds the card, then settles the ledger with the Stripe refund id. Log every refund in docs/ops/manual-money-ledger.md."
      >
        <form onSubmit={submitRefund} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[120px_1fr_1fr_auto] sm:items-end">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Credits</span>
              <Input type="number" step="1" min="1" inputMode="numeric" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} placeholder="100" required className="h-10 text-sm" />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Original payment (pi_…)</span>
              <Input value={refundPi} onChange={(event) => setRefundPi(event.target.value)} placeholder="pi_3Q…" required className="h-10 font-mono text-sm" />
            </label>
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Pack they bought</span>
              {/* 走 @/components/ui 的对位组件,不是裸原生下拉(#840 围栏:调用点一律走包装层)。 */}
              <Select value={refundPack} onValueChange={setRefundPack}>
                <SelectTrigger className="h-10 bg-background text-sm" aria-label="Pack they bought">
                  <span>{creditPacks.find((pack) => String(pack.credits) === refundPack)?.name ?? "Pick a pack"}</span>
                </SelectTrigger>
                <SelectContent>
                  {creditPacks.map((pack) => (
                    <SelectItem key={pack.credits} value={String(pack.credits)}>
                      {pack.name} · RM{(pack.amountMinor / 100).toFixed(0)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" variant="secondary" disabled={refundBusy}>{refundBusy ? "Refunding" : "Refund"}</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Reason</span>
              <Input value={refundReason} onChange={(event) => setRefundReason(event.target.value)} maxLength={500} placeholder="unused credits, merchant asked on 2026-09-02" className="h-10 text-sm" />
            </label>
            <label htmlFor="refund-partial" className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
              <Checkbox id="refund-partial" checked={refundPartial} onCheckedChange={(next) => setRefundPartial(next === true)} />
              Refund what the balance can cover
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">Refund id {refundTicket.slice(0, 8)}</Badge>
            <Button type="button" variant="ghost" size="sm" disabled={refundBusy} onClick={finishPendingRefund}>
              Finish pending refund
            </Button>
            <span>Ringgit is worked out from that pack&apos;s real price per credit. A retry must reuse this refund id — it is what stops a second refund.</span>
            {refundMsg ? <span className={refundMsg.ok ? "text-success" : "text-destructive"}>{refundMsg.text}</span> : null}
          </div>
        </form>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Credit activity" subtitle="Recent append-only ledger rows.">
          <div className="grid gap-2">
            {ledger.length === 0 ? <EmptyTenantState label="No ledger entries yet." /> : null}
            {ledger.map((row) => (
              <div key={row.id} className="grid gap-2 rounded-xl border border-border bg-background p-3 sm:grid-cols-[112px_88px_1fr] sm:items-center">
                <span className="font-mono text-xs text-muted-foreground">{fmtDate(row.createdAt)}</span>
                <span className={cn("text-sm font-semibold", row.displayedDelta < 0 ? "text-destructive" : "text-foreground")}>{row.displayedDelta > 0 ? "+" : ""}{row.displayedDelta.toLocaleString()}</span>
                <span className="truncate text-xs text-muted-foreground">{row.reason || row.kind}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent audit" subtitle="Metadata only; raw payloads are not shown in this table.">
          <div className="grid gap-2">
            {audit.length === 0 ? <EmptyTenantState label="No audit events yet." /> : null}
            {audit.map((row) => (
              <div key={row.id} className="grid gap-2 rounded-xl border border-border bg-background p-3 sm:grid-cols-[112px_1fr] sm:items-center">
                <span className="font-mono text-xs text-muted-foreground">{fmtDate(row.createdAt)}</span>
                <span className="truncate text-sm font-medium text-foreground">{row.type}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Dialog open={impersonateOpen} onOpenChange={setImpersonateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Impersonate tenant</DialogTitle>
            <DialogDescription>
              Enter an operational reason before starting an impersonation session. Spend remains blocked while impersonating.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-border bg-secondary p-3">
            <div className="flex items-center gap-2">
              <BadgeDollarSign className="size-4 text-muted-foreground" />
              <span className="truncate text-sm font-semibold text-foreground">{ownerEmail || orgId}</span>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{orgId}</p>
          </div>
          <label className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Reason</span>
            <Textarea value={impersonateReason} onChange={(event) => setImpersonateReason(event.target.value)} placeholder="Example: Debug merchant-reported billing mismatch." />
          </label>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setImpersonateOpen(false)}>Cancel</Button>
            <Button type="button" disabled={!canImpersonate || impersonateBusy} onClick={startImpersonating}>
              {impersonateBusy ? "Starting" : "Start impersonation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyTenantState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
