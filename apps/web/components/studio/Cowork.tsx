"use client";
import { useRef, useState } from "react";
import { coworkTurn } from "@/lib/cowork-actions";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { MentionInput } from "@/components/MentionInput";
import { GenerateCard } from "./GenerateCard";
import type { EntityDTO, ChatThreadDTO, ChatMessageDTO } from "@/lib/types";

export function Cowork({ projectId, entities, threads }: {
  projectId: string;
  entities: EntityDTO[];
  threads: ChatThreadDTO[];
}) {
  // v1: single active thread (most recent) or a fresh one
  const [thread, setThread] = useState<ChatThreadDTO | null>(threads[0] ?? null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>(threads[0]?.messages ?? []);
  const [text, setText] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [variantSel, setVariantSel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // synchronous double-submit guard (GenSpace pattern)
  const [composerKey, setComposerKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!text.trim() || busy || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await coworkTurn({ threadId: thread?.id, projectId, text, entityIds: ids, variantSel });
      if ("error" in res) { setError(res.error); return; }
      const fresh = await getCoworkThreadClient(res.threadId);
      if (fresh) { setThread(fresh); setMessages(fresh.messages); }
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

  return (
    <>
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
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={u} alt="" />
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
    </>
  );
}
