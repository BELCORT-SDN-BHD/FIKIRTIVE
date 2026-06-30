"use client";
/**
 * OPT-6 P3a cost view (section ②). READ-ONLY: sums the record-only spentUsd
 * ledger (GenJob + RefGenJob) into per-day totals + a recent-job table. It
 * cannot widen spend — it renders the frozen snapshots the worker wrote.
 * Mirrors ModelsAdmin's inline-style card pattern.
 */
export type DayRow = { day: string; usd: number; jobs: number };
export type JobRow = {
  id: string; source: "gen" | "refgen"; label: string; model: string;
  count: number; status: string; spentUsd: number; finishedAt: string;
};

const usd = (n: number) => `$${n.toFixed(2)}`;

export function CostAdmin({ days, jobs, totalUsd, jobCount, sinceDays }: { days: DayRow[]; jobs: JobRow[]; totalUsd: number; jobCount: number; sinceDays: number }) {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--foreground)", margin: 0 }}>Cost &amp; usage</h1>
        <p style={{ font: "var(--text-body)", color: "var(--muted-foreground)", margin: 0 }}>
          Media spend over the last {sinceDays} days, from the per-job spend ledger the worker freezes when a paid call commits. Read-only — this view records cost, it never authorizes it.
        </p>
      </header>

      <section style={{ display: "flex", gap: 24, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)" }}>TOTAL</span>
          <span style={{ font: "var(--text-display)", color: "var(--foreground)" }}>{usd(totalUsd)}</span>
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)" }}>PAID JOBS</span>
          <span style={{ font: "var(--text-display)", color: "var(--foreground)" }}>{jobCount}</span>
        </div>
      </section>

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--foreground)", margin: 0 }}>Per day</h2>
        {days.length === 0 && <p style={{ font: "var(--text-caption)", color: "var(--muted-foreground)", margin: 0 }}>No spend recorded in this window.</p>}
        {days.map((d) => (
          <div key={d.day} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
            <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)", minWidth: 110 }}>{d.day}</span>
            <span style={{ font: "var(--text-body)", color: "var(--foreground)", minWidth: 80 }}>{usd(d.usd)}</span>
            <span style={{ font: "var(--text-caption)", color: "var(--muted-foreground)" }}>{d.jobs} job{d.jobs === 1 ? "" : "s"}</span>
          </div>
        ))}
      </section>

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--foreground)", margin: 0 }}>Recent jobs</h2>
        {jobs.map((j) => (
          <div key={`${j.source}:${j.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
            <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)", minWidth: 90 }}>{j.label}</span>
            <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)", minWidth: 110 }}>{j.model}</span>
            <span style={{ font: "var(--text-caption)", color: j.status === "FAILED" ? "#e5484d" : "var(--muted-foreground)", minWidth: 80 }}>{j.status}</span>
            <span style={{ font: "var(--text-body)", color: "var(--foreground)", minWidth: 70 }}>{usd(j.spentUsd)}</span>
            <span style={{ font: "var(--text-caption)", color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)", marginLeft: "auto" }}>{j.finishedAt.slice(0, 16).replace("T", " ")}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
