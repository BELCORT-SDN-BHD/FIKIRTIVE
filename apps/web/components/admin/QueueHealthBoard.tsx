import { Badge } from "@/components/ui/badge";
import type { MetricTone, QueueMetricRow, QueueObservabilityBoard } from "@/lib/queue-observability";

/**
 * #779 — the minimal board. One headline that answers "is the generation queue backed up?",
 * then the ten readings it was decided from.
 *
 * A server component with no state: everything it shows was already decided in
 * `queue-observability.ts`, so there is nothing to hold and nothing to hydrate. Refresh is the
 * browser's reload — the page is `force-dynamic`.
 */

const CONNECTION_LABEL: Record<QueueObservabilityBoard["connection"], string> = {
  connected: "Reading live",
  notConfigured: "Not connected",
  unavailable: "Cannot read",
};

const CONNECTION_TONE: Record<QueueObservabilityBoard["connection"], MetricTone> = {
  connected: "success",
  notConfigured: "neutral",
  unavailable: "warning",
};

const VERDICT_LABEL: Record<QueueObservabilityBoard["verdict"]["state"], string> = {
  clear: "Clear",
  building: "Building up",
  backedUp: "Backed up",
  unknown: "Unknown",
};

function toneBadge(tone: MetricTone) {
  if (tone === "success") return "success" as const;
  if (tone === "warning") return "warning" as const;
  if (tone === "danger") return "destructive" as const;
  if (tone === "info") return "info" as const;
  return "outline" as const;
}

/** "No samples" is a first-class value here, not a blank cell — see queue-observability.ts. */
function MetricTile({ row }: { row: QueueMetricRow }) {
  const missing = row.value === null;
  return (
    <div className="grid h-full gap-2 rounded-[14px] border border-border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
        {missing ? <Badge variant="outline">No samples</Badge> : null}
      </div>
      <span
        className={
          missing
            ? "text-3xl font-semibold leading-none text-muted-foreground"
            : "text-3xl font-semibold leading-none text-foreground"
        }
      >
        {row.value ?? "—"}
      </span>
      <p className="text-xs leading-5 text-muted-foreground">{row.detail}</p>
    </div>
  );
}

export function QueueHealthBoard({ board }: { board: QueueObservabilityBoard }) {
  return (
    <div className="mx-auto grid w-full max-w-[1280px] gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Generation queue</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-normal text-foreground md:text-[32px]">
            Queue health
          </h1>
          <p className="mt-1 max-w-[760px] text-sm leading-6 text-muted-foreground">
            Whether merchants are waiting, read from the generation metrics store. Application and
            worker health stay on their own monitoring — these two coexist.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden text-right text-xs text-muted-foreground sm:block">
            <span className="block">Last refreshed</span>
            <span className="font-mono">{board.generatedAt.slice(0, 16).replace("T", " ")}</span>
          </div>
          <Badge variant={toneBadge(CONNECTION_TONE[board.connection])}>{CONNECTION_LABEL[board.connection]}</Badge>
        </div>
      </header>

      <section className="min-w-0 rounded-2xl border border-border bg-card shadow-xs">
        <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{board.verdict.headline}</h2>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{board.verdict.detail}</p>
          </div>
          <Badge variant={toneBadge(board.verdict.tone)}>{VERDICT_LABEL[board.verdict.state]}</Badge>
        </div>
        <div className="min-w-0 p-4">
          <p className="text-xs leading-5 text-muted-foreground">{board.connectionDetail}</p>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {board.rows.map((row) => (
          <MetricTile key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}
