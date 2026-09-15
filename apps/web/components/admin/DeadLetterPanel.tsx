"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminActionConfirmDialog } from "./AdminActionConfirmDialog";
import { discardDeadLetter } from "@/lib/dlq-actions";
import type { DeadLetterItem, DeadLetterListing } from "@/lib/dead-letters-admin";

/**
 * Dead letters, and the one control that can clear one (Founder ruling 2026-09-15; registered in
 * docs/specs/fail-closed-reliability.md §5, DLQ-A1…A5).
 *
 * The board next to this one is observability only. A dead letter is the one queue state that
 * needs a hand: nothing consumes those queues by design, so a single stuck job holds the
 * `/api/ops/dlq` probe red forever and the only other way out is raw SQL against the database.
 *
 * Every judgement is the server's (`lib/dlq-actions.ts`): what may be discarded, who may discard
 * it, and what gets written down. This component only shows what is there and asks once.
 */

function fmtTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

function ledgerLine(item: DeadLetterItem): string | null {
  if (!item.ledger) return null;
  const { net, rows } = item.ledger;
  const settled = net === 0 ? "closed at zero" : `${net > 0 ? "+" : ""}${net} credits`;
  return `Ledger for this job: ${settled} across ${rows} ${rows === 1 ? "entry" : "entries"}.`;
}

function DeadLetterRow({ item, onDiscarded }: { item: DeadLetterItem; onDiscarded: (status: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const ledger = ledgerLine(item);

  async function discard(): Promise<string | null> {
    const result = await discardDeadLetter({ queue: item.queue, jobId: item.jobId });
    if ("error" in result) return result.error;
    onDiscarded(
      result.outcome === "discarded"
        ? `Discarded ${item.queue} job ${item.jobId}. Audit row ${result.auditEventId}.`
        : `That job was already gone, so nothing was discarded and nothing was recorded.`,
    );
    return null;
  }

  return (
    <div className="grid gap-2 rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="destructive">{item.queue}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{item.jobId}</span>
        </div>
        <Button type="button" variant="destructive" size="sm" onClick={() => setConfirming(true)}>
          Discard
        </Button>
      </div>

      <dl className="grid gap-1 text-xs leading-5 text-muted-foreground sm:grid-cols-[120px_1fr]">
        <dt className="font-medium">Dead-lettered</dt>
        <dd className="font-mono">{fmtTime(item.createdAt)}</dd>
        {item.identifiers.map((entry) => (
          <div key={entry.key} className="contents">
            <dt className="font-medium">{entry.key}</dt>
            <dd className="truncate font-mono">{entry.value}</dd>
          </div>
        ))}
        {item.withheldKeys.length > 0 ? (
          <div className="contents">
            <dt className="font-medium">Other fields</dt>
            <dd>{item.withheldKeys.join(", ")}</dd>
          </div>
        ) : null}
      </dl>

      {ledger ? <p className="text-xs leading-5 text-muted-foreground">{ledger}</p> : null}

      <AdminActionConfirmDialog
        open={confirming}
        onOpenChange={(open) => { if (!open) setConfirming(false); }}
        title="Discard this dead letter?"
        description={`${item.queue} job ${item.jobId} will stop counting against the dead-letter probe.`}
        impactTitle="This cannot be undone"
        impacts={[
          "The job is cancelled in the queue — it is never retried and never runs.",
          "Credits, ledger entries, and merchant data stay exactly as they are.",
          "One audit row records who discarded it, from which queue, and when.",
        ]}
        confirmLabel="Discard job"
        confirmingLabel="Discarding…"
        onConfirm={discard}
      />
    </div>
  );
}

export function DeadLetterPanel({ listing }: { listing: DeadLetterListing }) {
  const [discarded, setDiscarded] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);

  // "Cannot read" and "nothing there" are two different sentences — the same rule the probe
  // itself follows (packages/core/src/dead-letters.ts). Never draw an empty list for a failed read.
  if (!listing.readable) {
    return (
      <Panel>
        <p className="text-sm leading-6 text-muted-foreground">
          Dead letters cannot be read right now, so this list proves nothing either way. Check the
          database connection and reload.
        </p>
      </Panel>
    );
  }

  const remaining = listing.items.filter((item) => !discarded.has(item.jobId));

  return (
    <Panel>
      {status ? (
        <p className="rounded-xl border border-border bg-secondary px-3 py-2 text-xs leading-5 text-foreground" role="status">
          {status}
        </p>
      ) : null}

      {remaining.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          No dead letters. Every job the system gave up on has been dealt with.
        </p>
      ) : (
        <div className="grid gap-2">
          {remaining.map((item) => (
            <DeadLetterRow
              key={item.jobId}
              item={item}
              onDiscarded={(line) => {
                setDiscarded((previous) => new Set(previous).add(item.jobId));
                setStatus(line);
              }}
            />
          ))}
        </div>
      )}

      {listing.truncated ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Only the oldest 50 are listed. More are waiting — reload after clearing these.
        </p>
      ) : null}
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card shadow-xs">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Dead letters</h2>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          Jobs the system gave up on. Nothing retries them, so they stay here — and hold the
          dead-letter probe red — until someone discards them.
        </p>
      </div>
      <div className="grid min-w-0 gap-3 p-4">{children}</div>
    </section>
  );
}
