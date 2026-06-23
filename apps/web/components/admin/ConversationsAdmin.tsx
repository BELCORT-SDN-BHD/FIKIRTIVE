/**
 * Admin "Otto conversations" viewer (section: content). READ-ONLY transcript reader
 * so the founder can debug what users said to Otto + what Otto proposed/produced,
 * without waiting for user feedback. Server-rendered (no client interactivity).
 * NEVER renders a storage URL — only safe metadata shaped by conversation-admin.ts.
 */
import Link from "next/link";
import type { ConversationRow, ConversationDetail, ConversationMessage } from "@/lib/conversation-admin";

const card = { border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)", padding: 16 } as const;

function timeShort(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

export function ConversationsAdmin({ rows }: { rows: ConversationRow[] }) {
  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>Otto conversations</h1>
        <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0 }}>
          Read-only. The {rows.length === 1 ? "most recent thread" : `${rows.length} most recent threads`} across all
          tenants (newest first). Open one to read the full transcript — what the user asked, what Otto proposed, and
          what was generated. No image previews (cross-tenant files are owner-gated); models, prompts, and costs only.
        </p>
      </header>

      <section style={{ ...card, padding: 0, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0, padding: 16 }}>No conversations yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", font: "var(--text-body)" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--fg-3)", font: "var(--text-caption)" }}>
                <th style={{ padding: "10px 16px" }}>Owner</th>
                <th style={{ padding: "10px 16px" }}>Project</th>
                <th style={{ padding: "10px 16px" }}>Thread</th>
                <th style={{ padding: "10px 16px", textAlign: "right" }}>Msgs</th>
                <th style={{ padding: "10px 16px" }}>Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.threadId} style={{ borderTop: "1px solid var(--line-2)" }}>
                  <td style={{ padding: "10px 16px", color: "var(--fg-2)" }}>{r.ownerEmail}</td>
                  <td style={{ padding: "10px 16px", color: "var(--fg-3)" }}>{r.projectName}</td>
                  <td style={{ padding: "10px 16px" }}>
                    <Link href={`/admin/conversations/${r.threadId}`} style={{ color: "var(--fg-1)", textDecoration: "underline" }}>
                      {r.title || "(untitled)"}
                    </Link>
                  </td>
                  <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--fg-3)", font: "var(--text-mono-meta)" }}>{r.messageCount}</td>
                  <td style={{ padding: "10px 16px", color: "var(--fg-3)", font: "var(--text-mono-meta)" }}>{timeShort(r.lastActiveAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function Bubble({ m }: { m: ConversationMessage }) {
  const isUser = m.role === "USER";
  const who = isUser ? "User" : "Otto";
  const accent = isUser ? "var(--fg-2)" : "#3fb950";
  return (
    <div style={{ display: "grid", gap: 6, padding: "12px 0", borderTop: "1px solid var(--line-2)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <span style={{ font: "var(--text-caption)", color: accent, fontWeight: 600 }}>{who}</span>
        <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>#{m.seq} · {m.kind} · {timeShort(m.createdAt)}</span>
      </div>

      {m.text ? <p style={{ font: "var(--text-body)", color: "var(--fg-1)", margin: 0, whiteSpace: "pre-wrap" }}>{m.text}</p> : null}

      {m.planSteps && m.planSteps.length > 0 ? (
        <ol style={{ margin: "2px 0 0", paddingLeft: 18, font: "var(--text-caption)", color: "var(--fg-3)" }}>
          {m.planSteps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      ) : null}

      {m.card ? (
        <div style={{ ...card, padding: 12, display: "grid", gap: 4, background: "var(--bg-2)" }}>
          <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>
            Proposed: <b style={{ color: "var(--fg-2)" }}>{m.card.model || "—"}</b> ({m.card.kind || "—"})
            {m.card.estimatedPriceUsd != null ? ` · est ~$${m.card.estimatedPriceUsd.toFixed(3)}` : ""}
          </span>
          {m.card.prompt ? <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", whiteSpace: "pre-wrap" }}>{m.card.prompt}</span> : null}
        </div>
      ) : null}

      {m.result ? (
        <div style={{ ...card, padding: 12, display: "grid", gap: 4, background: "var(--bg-2)" }}>
          <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>
            Generated: <b style={{ color: "var(--fg-2)" }}>{m.result.model || "—"}</b> ({m.result.kind || "—"})
            {m.result.status ? ` · ${m.result.status}` : ""}
            {m.result.spentUsd != null ? ` · $${m.result.spentUsd.toFixed(4)}` : ""}
          </span>
          {m.result.genJobId ? <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>job {m.result.genJobId}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ConversationView({ detail }: { detail: ConversationDetail }) {
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 16 }}>
      <div>
        <Link href="/admin/conversations" style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>← All conversations</Link>
      </div>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>{detail.title || "(untitled)"}</h1>
        <p style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", margin: 0 }}>
          {detail.ownerEmail} · {detail.projectName} · started {timeShort(detail.createdAt)} · {detail.messages.length} messages
        </p>
      </header>
      <section style={{ ...card }}>
        {detail.messages.length === 0 ? (
          <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0 }}>This thread has no messages.</p>
        ) : (
          detail.messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
      </section>
    </main>
  );
}
