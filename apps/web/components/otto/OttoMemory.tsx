"use client";
import React, { useRef, useState } from "react";
import { Sparkles, Plus, Pencil, Trash2, Check, X, Send, MessageCircle, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { addMemory, updateMemory, deleteMemory, listMyMemory, type MemoryRow } from "@/lib/memory-actions";
import { researchBrandFromUrl, type ProposedFact } from "@/lib/brand-research";
import { ottoTurn } from "@/lib/otto-client-actions";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { suggestCategory, isNearDup } from "@/lib/memory-suggest";

const CATEGORIES = ["Brand", "Voice", "Audience", "Products", "Rules"];

const CATEGORY_HINTS: Record<string, string> = {
  Brand: "what you sell + your story",
  Voice: "how you sound",
  Audience: "who you're for",
  Products: "specific items or services",
  Rules: "always/never do",
};

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
  const composerWrapRef = useRef<HTMLDivElement>(null);

  // ── Manual add state ──
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  // ── Derived: category suggestion + dup warning ──
  const suggestedCategory = draft.trim() ? suggestCategory(draft) : null;
  const showCategorySuggest = suggestedCategory !== null && suggestedCategory !== category;
  const dupWarning = draft.trim().length > 10 && isNearDup(draft, memory.map((m) => m.content));

  // P2-9: "Ask Otto about this" — prefills the chat composer
  function askOttoAbout(content: string) {
    const truncated = content.length > 80 ? content.slice(0, 80).trimEnd() + "…" : content;
    setInput(`Tell me more about: "${truncated}"`);
    // Scroll chat into view and focus the composer textarea
    requestAnimationFrame(() => {
      const ta = composerWrapRef.current?.querySelector("textarea");
      ta?.scrollIntoView({ behavior: "smooth", block: "center" });
      ta?.focus();
    });
  }

  // ── Research from URL state ──
  const [researchUrl, setResearchUrl] = useState("");
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [proposedFacts, setProposedFacts] = useState<ProposedFact[]>([]);
  const [selectedFacts, setSelectedFacts] = useState<Set<number>>(new Set());
  const [savingFacts, setSavingFacts] = useState(false);

  async function refresh() {
    setMemory(await listMyMemory());
  }

  // ── Research from URL handlers ──
  async function doResearch() {
    const url = researchUrl.trim();
    if (!url || researching) return;
    setResearching(true);
    setResearchError(null);
    setProposedFacts([]);
    setSelectedFacts(new Set());
    const res = await researchBrandFromUrl(url);
    if ("error" in res) {
      setResearchError(res.error);
    } else {
      setProposedFacts(res.facts);
      // pre-select all facts
      setSelectedFacts(new Set(res.facts.map((_, i) => i)));
    }
    setResearching(false);
  }

  async function addSelectedFacts() {
    const toAdd = proposedFacts.filter((_, i) => selectedFacts.has(i));
    if (!toAdd.length || savingFacts) return;
    setSavingFacts(true);
    setResearchError(null);
    // Save each fact independently; collect the ones that didn't save so a
    // mid-loop failure can't silently drop facts while the panel clears.
    const failed: ProposedFact[] = [];
    for (const fact of toAdd) {
      try {
        const res = await addMemory({ category: fact.category, content: fact.content });
        if (res && "error" in res) failed.push(fact);
      } catch {
        failed.push(fact);
      }
    }
    await refresh();
    if (failed.length) {
      // Keep the panel open showing only the still-unsaved facts, all pre-selected.
      setProposedFacts(failed);
      setSelectedFacts(new Set(failed.map((_, i) => i)));
      setResearchError("Some couldn't be saved — try again.");
    } else {
      setProposedFacts([]);
      setSelectedFacts(new Set());
      setResearchUrl("");
    }
    setSavingFacts(false);
  }

  function toggleFact(i: number) {
    setSelectedFacts((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
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
        // Brand memory chat is for saving durable facts, not generating media — this surface
        // has no approve UI. If Otto parked a paid generation (needs_approval), steer the user
        // to the main Otto chat instead of silently stranding the parked card here.
        if ("status" in res && res.status === "needs_approval") {
          setChatError("Otto wants to make something — open the main Otto chat to review and approve it. Brand memory is just for saving facts about your brand.");
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
    if (e.key === "Enter" && e.shiftKey) {
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
    // leading-[1.65] pins the line-height this subtree currently INHERITS from the .fk
    // ancestor (--leading-relaxed); it survives S4 teardown (when .fk/otto-theme.css is
    // removed and .gb — which sets no line-height — applies at the root). Value-identical
    // today → zero visual change; without it the text compacts post-teardown.
    <div className="gb flex-1 overflow-auto p-[24px_28px_36px] leading-[1.65]">
      <div className="mx-auto max-w-[720px]">
        <h1 className="m-0 text-[1.5rem] font-bold text-foreground leading-tight">
          Brand memory
        </h1>
        <p className="text-[0.9375rem] text-muted-foreground mt-[5px] mb-[18px] leading-[1.5]">
          Chat with Otto about your brand — what you sell, your style, who it&apos;s for. Otto uses it on every campaign.
        </p>

        {/* ── Research my brand ── */}
        <div className="rounded-[16px] border border-border bg-secondary p-[18px] mb-5">
          <div className="flex items-center gap-2 mb-3">
            {/* Globe icon: coral (OTTO agent element) → text-brand */}
            <Globe size={17} className="text-brand" />
            <span className="text-[0.875rem] font-semibold text-foreground">
              Research my brand from a URL
            </span>
          </div>
          <p className="text-[0.75rem] text-muted-foreground mb-3 mt-0">
            Paste your website and Otto will read it and propose brand facts to add to memory.
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Textarea
                className="[field-sizing:fixed] min-h-0"
                value={researchUrl}
                onChange={(e) => setResearchUrl(e.target.value)}
                placeholder="https://yourbrand.com"
                rows={1}
                disabled={researching}
              />
            </div>
            <Button
              disabled={researching || !researchUrl.trim()}
              onClick={() => void doResearch()}
            >
              <Globe size={16} />
              {researching ? "Researching…" : "Research"}
            </Button>
          </div>
          <p className="text-[0.75rem] text-muted-foreground/70 mt-2" style={{ marginBottom: proposedFacts.length ? "0.75rem" : 0 }}>
            Researching uses a little credit.
          </p>

          {researchError && (
            <div role="alert" className="text-[var(--error-soft-foreground)] text-[0.875rem] mb-2">
              {researchError}
            </div>
          )}

          {proposedFacts.length > 0 && (
            <div>
              <p className="text-[0.875rem] font-semibold text-foreground mb-2 mt-0">
                Otto found {proposedFacts.length} brand fact{proposedFacts.length !== 1 ? "s" : ""} — select the ones to add:
              </p>
              <div className="flex flex-col gap-2 mb-3">
                {proposedFacts.map((fact, i) => {
                  const selected = selectedFacts.has(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleFact(i)}
                      className={`flex items-start gap-2 px-[15px] py-[13px] rounded-[10px] cursor-pointer text-left transition-colors duration-150 ${selected ? "border-[1.5px] border-primary bg-card" : "border-[1.5px] border-border bg-card"}`}
                    >
                      <div
                        className={`w-[18px] h-[18px] rounded-[4px] flex-none mt-[1px] flex items-center justify-center transition-colors duration-150 ${selected ? "border-[1.5px] border-primary bg-primary" : "border-[1.5px] border-border bg-transparent"}`}
                      >
                        {selected && <Check size={12} className="text-primary-foreground" />}
                      </div>
                      <div>
                        <div className="mb-1"><Badge variant="default">{fact.category}</Badge></div>
                        <div className="text-[0.875rem] text-foreground leading-[1.5]">
                          {fact.content}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={savingFacts || selectedFacts.size === 0}
                  onClick={() => void addSelectedFacts()}
                >
                  <Plus size={16} />
                  {savingFacts ? "Saving…" : `Add ${selectedFacts.size} selected`}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Chat panel ── */}
        <div className="rounded-[16px] border border-border bg-secondary p-[18px]">
          <div className="flex items-center gap-2 mb-3">
            {/* Sparkles icon: coral (OTTO agent element) → text-brand */}
            <Sparkles size={17} className="text-brand" />
            <span className="text-[0.875rem] font-semibold text-foreground">
              Chat with Otto about your brand
            </span>
          </div>

          {/* Transcript */}
          <div
            ref={transcriptRef}
            className="flex flex-col overflow-y-auto mb-3"
            style={{
              minHeight: 160,
              maxHeight: 360,
              gap: "0.75rem",
              padding: chat.length ? "0.5rem 0" : 0,
            }}
          >
            {chat.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-[0.875rem] text-muted-foreground mb-3">
                  Tell me about your brand — what you sell, your style, who it&apos;s for — and I&apos;ll remember it.
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setInput(s)}
                      className="px-3.5 py-1.5 rounded-full border-[1.5px] border-border bg-card text-foreground text-[0.875rem] cursor-pointer transition-colors duration-150"
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
                  className={`flex ${b.role === "you" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[78%] px-3.5 py-2 text-[0.875rem] leading-[1.5] whitespace-pre-wrap break-words ${b.role === "you" ? "bg-primary text-primary-foreground" : "bg-card text-foreground"}`}
                    style={{
                      borderRadius: b.role === "you" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    }}
                  >
                    {b.text}
                  </div>
                </div>
              ))
            )}
            {sending && (
              <div className="flex justify-start">
                <div
                  className="px-3.5 py-2 bg-card text-muted-foreground text-[0.875rem]"
                  style={{ borderRadius: "16px 16px 16px 4px" }}
                >
                  Otto is thinking…
                </div>
              </div>
            )}
          </div>

          {chatError && (
            <div role="alert" className="text-[var(--error-soft-foreground)] text-[0.875rem] mb-2">
              {chatError}
            </div>
          )}

          {/* Composer */}
          <div className="flex gap-2 items-end">
            <div className="flex-1" ref={composerWrapRef}>
              <Textarea
                className="[field-sizing:fixed] min-h-0"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Tell Otto about your brand…"
                rows={2}
                disabled={sending}
              />
            </div>
            <Button
              disabled={sending || !input.trim()}
              onClick={() => void sendChat()}
            >
              <Send size={16} />
              Send
            </Button>
          </div>
          <p className="text-[0.75rem] text-muted-foreground/70 mt-2 mb-0">
            Chatting with Otto uses a little credit.
          </p>
        </div>

        {/* ── What Otto remembers ── */}
        <div className="mt-[22px]">
          <div className="flex items-center justify-between mb-[10px]">
            <h2 className="font-semibold text-[1.125rem] text-foreground m-0">
              What Otto remembers
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddOpen((v) => !v)}
            >
              <Plus size={16} />
              Add manually
            </Button>
          </div>

          {/* Manual add form — togglable */}
          {addOpen && (
            <div className="rounded-[16px] border border-border bg-secondary p-[18px] mb-4">
              <div className="flex flex-wrap gap-2 mb-2">
                {CATEGORIES.map((c) => {
                  const active = c === category;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`px-3.5 py-1.5 rounded-full text-[0.875rem] font-semibold cursor-pointer transition-colors duration-150 ${active ? "border-[1.5px] border-primary bg-primary text-primary-foreground" : "border-[1.5px] border-border bg-card text-foreground"}`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
              {/* Category hint + auto-suggest */}
              <div className="flex items-center gap-2 mb-3" style={{ minHeight: 20 }}>
                <span className="text-[0.75rem] text-muted-foreground/70">
                  {CATEGORY_HINTS[category]}
                </span>
                {showCategorySuggest && (
                  <button
                    type="button"
                    onClick={() => setCategory(suggestedCategory!)}
                    className="px-2.5 py-0.5 rounded-full border-[1.5px] border-brand bg-transparent text-brand text-[0.75rem] font-semibold cursor-pointer"
                  >
                    looks like {suggestedCategory}?
                  </button>
                )}
              </div>
              <Textarea
                className="[field-sizing:fixed] min-h-0"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={category === "Brand" ? "Paste anything about your brand — what you sell, your style, your story…" : `A note about your ${category.toLowerCase()}…`}
                rows={3}
              />
              {dupWarning && (
                <div role="status" className="text-[0.75rem] text-muted-foreground mt-1.5">
                  You may have already added something like this.
                </div>
              )}
              {error && <div role="alert" className="text-[var(--error-soft-foreground)] text-[0.875rem] mt-1.5">{error}</div>}
              <div className="flex justify-end mt-3">
                <Button disabled={busy || !draft.trim()} onClick={add}>
                  <Plus size={16} />
                  {busy ? "Saving…" : "Add to memory"}
                </Button>
              </div>
            </div>
          )}

          {/* Memory list */}
          <div className="flex flex-col gap-3">
            {memory.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                Nothing yet. Chat with Otto above or add a note manually.
              </div>
            )}
            {memory.map((m) => (
              <div key={m.id} className="rounded-[14px] border border-border bg-card p-[13px_15px]">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="default">{m.category}</Badge>
                      <span className="text-[0.71875rem] text-muted-foreground/70">
                        {m.source === "otto" ? "Otto learned this" : "You added this"}
                        {whenLabel(m.updatedAt) ? ` · ${whenLabel(m.updatedAt)}` : ""}
                      </span>
                    </div>
                    {editingId === m.id ? (
                      <Textarea className="[field-sizing:fixed] min-h-0" value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
                    ) : (
                      <div className="text-[0.875rem] text-foreground leading-[1.5] whitespace-pre-wrap break-words">
                        {m.content}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-none">
                    {editingId === m.id ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => saveEdit(m.id)} aria-label="Save"><Check size={15} /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} aria-label="Cancel"><X size={15} /></Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => askOttoAbout(m.content)} aria-label="Ask Otto about this" title="Ask Otto about this">
                          <MessageCircle size={15} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setEditingId(m.id); setEditText(m.content); }} aria-label="Edit"><Pencil size={15} /></Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(m.id)} aria-label="Delete"><Trash2 size={15} /></Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default OttoMemory;
