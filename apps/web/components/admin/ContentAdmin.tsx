"use client";
/**
 * OPT-6 P4 content & moderation review (section ③). READ-ONLY / REVIEW-ONLY: lets a
 * moderator browse recently produced media (Generation → Asset, rendered like the
 * Library / getRecentGenResults) plus the existing gen.guardian-block moderation
 * signal. NO enforcement actions in this phase — no delete/flag mutations. The real
 * fal-safety enforcement gate is a separate deferred task. Mirrors AuditAdmin's
 * inline-style pattern; links across to the full audit log.
 */
import Link from "next/link";

export type GenRow = {
  id: string; project: string; prompt: string; modelRef: string;
  kind: "image" | "video"; src: string; createdAt: string;
};
export type BlockRow = { id: string; projectId: string | null; payload: string; createdAt: string };

export function ContentAdmin({ gens, blocks }: { gens: GenRow[]; blocks: BlockRow[] }) {
  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>Content review</h1>
        <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0 }}>
          Recently produced media for moderation review, plus the guardian-block signal. Review-only — no enforcement actions in this phase.
        </p>
        <nav style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <Link href="/admin/audit" style={{ font: "var(--text-mono-meta)", padding: "3px 8px", borderRadius: 6, background: "var(--bg-2)", color: "var(--fg-1)", textDecoration: "none" }}>Audit log →</Link>
        </nav>
      </header>

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Recent media</h2>
        {gens.length === 0 && <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>No media yet.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          {gens.map((g) => (
            <div key={g.id} style={{ display: "grid", gap: 4, padding: 8, border: "1px solid var(--line-2)", borderRadius: 10, background: "var(--bg-2)" }}>
              {g.kind === "video" ? (
                <video src={g.src} controls muted playsInline style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 6, background: "var(--bg-1)" }} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.src} alt={g.prompt.slice(0, 80)} loading="lazy" style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 6, background: "var(--bg-1)" }} />
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>{g.kind}</span>
                <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", marginLeft: "auto" }}>{g.createdAt.slice(0, 10)}</span>
              </div>
              <span style={{ font: "var(--text-caption)", color: "var(--fg-2)" }}>{g.project}</span>
              <span style={{ font: "var(--text-caption)", color: "var(--fg-3)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{g.prompt || "(no prompt)"}</span>
              {g.modelRef && <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-4)" }}>{g.modelRef}</span>}
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: "grid", gap: 6, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Guardian blocks</h2>
        <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>The existing moderation signal — generations the guardian refused. Review-only.</p>
        {blocks.length === 0 && <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>No blocks.</p>}
        {blocks.map((b) => (
          <div key={b.id} style={{ display: "grid", gap: 2, padding: "6px 0", borderBottom: "1px solid var(--line-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-1)" }}>gen.guardian-block</span>
              <span style={{ font: "var(--text-caption)", color: "var(--fg-4)", marginLeft: "auto" }}>{b.createdAt.slice(0, 19).replace("T", " ")}</span>
            </div>
            <code style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{b.payload}</code>
          </div>
        ))}
      </section>
    </main>
  );
}
