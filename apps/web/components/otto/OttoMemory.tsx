"use client";
import React, { useRef, useState } from "react";
import { Sparkles, Plus, Pencil, Trash2, Check, X, Send } from "lucide-react";
import { Card, Button, Textarea, Badge } from "@/components/fk";
import { addMemory, updateMemory, deleteMemory, listMyMemory, type MemoryRow } from "@/lib/memory-actions";
import { ottoTurn } from "@/lib/otto-client-actions";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";

const CATEGORIES = ["Brand", "Voice", "Audience", "Products", "Rules"];

const STARTERS = [
  "Describe my brand",
  "My ideal customer",
  "My brand voice",
];

type Bubble = { role: "you" | "otto"; text: string };

/** Map ChatThreadDTO messages → chat bubbles, filtering empty text. */
export function threadToBubbles(
  messages: { role: string; text: string }[],
): Bubble[] {
  return messages
    .filter((m) => m.text.trim())
    .map((m) => ({ role: m.role === "USER" ? "you" : "otto", text: m.text } as Bubble));
}

function whenLabel(d: MemoryRow["updatedAt"]): string {
  const date = new Date(d as unknown as string);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function OttoMemory({ initialMemory, projectId }: { initialMemory: MemoryRow[]; projectId: string }) {
  const [memory, setMemory] = useState<MemoryRow[]>(initialMemory);

  // ── Chat state ──
  const [chat, setChat] = useState<Bubble[]>([]);
  const [brandThreadId, setBrandThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // ── Manual add state ──
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  async function refresh() {
    setMemory(await listMyMemory());
  }

  async function sendChat() {
    const text = input.trim();
    if (!text || sending) return;
    setChatError(null);
    setChat((prev) => [...prev, { role: "you", text }]);
    setInput("");
    setSending(true);
    try {
      const res = await ottoTurn({
        projectId,
        text,
        simple: true,
        ...(brandThreadId ? { threadId: brandThreadId } : {}),
      });
      if ("error" in res) {
        setChatError(res.error ?? "Something went wrong — please try again.");
      } else {
        setBrandThreadId(res.threadId);
        const thread = await getCoworkThreadClient(res.threadId);
        if (thread) {
          setChat(threadToBubbles(thread.messages));
        }
        await refresh();
      }
    } catch {
      setChatError("Couldn't reach Otto — please try again.");
    } finally {
      setSending(false);
      // scroll transcript to bottom
      requestAnimationFrame(() => {
        if (transcriptRef.current) {
          transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
        }
      });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendChat();
    }
  }

  // ── Manual memory actions ──
  async function add() {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    const res = await addMemory({ category, content });
    if ("error" in res) setError(res.error);
    else {
      setDraft("");
      setAddOpen(false);
      await refresh();
    }
    setBusy(false);
  }

  async function saveEdit(id: string) {
    const content = editText.trim();
    if (!content) return;
    const res = await updateMemory({ id, content });
    if (!("error" in res)) {
      setEditingId(null);
      await refresh();
    }
  }

  async function remove(id: string) {
    setMemory((cur) => cur.filter((m) => m.id !== id)); // optimistic
    setError(null);
    const res = await deleteMemory({ id });
    if (res && "error" in res) setError(res.error); // surface failure (refresh restores the row)
    await refresh();
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "var(--space-6)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-2xl)", color: "var(--text-strong)", margin: 0 }}>
          Brand memory
        </h1>
        <p style={{ fontSize: "var(--text-base)", color: "var(--text-muted)", marginTop: "var(--space-2)", marginBottom: "var(--space-5)" }}>
          Chat with Otto about your brand — what you sell, your style, who it&apos;s for. Otto uses it on every campaign.
        </p>

        {/* ── Chat panel ── */}
        <Card variant="tint" padding="md">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            <Sparkles size={18} color="var(--accent)" />
            <span style={{ fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], color: "var(--text-strong)" }}>
              Chat with Otto about your brand
            </span>
          </div>

          {/* Transcript */}
          <div
            ref={transcriptRef}
            style={{
              minHeight: 160,
              maxHeight: 360,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
              marginBottom: "var(--space-3)",
              padding: chat.length ? "var(--space-2) 0" : 0,
            }}
          >
            {chat.length === 0 ? (
              <div style={{ padding: "var(--space-4) 0", textAlign: "center" }}>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginBottom: "var(--space-3)" }}>
                  Tell me about your brand — what you sell, your style, who it&apos;s for — and I&apos;ll remember it.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setInput(s)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 999,
                        border: "1.5px solid var(--border-default)",
                        background: "var(--surface-card)",
                        color: "var(--text-body)",
                        fontSize: "var(--text-sm)",
                        cursor: "pointer",
                        transition: "var(--transition-control)",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              chat.map((b, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: b.role === "you" ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "78%",
                      padding: "8px 14px",
                      borderRadius: b.role === "you" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                      background: b.role === "you" ? "var(--brand)" : "var(--surface-card)",
                      color: b.role === "you" ? "var(--text-on-brand)" : "var(--text-body)",
                      fontSize: "var(--text-sm)",
                      lineHeight: "var(--leading-relaxed)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {b.text}
                  </div>
                </div>
              ))
            )}
            {sending && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{
                  padding: "8px 14px",
                  borderRadius: "16px 16px 16px 4px",
                  background: "var(--surface-card)",
                  color: "var(--text-muted)",
                  fontSize: "var(--text-sm)",
                }}>
                  Otto is thinking…
                </div>
              </div>
            )}
          </div>

          {chatError && (
            <div role="alert" style={{ color: "var(--error-700)", fontSize: "var(--text-sm)", marginBottom: "var(--space-2)" }}>
              {chatError}
            </div>
          )}

          {/* Composer */}
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Tell Otto about your brand…"
                rows={2}
                disabled={sending}
              />
            </div>
            <Button
              variant="primary"
              size="md"
              leftIcon={<Send size={16} />}
              disabled={sending || !input.trim()}
              onClick={() => void sendChat()}
            >
              Send
            </Button>
          </div>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", marginTop: "var(--space-2)", marginBottom: 0 }}>
            Chatting with Otto uses a little credit.
          </p>
        </Card>

        {/* ── What Otto remembers ── */}
        <div style={{ marginTop: "var(--space-8)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-4)" }}>
            <h2 style={{ fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-lg)", color: "var(--text-strong)", margin: 0 }}>
              What Otto remembers
            </h2>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Plus size={16} />}
              onClick={() => setAddOpen((v) => !v)}
            >
              Add manually
            </Button>
          </div>

          {/* Manual add form — togglable */}
          {addOpen && (
            <Card variant="tint" padding="md" style={{ marginBottom: "var(--space-4)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "var(--space-3)" }}>
                {CATEGORIES.map((c) => {
                  const active = c === category;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 999,
                        border: active ? "1.5px solid var(--brand)" : "1.5px solid var(--border-default)",
                        background: active ? "var(--brand)" : "var(--surface-card)",
                        color: active ? "var(--text-on-brand)" : "var(--text-body)",
                        fontSize: "var(--text-sm)",
                        fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"],
                        cursor: "pointer",
                        transition: "var(--transition-control)",
                      }}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={category === "Brand" ? "Paste anything about your brand — what you sell, your style, your story…" : `A note about your ${category.toLowerCase()}…`}
                rows={3}
              />
              {error && <div role="alert" style={{ color: "var(--error-700)", fontSize: "var(--text-sm)", marginTop: 6 }}>{error}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-3)" }}>
                <Button variant="primary" size="md" leftIcon={<Plus size={18} />} disabled={busy || !draft.trim()} onClick={add}>
                  {busy ? "Saving…" : "Add to memory"}
                </Button>
              </div>
            </Card>
          )}

          {/* Memory list */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {memory.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "var(--space-8) 0" }}>
                Nothing yet. Chat with Otto above or add a note manually.
              </div>
            )}
            {memory.map((m) => (
              <Card key={m.id} variant="default" padding="md">
                <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <Badge variant="brand">{m.category}</Badge>
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>
                        {m.source === "otto" ? "Otto learned this" : "You added this"}
                        {whenLabel(m.updatedAt) ? ` · ${whenLabel(m.updatedAt)}` : ""}
                      </span>
                    </div>
                    {editingId === m.id ? (
                      <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
                    ) : (
                      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-body)", lineHeight: "var(--leading-relaxed)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {m.content}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 4, flex: "none" }}>
                    {editingId === m.id ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => saveEdit(m.id)} aria-label="Save"><Check size={16} /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} aria-label="Cancel"><X size={16} /></Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => { setEditingId(m.id); setEditText(m.content); }} aria-label="Edit"><Pencil size={16} /></Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(m.id)} aria-label="Delete"><Trash2 size={16} /></Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default OttoMemory;
