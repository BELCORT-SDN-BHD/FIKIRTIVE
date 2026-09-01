"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  BookOpen,
  CircleAlert,
  Info,
  Package,
  Palette,
  Send,
  ShieldCheck,
  Sparkles,
  Tags,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  addMemory, updateMemory, deleteMemory, restoreMemory, listMyMemory, type MemoryRow,
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
import { undoBrandMemoryDiff } from "@/lib/brand-memory-undo";
import { ottoTurn } from "@/lib/otto-client-actions";
import { getCoworkThreadClient } from "@/lib/cowork-fetch";
import { FactSection } from "./memory/FactSection";
import { SegmentCards } from "./memory/SegmentCards";
import { ProductShowcase } from "./memory/ProductShowcase";
import { ProductImagePickerDialog } from "./memory/ProductImagePickerDialog";
import { OfferList } from "./memory/OfferList";
import { UndoBar } from "./memory/UndoBar";
import { OttoMarkdown } from "./parts/OttoMarkdown";
import type { StuffItem } from "@/lib/stuff-items";

type ChatBubble = {
  id: string;
  role: "you" | "otto";
  text: string;
  delivery?: "pending" | "sent" | "unconfirmed";
};

type ChatNotice = {
  variant: "destructive" | "warning";
  title: string;
  description: string;
  focusDraft?: boolean;
};

/** Map ChatThreadDTO messages → chat bubbles, filtering empty text. */
export function threadToBubbles(
  messages: { id?: string; role: string; text: string }[],
): ChatBubble[] {
  return messages
    .filter((m) => m.text.trim())
    .map((message, index) => ({
      id: message.id ?? `history-${index}`,
      role: message.role === "USER" ? "you" : "otto",
      text: message.text,
      delivery: "sent",
    }));
}

/** #979:这四句话现在住在 `lib/otto-canned-starters` —— 命名守卫认的就是这一份。
 *  抄成两份,守卫认得的和界面发出的会先后漂移,而漂移那天没有一条测试会红。 */
const CHIPS = BRAND_MEMORY_STARTERS;

const SECTION_META: Record<SectionKey, {
  description: string;
  icon: React.ComponentType<{ "aria-hidden"?: boolean }>;
}> = {
  about: {
    description: "The durable story, positioning, and truths Otto should carry into every project.",
    icon: BookOpen,
  },
  look: {
    description: "The visual cues, moods, and creative direction that should make the brand recognisable.",
    icon: Palette,
  },
  customers: {
    description: "The customer groups Otto should understand before writing or planning for them.",
    icon: Users,
  },
  products: {
    description: "The products Otto can describe, recommend, and connect to reusable Library assets.",
    icon: Package,
  },
  offers: {
    description: "Active and scheduled promotions Otto may use when the dates and audience fit.",
    icon: Tags,
  },
  rules: {
    description: "The non-negotiable language and behaviour rules Otto must follow for this brand.",
    icon: ShieldCheck,
  },
};

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

function undoReceiptKey(facts: RowDiff<MemoryRow>, records: RowDiff<BrandRecordRow>): string {
  return [
    ...facts.added.map((row) => `fact-added:${row.id}`),
    ...facts.changed.map((change) => `fact-changed:${change.after.id}:${String(change.after.updatedAt)}`),
    ...facts.removed.map((row) => `fact-removed:${row.id}`),
    ...records.added.map((row) => `record-added:${row.id}`),
    ...records.changed.map((change) => `record-changed:${change.after.id}:${String(change.after.updatedAt)}`),
    ...records.removed.map((row) => `record-removed:${row.id}`),
  ].join("|");
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
  const [chat, setChat] = useState<ChatBubble[]>([]);
  const [brandThreadId, setBrandThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatNotice, setChatNotice] = useState<ChatNotice | null>(null);
  const sendLockRef = useRef(false);
  const localMessageSequenceRef = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);

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
    if (!text || sendLockRef.current) return;
    sendLockRef.current = true;
    const localMessageId = `local-${++localMessageSequenceRef.current}`;
    const snapshot = { facts: memory, records };
    setChatNotice(null);
    setChat((prev) => [
      ...prev,
      { id: localMessageId, role: "you", text, delivery: "pending" },
    ]);
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
        setChat((current) => current.map((message) => (
          message.id === localMessageId ? { ...message, delivery: "unconfirmed" } : message
        )));
        setInput(text);
        setChatNotice({
          variant: "destructive",
          title: "Message wasn't completed",
          description: `${res.error ?? "Something went wrong."} Your draft is back below. Check the conversation before sending it again.`,
          focusDraft: true,
        });
      } else {
        setChat((current) => current.map((message) => (
          message.id === localMessageId ? { ...message, delivery: "sent" } : message
        )));
        setBrandThreadId(res.threadId);
        writeThreadPointer(brandThreadKey, res.threadId);
        const [threadResult, memoryResult, recordsResult] = await Promise.allSettled([
          getCoworkThreadClient(res.threadId),
          listMyMemory(),
          listMyBrandRecords(),
        ]);

        if (threadResult.status === "fulfilled" && threadResult.value) {
          setChat(threadToBubbles(threadResult.value.messages));
        } else if (res.status === "done" && res.reply.trim()) {
          setChat((current) => [
            ...current,
            {
              id: `local-otto-${localMessageId}`,
              role: "otto",
              text: res.reply,
              delivery: "sent",
            },
          ]);
        }

        // Diff the pre-turn snapshot against the refetch so Otto's edits show up
        // live below and can be undone in one click.
        if (memoryResult.status === "fulfilled" && recordsResult.status === "fulfilled") {
          const freshFacts = memoryResult.value;
          const freshRecords = recordsResult.value;
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

        // Brand memory chat is for saving durable facts, not generating media — this surface
        // has no approve UI. If Otto parked a paid generation (needs_approval), steer the user
        // to the main Otto chat instead of silently stranding the parked card here.
        if (res.status === "needs_approval") {
          setChatNotice({
            variant: "warning",
            title: "Continue in the main Otto chat",
            description: "Otto wants to make something. Open the main Otto chat to review and approve it — Brand memory is only for saving facts about your brand.",
          });
        } else if (memoryResult.status === "rejected" || recordsResult.status === "rejected") {
          setChatNotice({
            variant: "warning",
            title: "Brand memory needs a refresh",
            description: "Otto received your message, but the latest saved details couldn't be refreshed. Reload this page before making another edit.",
          });
        } else if (
          res.status !== "done" &&
          (threadResult.status === "rejected" || !threadResult.value)
        ) {
          setChatNotice({
            variant: "warning",
            title: "Conversation needs a refresh",
            description: "Your message was sent, but the latest reply couldn't be loaded. Reload this page to see the durable conversation.",
          });
        }
      }
    } catch {
      setChat((current) => current.map((message) => (
        message.id === localMessageId ? { ...message, delivery: "unconfirmed" } : message
      )));
      setInput(text);
      setChatNotice({
        variant: "destructive",
        title: "Delivery couldn't be confirmed",
        description: "Your draft is back below. Check the conversation before sending it again — Otto may already have received it.",
        focusDraft: true,
      });
    } finally {
      sendLockRef.current = false;
      setSending(false);
      // In a finally on purpose (#550): every exit here has run a metered ottoTurn, and a
      // transport failure cannot prove the turn didn't reserve — the balance shown in the
      // global nav must be re-read either way.
      notifyBalanceRefresh();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void sendChat();
    }
  }

  async function undo(): Promise<string | null> {
    if (!lastDiff) return "There is no recent update to undo.";
    try {
      const failure = await undoBrandMemoryDiff(lastDiff, {
        deleteMemory,
        updateMemory,
        restoreMemory,
        deleteBrandRecord,
        saveBrandRecord,
        restoreBrandRecord,
      });
      if (failure) return failure;

      const [restoredMemory, restoredRecords] = await Promise.all([listMyMemory(), listMyBrandRecords()]);
      setMemory(restoredMemory);
      setRecords(restoredRecords);
      setLastDiff(null);
      setFreshIds(new Set());
      setTouchedTabs(new Set());
      return null;
    } catch {
      return "Brand memory couldn't be restored. Check your connection and try again.";
    }
  }

  // ── Fact handlers (about/look/rules) ──
  const updateAndRefreshMemory = async (id: string, content: string) => {
    const result = await updateMemory({ id, content });
    if ("error" in result) return result.error;
    await refreshMemory();
    return null;
  };

  const addAndRefreshMemory = async (category: string, content: string) => {
    const result = await addMemory({ category, content });
    if ("error" in result) return result.error;
    await refreshMemory();
    return null;
  };

  function factHandlers(sectionKey: (typeof FACT_SECTION_KEYS)[number]) {
    return {
      onSave: updateAndRefreshMemory,
      onDelete: async (id: string) => {
        const result = await deleteMemory({ id });
        if ("error" in result) return result.error;
        setMemory((current) => current.filter((row) => row.id !== id));
        return null;
      },
      onAdd: (content: string) => addAndRefreshMemory(sectionKey, content),
    };
  }

  // ── Loose-note handlers (legacy facts under customers/products sections) ──
  const noteSave = updateAndRefreshMemory;
  const noteDelete = async (id: string) => {
    const result = await deleteMemory({ id });
    if ("error" in result) return result.error;
    setMemory((current) => current.filter((row) => row.id !== id));
    return null;
  };

  const saveAndRefreshBrandRecord = async (input: unknown) => {
    const result = await saveBrandRecord(input);
    if ("error" in result) return result.error;
    await refreshRecords();
    return null;
  };

  // ── Segment handlers ──
  const segSave = async (id: string | undefined, data: Record<string, unknown>) => saveAndRefreshBrandRecord({
    ...(id ? { id } : {}), kind: "segment", data,
  });
  const removeBrandRecord = async (id: string) => {
    const result = await deleteBrandRecord({ id });
    if ("error" in result) return result.error;
    setRecords((current) => current.filter((record) => record.id !== id));
    return null;
  };
  const segArchive = async (id: string, data: Record<string, unknown>, status: "active" | "archived") =>
    saveAndRefreshBrandRecord({ id, kind: "segment", data, status });

  // ── Product handlers ──
  const prodSave = async (id: string | undefined, data: Record<string, unknown>) => saveAndRefreshBrandRecord({
    ...(id ? { id } : {}), kind: "product", data,
  });
  const prodArchive = async (id: string, data: Record<string, unknown>, status: "active" | "archived") =>
    saveAndRefreshBrandRecord({ id, kind: "product", data, status });
  // Set/clear a product's showcase image. null clears by OMITTING the key.
  const prodSetImage = async (rec: BrandRecordRow, assetId: string | null) => {
    const rest = { ...(rec.data as Record<string, unknown>) };
    delete rest.imageAssetId;
    const data = assetId ? { ...rest, imageAssetId: assetId } : rest;
    return saveAndRefreshBrandRecord({ id: rec.id, kind: "product", data });
  };

  const openProductImagePicker = (record: BrandRecordRow) => setPickerFor(record);

  // ── Offer handlers ──
  const offerSave = async (
    id: string | undefined,
    data: Record<string, unknown>,
    dates: { startsAt: string | null; endsAt: string | null },
  ) => saveAndRefreshBrandRecord({
    ...(id ? { id } : {}), kind: "offer", data, startsAt: dates.startsAt, endsAt: dates.endsAt,
  });

  const undoSummary = lastDiff ? summarize(lastDiff.facts, lastDiff.records) : "";
  const undoKey = lastDiff ? undoReceiptKey(lastDiff.facts, lastDiff.records) : "";
  const sectionCounts: Record<SectionKey, number> = {
    about: factsFor("about").length,
    look: factsFor("look").length,
    customers: factsFor("customers").length + recordsFor("segment").length,
    products: factsFor("products").length + recordsFor("product").length,
    offers: recordsFor("offer").length,
    rules: factsFor("rules").length,
  };
  const activeSection = SECTIONS.find((section) => section.key === activeTab) ?? SECTIONS[0];
  const totalSaved = memory.length + records.length;

  return (
    <div className="gb flex-1 overflow-auto px-4 py-6 leading-[1.5] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1120px]">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="m-0 text-[1.5rem] font-semibold leading-tight tracking-[-0.025em] text-foreground">
              Brand memory
            </h1>
            <p className="mb-0 mt-1 max-w-[680px] text-sm leading-5 text-muted-foreground">
              What Otto remembers about your brand — Otto uses it in every project.
            </p>
          </div>
          <Badge variant="outline" className="font-mono font-normal tabular-nums">
            {totalSaved} saved {totalSaved === 1 ? "detail" : "details"}
          </Badge>
        </header>

        <Alert variant="info" className="mb-6">
          <Info aria-hidden />
          <AlertTitle>What Otto uses today</AlertTitle>
          <AlertDescription>
            Brand is where Otto learns your business. Colors, fonts, and logo are not part of this yet — what you write here is what Otto uses today.
          </AlertDescription>
        </Alert>

        {lastDiff && undoSummary && (
          <UndoBar
            key={undoKey}
            summary={undoSummary}
            onUndo={undo}
            onDismiss={() => { setLastDiff(null); setFreshIds(new Set()); setTouchedTabs(new Set()); }}
          />
        )}

        <Tabs
          orientation="vertical"
          className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]"
          value={activeTab}
          onValueChange={(next) => setTab(next as SectionKey)}
        >
          <div className="min-w-0">
            <div className="mb-3 lg:hidden">
              <NativeSelect
                className="w-full"
                aria-label="Brand memory section"
                value={activeTab}
                onChange={(event) => setTab(event.target.value as SectionKey)}
              >
                {SECTIONS.map((section) => (
                  <NativeSelectOption key={section.key} value={section.key}>
                    {section.label}{sectionCounts[section.key] ? ` (${sectionCounts[section.key]})` : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>

            <TabsList className="hidden h-auto w-full flex-col items-stretch bg-transparent p-0 lg:flex">
              {SECTIONS.map((section) => {
                const Icon = SECTION_META[section.key].icon;
                return (
                  <TabsTrigger
                    key={section.key}
                    value={section.key}
                    className="w-full flex-none justify-start px-3 py-2.5 text-left data-[state=active]:bg-card"
                  >
                    <Icon aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{section.label}</span>
                    {sectionCounts[section.key] > 0 && (
                      <Badge variant="default" className="font-mono font-normal tabular-nums">
                        {sectionCounts[section.key]}
                      </Badge>
                    )}
                    {touchedTabs.has(section.key) && (
                      <span className="size-1.5 rounded-full bg-brand" aria-label="Otto updated this" />
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          <div className="min-w-0">
            <div className="mb-5">
              <h2 className="text-lg font-semibold tracking-[-0.015em] text-foreground">
                {activeSection.label}
              </h2>
              <p className="mt-1 max-w-[680px] text-sm leading-5 text-muted-foreground">
                {SECTION_META[activeSection.key].description}
              </p>
            </div>

            <Card tone="otto" size="sm" className="mb-6 shadow-none">
              <CardHeader>
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
                    <Sparkles aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <CardTitle>Ask Otto to update this memory</CardTitle>
                    <CardDescription>
                      Describe the brand naturally. Otto will organise any saved details into the right section.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {CHIPS.map((chip) => (
                    <Button
                      key={chip.label}
                      type="button"
                      size="xs"
                      variant="otto-soft"
                      onClick={() => setInput(chip.prompt)}
                    >
                      {chip.label}
                    </Button>
                  ))}
                </div>

                {(chat.length > 0 || sending) && (
                  <MessageScrollerProvider autoScroll>
                    <MessageScroller className="h-80 sm:h-96">
                      <MessageScrollerViewport>
                        <MessageScrollerContent
                          className="gap-4 px-1 py-2"
                          role="log"
                          aria-live="polite"
                          aria-label="Brand memory conversation"
                        >
                          {chat.map((bubble) => {
                            const isMerchant = bubble.role === "you";
                            return (
                              <MessageScrollerItem
                                key={bubble.id}
                                messageId={bubble.id}
                                scrollAnchor={isMerchant}
                              >
                                <Message align={isMerchant ? "end" : "start"}>
                                  {!isMerchant && (
                                    <MessageAvatar tone="otto" aria-hidden>
                                      <Sparkles />
                                    </MessageAvatar>
                                  )}
                                  <MessageContent>
                                    {!isMerchant && <MessageHeader>Otto</MessageHeader>}
                                    <Bubble
                                      align={isMerchant ? "end" : "start"}
                                      variant={isMerchant ? "default" : "otto"}
                                    >
                                      <BubbleContent className={isMerchant ? "whitespace-pre-wrap" : undefined}>
                                        {isMerchant ? bubble.text : <OttoMarkdown text={bubble.text} />}
                                      </BubbleContent>
                                    </Bubble>
                                    {bubble.delivery === "pending" && (
                                      <MessageFooter>Sending…</MessageFooter>
                                    )}
                                    {bubble.delivery === "unconfirmed" && (
                                      <MessageFooter variant="destructive">
                                        Delivery not confirmed
                                      </MessageFooter>
                                    )}
                                  </MessageContent>
                                </Message>
                              </MessageScrollerItem>
                            );
                          })}

                          {sending && (
                            <MessageScrollerItem messageId="otto-thinking">
                              <Message align="start">
                                <MessageAvatar tone="otto" aria-hidden>
                                  <Sparkles />
                                </MessageAvatar>
                                <MessageContent>
                                  <MessageHeader>Otto</MessageHeader>
                                  <Bubble variant="otto">
                                    <BubbleContent className="flex items-center gap-2">
                                      <Spinner />
                                      <span className="shimmer">Thinking…</span>
                                    </BubbleContent>
                                  </Bubble>
                                </MessageContent>
                              </Message>
                            </MessageScrollerItem>
                          )}
                        </MessageScrollerContent>
                      </MessageScrollerViewport>
                      <MessageScrollerButton variant="outline" />
                    </MessageScroller>
                  </MessageScrollerProvider>
                )}

                {chatNotice && (
                  <Alert role={chatNotice.variant === "destructive" ? "alert" : "status"} variant={chatNotice.variant}>
                    <CircleAlert aria-hidden />
                    <AlertTitle>{chatNotice.title}</AlertTitle>
                    <AlertDescription>
                      <p>{chatNotice.description}</p>
                      {chatNotice.focusDraft && (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => composerRef.current?.focus()}
                        >
                          Review draft
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                <InputGroup>
                  <InputGroupTextarea
                    ref={composerRef}
                    className="[field-sizing:fixed] min-h-20"
                    aria-label="Tell Otto about your brand"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Tell Otto about your brand…"
                    rows={2}
                    disabled={sending}
                  />
                  <InputGroupAddon align="block-end" className="justify-between">
                    <span className="text-xs font-normal text-muted-foreground">
                      Enter to send · Shift + Enter for a new line
                    </span>
                    <InputGroupButton
                      variant="otto"
                      size="sm"
                      disabled={sending || !input.trim()}
                      onClick={() => void sendChat()}
                    >
                      {sending ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
                      Send
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </CardContent>
              <CardFooter className="text-xs text-muted-foreground">
                {CHAT_SPEND_NOTE} Otto edits Brand memory live, and you can undo the latest update.
              </CardFooter>
            </Card>

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
                onDelete={removeBrandRecord}
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
                onOpenPicker={openProductImagePicker}
                onIngest={ingestProductFromUrl}
              />
            </TabsContent>
            <TabsContent value="offers">
              <OfferList
                records={recordsFor("offer")}
                freshIds={freshIds}
                onSave={offerSave}
                onDelete={removeBrandRecord}
              />
            </TabsContent>
            <TabsContent value="rules">
              <FactSection label="" rows={factsFor("rules")} freshIds={freshIds} {...factHandlers("rules")} />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <ProductImagePickerDialog
        key={pickerFor?.id ?? "closed"}
        product={pickerFor}
        items={stuffItems}
        onClose={() => setPickerFor(null)}
        onSetImage={(product, assetId) => prodSetImage(product, assetId)}
      />
    </div>
  );
}

export default OttoMemory;
