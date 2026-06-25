"use client";
import React, { useState } from "react";
import { Sparkles, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { Card, Button, Textarea, Badge } from "@/components/fk";
import { addMemory, updateMemory, deleteMemory, listMyMemory, type MemoryRow } from "@/lib/memory-actions";

const CATEGORIES = ["Brand", "Voice", "Audience", "Products", "Rules"];

function whenLabel(d: MemoryRow["updatedAt"]): string {
  const date = new Date(d as unknown as string);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function OttoMemory({ initialMemory }: { initialMemory: MemoryRow[] }) {
  const [memory, setMemory] = useState<MemoryRow[]>(initialMemory);
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  async function refresh() {
    setMemory(await listMyMemory());
  }

  async function add() {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    const res = await addMemory({ category, content });
    if ("error" in res) setError(res.error);
    else {
      setDraft("");
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
          What Otto remembers about your brand. Add anything — Otto uses it on every campaign. You can edit or remove it whenever you like.
        </p>

        {/* Compose */}
        <Card variant="tint" padding="md">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            <Sparkles size={18} color="var(--accent)" />
            <span style={{ fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], color: "var(--text-strong)" }}>Teach Otto something</span>
          </div>
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

        {/* List */}
        <div style={{ marginTop: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {memory.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "var(--space-8) 0" }}>
              Nothing yet. Tell Otto about your brand above.
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
  );
}

export default OttoMemory;
