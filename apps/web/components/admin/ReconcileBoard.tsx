"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { closeReconcileObservation, type ReconcileObservationRow } from "@/lib/reconcile-actions";

/**
 * MONEY-A12 —— 未了结缺口清单 + 关闭表单。
 *
 * 关闭一条 = 让哨兵**永远不再**为这笔付款报警,而那笔付款可能是一个商家真的付了钱却没收到
 * credits。所以表单不收「一句话说明」了事:三种处置各自要一个**可核**的东西 —— 退款单号、
 * 账本那一行的键(服务端当场查)、或者写清楚并再确认一次。判定全在服务端
 * (`lib/reconcile-actions.ts`),这里只是把它说成人话。
 */

function money(amountMinor: number | null, currency: string | null): string {
  if (amountMinor === null) return "unknown amount";
  return `${(currency ?? "").toUpperCase() || "?"} ${(amountMinor / 100).toFixed(2)}`;
}

function ago(iso: string | null): string {
  if (!iso) return "unknown";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "under an hour ago";
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type Disposition = "refunded_in_stripe" | "credited_manually" | "other";

/** 同一时刻只挂一个(`openFor` 是单个 sessionId)—— 静态 id 因此不会撞,
 *  也才能被 #739 那道「每个控件都有可读名字」的闸按文本对上 htmlFor。 */
function CloseForm({ row, onDone }: { row: ReconcileObservationRow; onDone: () => void }) {
  const [disposition, setDisposition] = useState<Disposition | "">("");
  const [refundId, setRefundId] = useState("");
  const [ledgerRef, setLedgerRef] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError("");
    startTransition(async () => {
      const res = await closeReconcileObservation({ sessionId: row.sessionId, disposition, refundId, ledgerRef, note, confirmed });
      if ("error" in res) setError(res.error);
      else onDone();
    });
  };

  return (
    <div className="grid gap-3 border-t border-border pt-3">
      <div className="grid gap-2">
        <span className="text-xs font-medium text-muted-foreground">How was this payment settled?</span>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["refunded_in_stripe", "Refunded in Stripe"],
              ["credited_manually", "Credits granted by hand"],
              ["other", "Something else"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={disposition === value ? "default" : "outline"}
              onClick={() => setDisposition(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {disposition === "refunded_in_stripe" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="reconcile-refund-id">Stripe refund id</Label>
          <Input
            id="reconcile-refund-id"
            value={refundId}
            onChange={(e) => setRefundId(e.target.value)}
            placeholder="re_…"
            autoComplete="off"
          />
        </div>
      ) : null}

      {disposition === "credited_manually" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="reconcile-ledger-ref">Credits-ledger refId or idempotency key</Label>
          <Input
            id="reconcile-ledger-ref"
            value={ledgerRef}
            onChange={(e) => setLedgerRef(e.target.value)}
            placeholder="grant:…"
            autoComplete="off"
          />
          <span className="text-xs text-muted-foreground">
            Checked before this closes: the row must belong to this merchant, be a GRANT or ADJUST, and match this payment&rsquo;s credits.
          </span>
        </div>
      ) : null}

      {disposition ? (
        <div className="grid gap-1.5">
          <Label htmlFor="reconcile-note">
            Note{disposition === "other" ? " (required, 20+ characters)" : " (optional)"}
          </Label>
          <Textarea id="reconcile-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>
      ) : null}

      {disposition === "other" ? (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
          <span className="text-muted-foreground">
            I understand this stops every further alert for a payment the merchant may never have received.
          </span>
        </label>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div>
        <Button type="button" size="sm" disabled={!disposition || pending} onClick={submit}>
          {pending ? "Closing…" : "Close this gap"}
        </Button>
      </div>
    </div>
  );
}

export function ReconcileBoard({ result }: { result: { rows: ReconcileObservationRow[] } | { error: string } }) {
  const router = useRouter();
  const [openFor, setOpenFor] = useState<string | null>(null);

  if ("error" in result) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">Payment reconciliation</h1>
        <p className="mt-2 text-sm text-muted-foreground">{result.error}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-6">
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold">Payment reconciliation</h1>
        <p className="text-sm text-muted-foreground">
          Stripe says these were paid. Most of them are confirmed gaps — the credits ledger has no entry. Rows marked{" "}
          <em>not yet confirmed</em>{" "}are different: the sweeper could not read the ledger when it first saw them, so nobody has
          checked yet whether they are gaps at all; they are tracked so they cannot slip out of the 48h window unnoticed, and the
          next readable sweep decides. The sweeper re-checks every 30 minutes and alerts once a day until each one is settled. It
          closes a gap by itself the moment the ledger row appears — replaying the Checkout Session&rsquo;s webhook event in
          Stripe is the correct fix. Close one here only when the payment was settled some other way.
        </p>
      </div>

      {result.rows.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-card p-6 text-sm text-muted-foreground shadow-xs">
          Nothing open. Every paid Stripe session in the last sweep has its ledger entry.
        </div>
      ) : (
        result.rows.map((row) => (
          <div key={row.sessionId} className="grid gap-3 rounded-[14px] border border-border bg-card p-4 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="font-medium">{money(row.amountTotal, row.currency)}</span>
                <span className="text-xs text-muted-foreground">
                  session {row.sessionId} · org {row.orgId ?? "unresolved"}
                </span>
                <span className="text-xs text-muted-foreground">
                  first seen {ago(row.firstSeenAt)} · last alert {row.lastAlertedAt ? ago(row.lastAlertedAt) : "not yet"}
                </span>
                {row.ledgerVerified ? (
                  <span className="text-xs text-muted-foreground">The credits ledger has no entry for this payment.</span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Ledger unreadable at first sighting — not yet confirmed as a gap. The next readable sweep decides.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={!row.ledgerVerified ? "outline" : row.lastAlertedAt ? "destructive" : "outline"}>
                  {!row.ledgerVerified ? "Not yet confirmed" : row.lastAlertedAt ? "Alerting" : "Watching"}
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setOpenFor(openFor === row.sessionId ? null : row.sessionId)}
                >
                  {openFor === row.sessionId ? "Cancel" : "Close…"}
                </Button>
              </div>
            </div>
            {openFor === row.sessionId ? (
              <CloseForm
                row={row}
                onDone={() => {
                  setOpenFor(null);
                  router.refresh();
                }}
              />
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
