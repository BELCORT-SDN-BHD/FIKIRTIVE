"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminActionConfirmDialog } from "./AdminActionConfirmDialog";
import { discardDeadLetter } from "@/lib/dlq-actions";
import type { DeadLetterItem, DeadLetterListing, DiscardDeadLetterResult } from "@/lib/dead-letters-admin";

type DiscardedResult = Extract<DiscardDeadLetterResult, { ok: true }>;

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

/**
 * The money sentence, in three shapes — the state is the server's, this only spells it out.
 *
 * `null` means the payload named no generation job, so there is no ledger to read and no line to
 * print. `"unreadable"` means the read was attempted and failed; it gets its own sentence, because
 * printing nothing would read as "no money attached", and an operator could then discard a job
 * whose reservation is still held (judge P2-2). A real reading prints BOTH nets: credits charged
 * and credits still held are different facts, and a hold that was never released is exactly the
 * one an operator has to see before pressing the button (judge P2-3).
 */
function ledgerLine(item: DeadLetterItem): string | null {
  if (item.ledger === null) return null;
  if (item.ledger === "unreadable") {
    return "Ledger for this job could not be read, so this row says nothing about the money either way.";
  }
  const { charged, held, kinds, rows } = item.ledger;
  const entries = `${rows} ${rows === 1 ? "entry" : "entries"}`;
  const seen = kinds.length > 0 ? ` (${kinds.map((kind) => kind.toLowerCase()).join(", ")})` : "";
  return `Ledger for this job: charged ${charged} credits, ${held} still held${seen} across ${entries}.`;
}

/**
 * What the screen says once the server has answered. Three outcomes, three sentences — the middle
 * one exists because the cancel is irreversible: when the audit row cannot be written the job is
 * still gone, so reporting "the action could not finish" would send the operator back to a queue
 * that no longer holds it, and he would then read "already gone, nothing was recorded" over a
 * discard that really happened (judge P2-1). Say both halves instead, and name the next step.
 */
function discardedLine(item: DeadLetterItem, result: DiscardedResult): string {
  if (result.outcome === "discarded") {
    return `Discarded ${item.queue} job ${item.jobId}. Audit row ${result.auditEventId}.`;
  }
  if (result.outcome === "discarded-unaudited") {
    return (
      `Discarded ${item.queue} job ${item.jobId}, but the audit row could not be written. ` +
      `The job is gone — record this discard by hand and tell the team.`
    );
  }
  return `That job was already gone, so nothing was discarded and nothing was recorded.`;
}

function DeadLetterRow({ item, onDiscarded }: { item: DeadLetterItem; onDiscarded: (status: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const ledger = ledgerLine(item);

  async function discard(): Promise<string | null> {
    const result = await discardDeadLetter({ queue: item.queue, jobId: item.jobId });
    if ("error" in result) return result.error;
    onDiscarded(discardedLine(item, result));
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
          // 这句话必须在**每一条路**上都为真。审计行写不下去是一条真实的路（`lib/dlq-actions.ts`
          // 的 `discarded-unaudited`），所以承诺里带上它的出口，而不是先许一个可能兑现不了的诺。
          "One audit row records who discarded it, from which queue, and when. If that row cannot be written, the screen says so.",
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
