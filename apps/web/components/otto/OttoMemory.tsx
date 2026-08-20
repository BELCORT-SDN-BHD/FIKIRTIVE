"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Sparkles, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
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
import { BRAND_MEMORY_STARTERS } from "@/lib/otto-canned-starters";
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

/** #979:这四句话现在住在 `lib/otto-canned-starters` —— 命名守卫认的就是这一份。
 *  抄成两份,守卫认得的和界面发出的会先后漂移,而漂移那天没有一条测试会红。 */
const CHIPS = BRAND_MEMORY_STARTERS;

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

/** #977:Chrome 的「阻止所有 Cookie」不是让 `getItem` 返回空 —— 它让**读 `sessionStorage`
 *  这个属性本身**抛 SecurityError。下面三处以前是 `window.sessionStorage.xxx()` 的裸取,
 *  而第一处在 useEffect 的同步体里:W2-2 之后这个组件就是 `/brand` 这条顶层路由的全部页面
 *  内容(`app/brand/page.tsx`),那一抛不是「聊天记不住」,是整面品牌资料打到错误边界白屏。
 *
 *  形状照抄 `components/canvas/useCanvasGen.ts` 的 `receiptStorage()`:存不了就当没记指针 ——
 *  每次重挂开一条新会话线程,这一面照常用。 */
function threadStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function readThreadPointer(key: string): string | null {
  try {
    return threadStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeThreadPointer(key: string, threadId: string): void {
  try {
    threadStorage()?.setItem(key, threadId);
  } catch {
    /* 记不住指针只是下次重挂时另开一条会话,不是错误 —— 消息本身的权威在服务端。 */
  }
}

function forgetThreadPointer(key: string): void {
  try {
    threadStorage()?.removeItem(key);
  } catch {
    /* 同上:删不掉的指针下一次读回来也只是指向一条读不到的会话,那条路已经处理过了。 */
  }
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

  // ── Chat state ──
  // BUG 6 (second half). This transcript lives in component state, and the server never hands
  // this view a thread: OttoView renders <OttoMemory> with memory/records/projectId only. So
  // anything that unmounts the Otto tree — a project switch, an explicit ?thread= switch, a
  // reload, a browser tab restore — used to lose BOTH the transcript and the pointer to the
  // conversation it belonged to, and the merchant's next question silently opened a SECOND
  // brand conversation instead of continuing the first.
  //
  // Cheapest honest fix: remember only the thread ID, per tab and per project, and let the
  // server stay the authority for the messages (they are already durable — the transcript is
  // read back with the same call sendChat uses). Nothing about the conversation is stored in
  // the browser beyond that ID.
  const brandThreadKey = `fikirtive:otto-brand-thread:${projectId}`;
  const [chat, setChat] = useState<Bubble[]>([]);
  const [brandThreadId, setBrandThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const remembered = readThreadPointer(brandThreadKey);
    if (!remembered) return;
    let alive = true;
    void getCoworkThreadClient(remembered).then((thread) => {
      if (!alive) return;
      if (!thread) {
        // Owner-scoped read came back empty — the conversation is genuinely gone (deleted),
        // so drop the pointer rather than keep replying into a thread that no longer exists.
        forgetThreadPointer(brandThreadKey);
        return;
      }
      // Never overwrite a turn the merchant has already started in this mount.
      setBrandThreadId((prev) => prev ?? remembered);
      setChat((prev) => (prev.length ? prev : threadToBubbles(thread.messages)));
    }).catch(() => {
      // A failed read proves nothing about the thread — keep the pointer, keep the screen.
    });
    return () => { alive = false; };
  }, [brandThreadKey]);

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
        writeThreadPointer(brandThreadKey, res.threadId);
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
        <p className="text-[0.9375rem] text-muted-foreground mt-[5px] mb-[10px] leading-[1.5]">
          What Otto remembers about your brand — Otto uses it in every project.
        </p>

        {/* W2-2(规格书 §4.4)——「说实话」那一半。这一面叫 Brand,但它今天只有**文字**这一层
            通电:六个页签写进 Memory 与 BrandRecord 两张真表,Otto 每次都读。颜色、字体、logo
            对应的 BrandKit / BrandRule 各只有一个读取点、零写入点(`lib/memory-actions.ts`),
            也就是说商家就算填了也没有任何一处会用 —— 地基重设计是另一张票,在它落地之前,
            这一句是唯一诚实的说法。它写在组件里而不是写在 /brand 那张页面上,因为旧的
            /otto?view=memory 今天还开着,同一件事不许只在一扇门后面说。 */}
        <p className="text-[0.875rem] text-muted-foreground mt-0 mb-[18px] leading-[1.5]">
          Brand is where Otto learns your business. Colors, fonts, and logo are not part of this
          yet — what you write here is what Otto uses today.
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
              <Button
                key={c.label}
                type="button"
                variant="outline"
                onClick={() => setInput(c.prompt)}
                className="h-auto rounded-full border-border bg-secondary px-3 py-1.5 text-[0.8125rem] font-normal hover:bg-accent"
              >
                {c.label}
              </Button>
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
                aria-label="Tell Otto about your brand"
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

          {/* ── Tabs ──
              W2-2(规格书 §5.6 ②):这里原本是一个手写 `role="tablist"` 的 div,里面六颗
              `role="tab"` 的按钮。手写 tablist 的代价不是样子,是键盘模型 —— WAI-ARIA 的
              tabs 模式要求左右方向键在页签之间走、Home/End 到两头、而整条 tablist 只占
              一个 Tab 停靠点。手写那版一个都没有:六颗按钮各自吃一次 Tab,方向键什么都不做。
              换成 `components/ui/tabs`(Radix)之后这套模型是组件自带的。 */}
          <Tabs
            className="gap-0"
            value={activeTab}
            onValueChange={(next) => setTab(next as SectionKey)}
          >
            <TabsList className="rounded-[14px] mb-4">
              {SECTIONS.map((s) => {
                const count = s.key === "customers" ? recordsFor("segment").length
                  : s.key === "products" ? recordsFor("product").length
                  : s.key === "offers" ? recordsFor("offer").length : 0;
                return (
                  <TabsTrigger
                    key={s.key}
                    value={s.key}
                    className="flex-none gap-2 text-[0.8125rem] font-normal data-[state=active]:font-semibold"
                  >
                    {s.label}
                    {count > 0 && <span className="text-[0.6875rem] text-muted-foreground/70">{count}</span>}
                    {touchedTabs.has(s.key) && <span className="h-[6px] w-[6px] rounded-full bg-brand" aria-label="Otto updated this" />}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {/* ── Active panel ── */}
            <TabsContent value="about">
              <FactSection label="" rows={factsFor("about")} freshIds={freshIds} {...factHandlers("about")} />
            </TabsContent>
            <TabsContent value="look">
              <FactSection label="" rows={factsFor("look")} freshIds={freshIds} {...factHandlers("look")} />
            </TabsContent>
            <TabsContent value="customers">
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
            </TabsContent>
            <TabsContent value="products">
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
            </TabsContent>
            <TabsContent value="offers">
              <OfferList
                records={recordsFor("offer")}
                freshIds={freshIds}
                onSave={offerSave}
                onDelete={offerDelete}
              />
            </TabsContent>
            <TabsContent value="rules">
              <FactSection label="" rows={factsFor("rules")} freshIds={freshIds} {...factHandlers("rules")} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* ── Library picker ──
          W2-2(规格书 §5.6 ①):原来这里是一个 `fixed inset-0` 的 div 叠一个卡片 div,
          连 `role="dialog"` 都没有,自己接了一个 backdrop-click 关闭 —— 没有焦点陷阱、
          没有 Escape、没有可访问名字,读屏软件根本不知道有东西打开了。换成
          `components/ui/dialog`(Radix)之后这四样都是组件自带的。 */}
      <Dialog open={pickerFor !== null} onOpenChange={(open) => { if (!open) setPickerFor(null); }}>
        <DialogContent className="max-w-[min(720px,calc(100vw-2rem))] max-h-[80vh] overflow-auto">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-[0.9375rem]">Choose an image from Library</DialogTitle>
            <DialogDescription>
              Pick one of your own images to show on this product.
            </DialogDescription>
          </DialogHeader>
          {pickerFor && (
            <StuffLibrary
              items={stuffItems}
              mode="picker"
              onPick={(assetId) => { void prodSetImage(pickerFor, assetId); setPickerFor(null); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default OttoMemory;
