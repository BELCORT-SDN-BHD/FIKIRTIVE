"use client";
/**
 * OPT-6 P3b system & queue health (section ⑤). READ-ONLY: summarizes the app job
 * tables (GenJob/RefGenJob/RenderJob) — status counts, recent FAILED rows, and
 * today's frozen spend — so an operator can see "is anything stuck/failing". No
 * pg-boss internal coupling, no mutations. Mirrors CostAdmin's inline-style cards.
 */
export type StatusCounts = Record<string, number>;
export type FailedRow = {
  id: string; table: "gen" | "refgen" | "render"; kind: string; model: string; error: string; finishedAt: string;
};

const usd = (n: number) => `$${n.toFixed(2)}`;

function QueueCard({ title, counts, order }: { title: string; counts: StatusCounts; order: string[] }) {
  return (
    <div style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
      <h2 style={{ font: "var(--text-title)", color: "var(--foreground)", margin: 0 }}>{title}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
        {order.map((s) => (
          <div key={s} style={{ display: "grid", gap: 2 }}>
            <span style={{ font: "var(--text-mono-meta)", color: s === "FAILED" && (counts[s] ?? 0) > 0 ? "#e5484d" : "var(--muted-foreground)" }}>{s}</span>
            <span style={{ font: "var(--text-display)", color: "var(--foreground)" }}>{counts[s] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SystemAdmin({
  genCounts, refGenCounts, renderCounts, failed, activeCount, spendTodayUsd,
}: {
  genCounts: StatusCounts; refGenCounts: StatusCounts; renderCounts: StatusCounts;
  failed: FailedRow[]; activeCount: number; spendTodayUsd: number;
}) {
  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--foreground)", margin: 0 }}>System &amp; queue</h1>
        <p style={{ font: "var(--text-body)", color: "var(--muted-foreground)", margin: 0 }}>
          Health of the generation, reference, and render job tables — what&apos;s queued, in flight, done, or failing. Read-only — this view summarizes the app job tables, it never touches the queue.
        </p>
      </header>

      <section style={{ display: "flex", gap: 24, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)" }}>IN FLIGHT</span>
          <span style={{ font: "var(--text-display)", color: "var(--foreground)" }}>{activeCount}</span>
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)" }}>SPEND TODAY</span>
          <span style={{ font: "var(--text-display)", color: "var(--foreground)" }}>{usd(spendTodayUsd)}</span>
        </div>
      </section>

      <QueueCard title="Generation jobs" counts={genCounts} order={["QUEUED", "GENERATING", "DONE", "FAILED"]} />
      <QueueCard title="Reference jobs" counts={refGenCounts} order={["QUEUED", "GENERATING", "DONE", "FAILED"]} />
      <QueueCard title="Render jobs" counts={renderCounts} order={["QUEUED", "RENDERING", "DONE", "FAILED"]} />

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--foreground)", margin: 0 }}>Recent failures</h2>
        {failed.length === 0 && <p style={{ font: "var(--text-caption)", color: "var(--muted-foreground)", margin: 0 }}>No failed jobs.</p>}
        {failed.map((f) => (
          <div key={`${f.table}:${f.id}`} style={{ display: "grid", gap: 2, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)", minWidth: 70 }}>{f.table}</span>
              <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)", minWidth: 90 }}>{f.kind}</span>
              <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)", minWidth: 110 }}>{f.model}</span>
              <span style={{ font: "var(--text-caption)", color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)", marginLeft: "auto" }}>{f.finishedAt.slice(0, 19).replace("T", " ")}</span>
            </div>
            <code style={{ font: "var(--text-mono-meta)", color: "#e5484d", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{f.error || "(no error message)"}</code>
            <span style={{ font: "var(--text-mono-meta)", color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)" }}>{f.id}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
