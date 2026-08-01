"use client";
import React, { useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Sparkles, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  addMemory, updateMemory, deleteMemory, listMyMemory, type MemoryRow,
} from "@/lib/memory-actions";
import {
  saveBrandRecord, deleteBrandRecord, restoreBrandRecord, listMyBrandRecords,
  type BrandRecordRow,
} from "@/lib/brand-record-actions";
import { ingestProductFromUrl } from "@/lib/product-ingest-actions";
import {
  sectionForCategory, diffRows, FACT_SECTION_KEYS, SECTIONS, sectionsTouched,
  type RowDiff, type SectionKey,
} from "@fikirtive/core/memory-sections";
import { CHAT_SPEND_NOTE } from "@/lib/credit-format";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { ottoTurn } from "@/lib/otto-client-actions";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { FactSection } from "./memory/FactSection";
import { SegmentCards } from "./memory/SegmentCards";
import { ProductShowcase } from "./memory/ProductShowcase";
import { OfferList } from "./memory/OfferList";
import { UndoBar } from "./memory/UndoBar";
import { StuffLibrary } from "./stuff/StuffLibrary";
import { OttoMarkdown } from "./parts/OttoMarkdown";
import type { StuffItem } from "@/lib/stuff-items";

type Bubble = { role: "you" | "otto"; text: string };

/** Map ChatThreadDTO messages → chat bubbles, filtering empty text. */
export function threadToBubbles(
  messages: { role: string; text: string }[],
): Bubble[] {
  return messages
    .filter((m) => m.text.trim())
    .map((m) => ({ role: m.role === "USER" ? "you" : "otto", text: m.text } as Bubble));
}

const CHIPS = [
  { label: "Describe my brand", prompt: "Let me describe my brand to you — ask me what you need to know." },
  { label: "My ideal customer", prompt: "Help me define my main customer groups." },
  { label: "My brand voice", prompt: "Help me pin down my brand voice." },
  { label: "Research my site", prompt: "Research my website and save what you learn — brand facts, products, and current offers. My URL: " },
];

/** ISO "YYYY-MM-DD" for a Date column, or null to clear. */
function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Compose "2 added, 1 changed" from facts+records diffs, skipping zeros. */
function summarize(facts: RowDiff<MemoryRow>, records: RowDiff<BrandRecordRow>): string {
  const added = facts.added.length + records.added.length;
  const changed = facts.changed.length + records.changed.length;
  const removed = facts.removed.length + records.removed.length;
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (changed) parts.push(`${changed} changed`);
  if (removed) parts.push(`${removed} removed`);
  return parts.join(", ");
}

export function OttoMemory({ initialMemory, initialRecords, projectId, stuffItems = [] }: {
  initialMemory: MemoryRow[];
  initialRecords: BrandRecordRow[];
  projectId: string;
  stuffItems?: StuffItem[];
}) {
  const [memory, setMemory] = useState<MemoryRow[]>(initialMemory);
  const [records, setRecords] = useState<BrandRecordRow[]>(initialRecords);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [pickerFor, setPickerFor] = useState<BrandRecordRow | null>(null);
  const [lastDiff, setLastDiff] = useState<{ facts: RowDiff<MemoryRow>; records: RowDiff<BrandRecordRow> } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  // ── Tab state (shallow-routed via ?tab=) ──
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawTab = searchParams.get("tab");
  const activeTab: SectionKey = (SECTIONS.some((s) => s.key === rawTab) ? rawTab : "about") as SectionKey;
  const setTab = (k: SectionKey) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set("tab", k);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const [touchedTabs, setTouchedTabs] = useState<Set<SectionKey>>(new Set());

  // ── Chat state (unchanged) ──
  const [chat, setChat] = useState<Bubble[]>([]);
  const [brandThreadId, setBrandThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // ── Section slices ──
  const factsFor = (key: SectionKey) => memory.filter((m) => sectionForCategory(m.category) === key);
  const recordsFor = (kind: BrandRecordRow["kind"]) => records.filter((r) => r.kind === kind);

  async function refreshMemory() { setMemory(await listMyMemory()); }
  async function refreshRecords() { setRecords(await listMyBrandRecords()); }

  async function sendChat() {
    const text = input.trim();
    if (!text || sending) return;
    const snapshot = { facts: memory, records };
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
        // Diff the pre-turn snapshot against the refetch so Otto's edits show up
        // live below and can be undone in one click.
        const [freshFacts, freshRecords] = await Promise.all([listMyMemory(), listMyBrandRecords()]);
        const factDiff = diffRows(snapshot.facts, freshFacts);
        const recDiff = diffRows(snapshot.records, freshRecords);
        setMemory(freshFacts); setRecords(freshRecords);
        const touched = [
          ...factDiff.added.map((r) => r.id), ...factDiff.changed.map((c) => c.after.id),
          ...recDiff.added.map((r) => r.id), ...recDiff.changed.map((c) => c.after.id),
        ];
        if (touched.length || factDiff.removed.length || recDiff.removed.length) {
          setLastDiff({ facts: factDiff, records: recDiff });
          setFreshIds(new Set(touched));
          window.setTimeout(() => setFreshIds(new Set()), 4000);
          setTouchedTabs(sectionsTouched(factDiff, recDiff));
          window.setTimeout(() => setTouchedTabs(new Set()), 4000);
        }
      }
    } catch {
      setChatError("Couldn't reach Otto — please try again.");
    } finally {
      setSending(false);
      // In a finally on purpose (#550): every exit here has run a metered ottoTurn, and a
      // transport failure cannot prove the turn didn't reserve — the balance shown in the
      // global nav must be re-read either way.
      notifyBalanceRefresh();
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

  async function undo() {
    if (!lastDiff) return;
    setUndoBusy(true);
    try {
      const { facts, records: rec } = lastDiff;
      await Promise.all([
        ...facts.added.map((r) => deleteMemory({ id: r.id })),
        ...facts.changed.map((c) => updateMemory({ id: c.before.id, content: c.before.content })),
        ...facts.removed.map((r) => addMemory({ category: r.category, content: r.content })),
        ...rec.added.map((r) => deleteBrandRecord({ id: r.id })),
        ...rec.changed.map((c) => saveBrandRecord({
          id: c.before.id, kind: c.before.kind, data: c.before.data, status: c.before.status,
          startsAt: isoDay(c.before.startsAt), endsAt: isoDay(c.before.endsAt),
        })),
        ...rec.removed.map((r) => restoreBrandRecord({ id: r.id })),
      ]);
      setMemory(await listMyMemory());
      setRecords(await listMyBrandRecords());
    } finally {
      setUndoBusy(false); setLastDiff(null); setFreshIds(new Set()); setTouchedTabs(new Set());
    }
  }

  // ── Fact handlers (about/look/rules) ──
  function factHandlers(sectionKey: (typeof FACT_SECTION_KEYS)[number]) {
    return {
      onSave: async (id: string, content: string) => { await updateMemory({ id, content }); await refreshMemory(); },
      onDelete: async (id: string) => { await deleteMemory({ id }); await refreshMemory(); },
      onAdd: async (content: string) => { await addMemory({ category: sectionKey, content }); await refreshMemory(); },
    };
  }

  // ── Loose-note handlers (legacy facts under customers/products sections) ──
  const noteSave = async (id: string, content: string) => { await updateMemory({ id, content }); await refreshMemory(); };
  const noteDelete = async (id: string) => { await deleteMemory({ id }); await refreshMemory(); };

  // ── Segment handlers ──
  const segSave = async (id: string | undefined, data: Record<string, unknown>) => {
    await saveBrandRecord({ ...(id ? { id } : {}), kind: "segment", data });
    await refreshRecords();
  };
  const segDelete = async (id: string) => { await deleteBrandRecord({ id }); await refreshRecords(); };
  const segArchive = async (id: string, data: Record<string, unknown>, status: "active" | "archived") => {
    await saveBrandRecord({ id, kind: "segment", data, status });
    await refreshRecords();
  };

  // ── Product handlers ──
  const prodSave = async (id: string | undefined, data: Record<string, unknown>) => {
    await saveBrandRecord({ ...(id ? { id } : {}), kind: "product", data });
    await refreshRecords();
  };
  const prodArchive = async (id: string, data: Record<string, unknown>, status: "active" | "archived") => {
    await saveBrandRecord({ id, kind: "product", data, status });
    await refreshRecords();
  };
  // Set/clear a product's showcase image. null clears by OMITTING the key.
  const prodSetImage = async (rec: BrandRecordRow, assetId: string | null) => {
    const rest = { ...(rec.data as Record<string, unknown>) };
    delete rest.imageAssetId;
    const data = assetId ? { ...rest, imageAssetId: assetId } : rest;
    await saveBrandRecord({ id: rec.id, kind: "product", data });
    await refreshRecords();
  };

  // ── Offer handlers ──
  const offerSave = async (
    id: string | undefined,
    data: Record<string, unknown>,
    dates: { startsAt: string | null; endsAt: string | null },
  ) => {
    await saveBrandRecord({ ...(id ? { id } : {}), kind: "offer", data, startsAt: dates.startsAt, endsAt: dates.endsAt });
    await refreshRecords();
  };
  const offerDelete = async (id: string) => { await deleteBrandRecord({ id }); await refreshRecords(); };

  const undoSummary = lastDiff ? summarize(lastDiff.facts, lastDiff.records) : "";

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className="gb flex-1 overflow-auto p-[24px_28px_36px] leading-[1.5]">
      <div className="mx-auto max-w-[720px]">
        <h1 className="m-0 text-[1.5rem] font-bold text-foreground leading-tight">
          Brand memory
        </h1>
        <p className="text-[0.9375rem] text-muted-foreground mt-[5px] mb-[18px] leading-[1.5]">
          What Otto remembers about your brand — he uses it on every campaign.
        </p>

        {/* ── Chat panel (chips + input + fine print) ── */}
        <div className="rounded-[16px] border border-border bg-secondary p-[18px]">
          <div className="flex items-center gap-2 mb-3">
            {/* Sparkles icon: coral (OTTO agent element) → text-brand */}
            <Sparkles size={17} className="text-brand" />
            <span className="text-[0.875rem] font-semibold text-foreground">
              Chat with Otto about your brand
            </span>
          </div>

          {/* Chips */}
          <div className="flex flex-wrap gap-2 mb-3">
            {CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => setInput(c.prompt)}
                className="rounded-full border border-border bg-secondary px-3 py-1.5 text-[0.8125rem] hover:bg-accent"
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Transcript */}
          {chat.length > 0 && (
            <div
              ref={transcriptRef}
              className="flex flex-col overflow-y-auto mb-3"
              style={{ maxHeight: 360, gap: "0.75rem", padding: "0.5rem 0" }}
            >
              {chat.map((b, i) => (
                <div
                  key={i}
                  className={`flex ${b.role === "you" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[78%] px-3.5 py-2 text-[0.875rem] leading-[1.5] break-words ${b.role === "you" ? "whitespace-pre-wrap bg-primary text-primary-foreground" : "bg-card text-foreground"}`}
                    style={{
                      borderRadius: b.role === "you" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    }}
                  >
                    {/* #586: Otto's side renders markdown; the merchant's own text stays literal. */}
                    {b.role === "you" ? b.text : <OttoMarkdown text={b.text} />}
                  </div>
                </div>
              ))}
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
          )}

          {chatError && (
            <div role="alert" className="text-[var(--error-soft-foreground)] text-[0.875rem] mb-2">
              {chatError}
            </div>
          )}

          {/* Composer */}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
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
            {CHAT_SPEND_NOTE} Otto edits the memory below live — you can undo.
          </p>
        </div>

        {/* ── Undo bar (conditional) ── */}
        <div className="mt-5">
          {lastDiff && undoSummary && (
            <UndoBar
              summary={undoSummary}
              busy={undoBusy}
              onUndo={() => void undo()}
              onDismiss={() => { setLastDiff(null); setFreshIds(new Set()); }}
            />
          )}

          {/* ── Tab bar ── */}
          <div className="flex gap-1 rounded-[14px] bg-muted p-1 w-max mb-4" role="tablist">
            {SECTIONS.map((s) => {
              const count = s.key === "customers" ? recordsFor("segment").length
                : s.key === "products" ? recordsFor("product").length
                : s.key === "offers" ? recordsFor("offer").length : 0;
              const on = activeTab === s.key;
              return (
                <button key={s.key} role="tab" aria-selected={on} onClick={() => setTab(s.key)}
                  className={`flex items-center gap-2 rounded-[10px] px-4 py-2 text-[0.8125rem] ${on ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"}`}>
                  {s.label}
                  {count > 0 && <span className="text-[0.6875rem] text-muted-foreground/70">{count}</span>}
                  {touchedTabs.has(s.key) && <span className="h-[6px] w-[6px] rounded-full bg-brand" aria-label="Otto updated this" />}
                </button>
              );
            })}
          </div>

          {/* ── Active panel ── */}
          {activeTab === "about" && (
            <FactSection label="" rows={factsFor("about")} freshIds={freshIds} {...factHandlers("about")} />
          )}
          {activeTab === "look" && (
            <FactSection label="" rows={factsFor("look")} freshIds={freshIds} {...factHandlers("look")} />
          )}
          {activeTab === "customers" && (
            <SegmentCards
              records={recordsFor("segment")}
              looseNotes={factsFor("customers")}
              freshIds={freshIds}
              onSave={segSave}
              onDelete={segDelete}
              onArchive={segArchive}
              onNoteSave={noteSave}
              onNoteDelete={noteDelete}
            />
          )}
          {activeTab === "products" && (
            <ProductShowcase
              records={recordsFor("product")}
              looseNotes={factsFor("products")}
              freshIds={freshIds}
              stuffItems={stuffItems}
              onSave={prodSave}
              onArchive={prodArchive}
              onNoteSave={noteSave}
              onNoteDelete={noteDelete}
              onSetImage={prodSetImage}
              onOpenPicker={setPickerFor}
              onIngest={ingestProductFromUrl}
            />
          )}
          {activeTab === "offers" && (
            <OfferList
              records={recordsFor("offer")}
              freshIds={freshIds}
              onSave={offerSave}
              onDelete={offerDelete}
            />
          )}
          {activeTab === "rules" && (
            <FactSection label="" rows={factsFor("rules")} freshIds={freshIds} {...factHandlers("rules")} />
          )}
        </div>
      </div>

      {pickerFor && (
        <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center" onClick={() => setPickerFor(null)}>
          <div className="bg-card rounded-[16px] border border-border p-5 max-w-[720px] w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[0.9375rem] font-semibold mb-3">Choose an image from Library</h3>
            <StuffLibrary items={stuffItems} mode="picker" onPick={(assetId) => { void prodSetImage(pickerFor, assetId); setPickerFor(null); }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default OttoMemory;
