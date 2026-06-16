"use client";
import { useRef, useState } from "react";
import { coworkTurn, coworkRenameThread, coworkDeleteThread } from "@/lib/cowork-actions";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { MentionInput } from "@/components/MentionInput";
import { IcPlus } from "@/components/ds";
import { GenerateCard } from "./GenerateCard";
import type { EntityDTO, ChatThreadDTO } from "@/lib/types";

const isVideoUrl = (u: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(u); // mirrors GenSpace

export function Cowork({ projectId, entities, threads }: {
  projectId: string;
  entities: EntityDTO[];
  threads: ChatThreadDTO[];
}) {
  // chatbox sessions: the full thread list (newest-first, with messages) is the
  // client source of truth — switching is pure local state, no per-switch fetch.
  const [list, setList] = useState<ChatThreadDTO[]>(threads);
  const [activeId, setActiveId] = useState<string | null>(threads[0]?.id ?? null);
  const active = list.find((t) => t.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  const [text, setText] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [variantSel, setVariantSel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // synchronous double-submit guard (GenSpace pattern)
  const [composerKey, setComposerKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // inline rename state for the rail
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  async function send() {
    if (!text.trim() || busy || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await coworkTurn({ threadId: active?.id, projectId, text, entityIds: ids, variantSel });
      if ("error" in res) { setError(res.error); return; }
      const fresh = await getCoworkThreadClient(res.threadId);
      if (fresh) {
        setList((cur) => [fresh, ...cur.filter((t) => t.id !== fresh.id)]);
        setActiveId(fresh.id);
      }
      setText("");
      setIds([]);
      setVariantSel({});
      setComposerKey((k) => k + 1);
    } catch {
      setError("Couldn't reach cowork — please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function newChat() {
    setActiveId(null);
    setText("");
    setIds([]);
    setVariantSel({});
    setComposerKey((k) => k + 1);
    setError(null);
  }

  function selectThread(id: string) {
    if (renamingId) return; // don't switch out from under an open rename input
    setActiveId(id);
    setError(null);
  }

  function startRename(id: string, title: string) {
    setRenamingId(id);
    setRenameText(title);
  }

  async function commitRename(id: string) {
    const t = renameText.trim();
    setRenamingId(null);
    if (!t) return;
    const prev = list.find((x) => x.id === id)?.title;
    if (t === prev) return;
    setList((cur) => cur.map((x) => (x.id === id ? { ...x, title: t } : x)));
    const res = await coworkRenameThread({ threadId: id, title: t });
    if ("error" in res) setError(res.error);
  }

  async function deleteThread(id: string) {
    if (!window.confirm("Delete this conversation?")) return;
    const res = await coworkDeleteThread({ threadId: id });
    if ("error" in res) { setError(res.error); return; }
    setList((cur) => cur.filter((x) => x.id !== id));
    if (activeId === id) setActiveId(list.find((x) => x.id !== id)?.id ?? null);
  }

  return (
    <div className="cw-shell">
      <aside className="cw-rail">
        <button className="cw-rail-new" onClick={newChat}>
          <IcPlus size={15} /> New chat
        </button>
        <div className="cw-rail-list">
          {list.map((t) => (
            <div
              key={t.id}
              className={`cw-rail-item${t.id === activeId ? " cw-rail-item-active" : ""}`}
              onClick={() => selectThread(t.id)}
            >
              {renamingId === t.id ? (
                <input
                  className="cw-rail-rename"
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => commitRename(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitRename(t.id); }
                    if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
                  }}
                />
              ) : (
                <>
                  <span
                    className="cw-rail-title"
                    onDoubleClick={(e) => { e.stopPropagation(); startRename(t.id, t.title); }}
                    title={t.title}
                  >
                    {t.title}
                  </span>
                  <span className="cw-rail-actions">
                    <button
                      className="al-iconbtn al-iconbtn-sm"
                      aria-label="Rename conversation"
                      title="Rename"
                      onClick={(e) => { e.stopPropagation(); startRename(t.id, t.title); }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    <button
                      className="al-iconbtn al-iconbtn-sm"
                      aria-label="Delete conversation"
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                    </button>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </aside>

      <div className="cw-main">
        <div className="screen">
          <div className="screen-pad">
            <h1 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: "10px 0 18px" }}>Cowork</h1>

            {messages.length === 0 && !busy && (
              <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: "8px 0" }}>
                Describe what you&apos;d like to create and hit Send.
              </p>
            )}

            {messages.map((m) => {
              if (m.kind === "TEXT") {
                return (
                  <div key={m.id} className={m.role === "USER" ? "cw-msg cw-user" : "cw-msg cw-agent"}>
                    {m.text}
                  </div>
                );
              }
              if (m.kind === "PLAN") {
                const steps = (m.payload as { planSteps?: string[] } | null)?.planSteps ?? [];
                if (!steps.length) return null;
                return (
                  <ul key={m.id} className="cw-plan">
                    {steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                );
              }
              if (m.kind === "GEN_CARD") {
                return (
                  <GenerateCard
                    key={m.id}
                    cardId={m.id}
                    payload={m.payload}
                    entities={entities}
                    alreadyGenerated={!!m.genJobId}
                  />
                );
              }
              if (m.kind === "GEN_RESULT") {
                const r = m.payload as { urls?: string[] } | null;
                return (
                  <div key={m.id} className="cw-result">
                    {(r?.urls ?? []).map((u, i) => (
                      isVideoUrl(u) ? (
                        <video key={i} src={u} muted loop autoPlay playsInline />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={u} alt="" />
                      )
                    ))}
                  </div>
                );
              }
              if (m.kind === "DENIAL" || m.kind === "TURN_ERROR") {
                return <div key={m.id} className="cw-msg cw-error">{m.text}</div>;
              }
              return null;
            })}

            {error && <div className="cw-msg cw-error">{error}</div>}
          </div>
        </div>

        <div className="composer-dock">
          <div className="al-promptbar" style={{ maxWidth: 880, width: "100%" }}>
            <div className="al-input-wrap" style={{ border: "none", background: "none", padding: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <MentionInput
                  entities={entities}
                  docKey={String(composerKey)}
                  placeholder="Describe what you want to create…"
                  disabled={busy}
                  onChange={(t, i, vs) => { setText(t); setIds(i); setVariantSel(vs); }}
                  onSubmit={send}
                />
              </div>
            </div>
            <div className="al-promptbar-row">
              <span className="al-promptbar-spacer" />
              <button
                className="al-btn al-btn-md al-btn-primary"
                disabled={busy || !text.trim()}
                onClick={send}
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
