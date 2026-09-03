"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { CheckCircle2, Eye, FileText, History, Plus, Sparkles, Trash2, Undo2 } from "lucide-react";

import {
  BRAND_SECTIONS,
  brandOriginLabel,
  brandSectionAction,
  brandSectionLabel,
  isBrandSectionKey,
  type BrandSectionKey,
  type BrandContextStatus,
} from "@fikirtive/core";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/design-system/primitives/accordion";
import { Button } from "@/design-system/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/design-system/primitives/dialog";
import { Input } from "@/design-system/primitives/input";
import { Label } from "@/design-system/primitives/label";
import { Tabs, TabsList, TabsTrigger } from "@/design-system/primitives/tabs";
import { Textarea } from "@/design-system/primitives/textarea";
import { toast } from "@/design-system/primitives/toast";
import { cn } from "@/lib/utils";

import {
  addBrandSource,
  confirmBrandDraft,
  deleteMemory,
  discardBrandDraft,
  extractBrandDraft,
  previewBrandContextEffect,
  restoreMemory,
  saveBrandDraft,
  updateMemory,
} from "@/lib/memory-actions";
import { deleteBrandRecord, restoreBrandRecord } from "@/lib/brand-record-actions";
import { listBrandRevisionsAction } from "@/lib/brand-revision-actions";
import { packBrandContent } from "@/lib/brand-context-format";
import type { BrandContextEntry, BrandSectionView } from "@/lib/brand-context-data";
import type { BrandRevisionRow } from "@/lib/brand-revision";

/**
 * BrandWorkspace —— 设计 `apps/web/design-system/patterns/brand/BrandReference.tsx` 的
 * 生产实现(FRONT-A8;规格 §7.3④)。版面、文案与几何照夹具,数据全部来自服务器。
 *
 * 夹具上有、这里**故意不渲染**的控件,以及理由,逐条写在 PR 的「设计有、生产暂不显示」表:
 * URL / File 两种来源、Usage 与 Instructions 两层、Processing 状态、已保存记录上的
 * Preview effect。共同的判据是 Founder 的规则①:设计有、后端没有契约的控件不渲染 ——
 * 摆一个点不动或点了说谎的按钮,比没有这个按钮更糟。
 */

const SECTION_DESCRIPTIONS: Record<BrandSectionKey, string> = {
  "brand-voice": "How Otto should sound when it writes for your business.",
  audiences: "The people Otto should understand before it creates.",
  "knowledge-base": "Approved facts and claims Otto can rely on.",
  "style-guide": "Writing rules that stay consistent everywhere.",
  "visual-guidelines": "The visual direction Otto should follow in Creation.",
};

const STATUS_ART: Record<BrandContextStatus, string> = {
  Ready: "/brand/otto-success.svg",
  Draft: "/brand/otto-approving.svg",
  Processing: "/brand/otto-thinking.svg",
};

const STATUS_STYLE: Record<BrandContextStatus, string> = {
  Ready: "bg-success-soft text-success-soft-foreground",
  Draft: "bg-secondary text-secondary-foreground",
  Processing: "bg-warning-soft text-warning-soft-foreground",
};

function updateSectionRoute(section: BrandSectionKey) {
  const url = new URL(window.location.href);
  url.searchParams.set("section", section);
  window.history.pushState(window.history.state, "", url);
}

function whenLabel(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function StatusBadge({ status }: { status: BrandContextStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium", STATUS_STYLE[status])}>
      {status}
    </span>
  );
}

/** 「谁改的、何时改的」—— FRONT-A8 要求每条都看得到。人拿不到时照直说不知道。 */
function ChangedByLine({ entry }: { entry: BrandContextEntry }) {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {entry.updatedByLabel
        ? `Updated by ${entry.updatedByLabel} · ${whenLabel(entry.updatedAt)}`
        : `Updated ${whenLabel(entry.updatedAt)} · we don't have a record of who`}
    </p>
  );
}

function ContextList({
  label,
  entries,
  removed,
  selectedId,
  onSelect,
  onAdd,
  onRestore,
  pending,
}: {
  label: string;
  entries: BrandContextEntry[];
  removed: BrandContextEntry[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRestore: (entry: BrandContextEntry) => void;
  pending: boolean;
}) {
  return (
    <aside className="w-[324px] shrink-0 overflow-y-auto border-r border-border bg-background px-4 py-5" aria-label="Saved context">
      <div className="mb-3 flex items-center justify-between px-1">
        <p className="text-sm font-medium">
          {label}{" "}
          <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{entries.length}</span>
        </p>
        <Button variant="ghost" size="icon-xs" aria-label="Add context from this list" onClick={onAdd}>
          <Plus aria-hidden />
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          Nothing here yet. What you add becomes context Otto uses in every generation.
        </p>
      ) : null}

      <div>
        {entries.map((entry) => {
          const selected = entry.id === selectedId;
          return (
            <Button
              key={entry.id}
              variant="ghost"
              motion="instant"
              aria-selected={selected}
              onClick={() => onSelect(entry.id)}
              className={cn(
                "h-auto w-full items-start justify-start rounded-lg border border-transparent px-3 py-3.5 text-left font-normal",
                !selected && "rounded-none border-b-border",
                selected && "border-foreground/70 bg-card shadow-xs aria-selected:bg-card",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{entry.name}</span>
                <span
                  className={cn(
                    "mt-1 flex items-center gap-1.5 text-xs",
                    entry.status === "Ready" ? "text-success" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn("size-2 rounded-full", entry.status === "Ready" ? "bg-success" : "bg-muted-foreground/45")}
                    aria-hidden
                  />
                  {entry.status}
                </span>
              </span>
            </Button>
          );
        })}
      </div>

      {/* 设计里没有这一层,但生产必需:删除必须能撤销,否则「删除」就是不可逆的。
          用的是设计系统本来的样式(Founder 规则②)。 */}
      {removed.length ? (
        <div className="mt-6 border-t border-border pt-4">
          <p className="px-1 text-xs font-medium text-muted-foreground">Removed</p>
          <ul className="mt-2 space-y-1">
            {removed.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 px-1 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{entry.name}</span>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => onRestore(entry)}>
                  <Undo2 aria-hidden />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

function PreviewDialog({
  open,
  onOpenChange,
  name,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  result: { without: string; with: string } | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(720px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Preview effect</DialogTitle>
          <DialogDescription>
            This is what Otto reads about your brand before and after saving {name}.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[var(--radius-card)] border border-border bg-muted/40 p-4">
              <p className="text-xs font-semibold text-muted-foreground">Without context</p>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6">
                {result.without || "Otto has nothing about your brand yet."}
              </pre>
            </div>
            <div className="rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-xs">
              <p className="text-xs font-semibold text-muted-foreground">With context</p>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6">{result.with}</pre>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Reading your brand context…</p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddContextDialog({
  section,
  open,
  onOpenChange,
  onCreated,
}: {
  section: BrandSectionKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  function reset() {
    setName("");
    setText("");
  }

  async function createDraft() {
    setBusy(true);
    try {
      // 裁决四的五步链,前三步在这里跑完:加来源 → 抽取 → 生成草稿。
      // 前两步一个字节都不写库;第三步落的是 Draft,Otto 读不到。
      const source = await addBrandSource({ sourceKind: "text", text });
      if ("error" in source) return void toast.error(source.error);
      const draft = await extractBrandDraft({ name, text: source.text });
      if ("error" in draft) return void toast.error(draft.error);
      const saved = await saveBrandDraft({
        section,
        name: draft.name,
        content: draft.content,
        origin: source.origin,
        originDetail: source.originDetail,
      });
      if ("error" in saved) return void toast.error(saved.error);
      reset();
      onOpenChange(false);
      onCreated(saved.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{brandSectionAction(section)}</DialogTitle>
          <DialogDescription>Add a source, then review what will be saved before Otto uses it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="context-name">Name</Label>
            <Input
              id="context-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={`Name this ${brandSectionLabel(section).toLowerCase()}`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-text">Source text</Label>
            <Textarea
              id="source-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste the material Otto should learn from"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            This creates a draft. Nothing reaches Otto until you save it.
          </p>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !name.trim() || !text.trim()} onClick={createDraft}>
            Review draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailAccordion({ entry }: { entry: BrandContextEntry }) {
  const [history, setHistory] = React.useState<BrandRevisionRow[] | null>(null);

  // 换一条记录就重取它的改动史。挂在展开事件上更省一次查询,但那样这一层是否装得上
  // 就取决于 primitive 有没有把 onClick 透传下去 —— 一个「历史永远在读取中」的面板
  // 比一次便宜的查询贵得多。
  React.useEffect(() => {
    let alive = true;
    setHistory(null);
    listBrandRevisionsAction({ kind: entry.kind, id: entry.id }).then((rows) => {
      if (alive) setHistory(rows);
    });
    return () => { alive = false; };
  }, [entry.id, entry.kind]);

  return (
    <Accordion
      multiple
      defaultValue={["evidence"]}
      className="mt-7 border-t border-border [&_[data-slot=accordion-item]]:border-border"
    >
      <AccordionItem value="evidence">
        <AccordionTrigger className="rounded-none py-5">
          <span className="flex items-start gap-3">
            <span className="grid size-7 place-items-center">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <span>
              <span className="block font-semibold">Evidence</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                Where this context came from.
              </span>
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <FileText className="size-4 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{brandOriginLabel(entry.origin)}</p>
                {entry.originDetail ? (
                  <p className="truncate text-xs text-muted-foreground">{entry.originDetail}</p>
                ) : null}
              </div>
              {entry.status === "Ready" ? <CheckCircle2 className="size-4 text-success" aria-label="Saved" /> : null}
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="history">
        <AccordionTrigger className="rounded-none py-5">
          <span className="flex items-start gap-3">
            <span className="grid size-7 place-items-center">
              <History className="size-4" aria-hidden />
            </span>
            <span>
              <span className="block font-semibold">Change history</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                See what changed, who changed it, and when.
              </span>
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          {history === null ? (
            <p className="text-sm text-muted-foreground">Reading the history…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing has changed since this context was added.
            </p>
          ) : (
            <ul className="space-y-2 text-sm text-muted-foreground">
              {history.map((row) => (
                <li key={`${row.action}-${String(row.changedAt)}`}>
                  {row.summary} — {row.changedByLabel} · {whenLabel(row.changedAt)}
                </li>
              ))}
            </ul>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function BrandWorkspace({
  sections,
  initialSection,
}: {
  sections: BrandSectionView[];
  initialSection: BrandSectionKey;
}) {
  const router = useRouter();
  const [section, setSection] = React.useState<BrandSectionKey>(initialSection);
  const [selectedIds, setSelectedIds] = React.useState<Partial<Record<BrandSectionKey, string>>>({});
  const [addOpen, setAddOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<{ without: string; with: string } | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; content: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    const syncFromRoute = () => {
      const next = new URL(window.location.href).searchParams.get("section") ?? undefined;
      if (isBrandSectionKey(next)) setSection(next);
    };
    window.addEventListener("popstate", syncFromRoute);
    return () => window.removeEventListener("popstate", syncFromRoute);
  }, []);

  const view = sections.find((s) => s.key === section) ?? sections[0]!;
  const selected = view.entries.find((e) => e.id === selectedIds[section]) ?? view.entries[0];

  function chooseSection(next: BrandSectionKey) {
    setSection(next);
    setEditing(null);
    updateSectionRoute(next);
  }

  function select(id: string) {
    setEditing(null);
    setSelectedIds((current) => ({ ...current, [section]: id }));
  }

  function run(work: () => Promise<{ ok: true } | { error: string }>, done?: string) {
    startTransition(async () => {
      const result = await work();
      if ("error" in result) return void toast.error(result.error);
      if (done) toast.success(done);
      router.refresh();
    });
  }

  async function openPreview(entry: BrandContextEntry) {
    setPreview(null);
    setPreviewOpen(true);
    const result = await previewBrandContextEffect({ id: entry.id });
    if ("error" in result) {
      setPreviewOpen(false);
      return void toast.error(result.error);
    }
    setPreview({ without: result.without, with: result.with });
  }

  return (
    <main className="flex h-[calc(100dvh-2.75rem)] min-w-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border px-7 pt-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">{brandSectionLabel(section)}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{SECTION_DESCRIPTIONS[section]}</p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus aria-hidden />
            {brandSectionAction(section)}
          </Button>
        </div>
        <Tabs value={section} onValueChange={(value) => chooseSection(value as BrandSectionKey)} className="mt-5 gap-0">
          <TabsList className="rounded-none bg-transparent p-0">
            {BRAND_SECTIONS.map((item) => (
              <TabsTrigger
                key={item.key}
                value={item.key}
                className="rounded-none border-b-2 border-transparent px-4 py-3 transition-none data-active:border-foreground data-active:bg-transparent data-active:shadow-none"
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>

      {/* 结构化记录(产品 / 优惠 / 客群)今天只有一个编辑器,而它不在设计的五节里。
          把它悄悄删掉不行,所以这两节各留一行指路;等第②段 Library 接过产品管理,
          这一行连同 /brand/records 一起删(理由写在那一页的注释里)。 */}
      {section === "knowledge-base" || section === "audiences" ? (
        <p className="shrink-0 border-b border-border bg-secondary/40 px-7 py-2.5 text-xs text-muted-foreground">
          Products, offers and audiences are edited on their own page.{" "}
          <Link href="/brand/records" className="font-medium text-foreground underline underline-offset-2">
            Open the record editor
          </Link>
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <ContextList
          label={view.label}
          entries={view.entries}
          removed={view.removed}
          selectedId={selected?.id ?? ""}
          onSelect={select}
          onAdd={() => setAddOpen(true)}
          pending={pending}
          onRestore={(entry) =>
            run(
              () => (entry.kind === "memory" ? restoreMemory({ id: entry.id }) : restoreBrandRecord({ id: entry.id })),
              "Brought it back.",
            )
          }
        />

        {selected ? (
          <section className="min-w-0 flex-1 overflow-y-auto px-8 py-7" aria-labelledby="context-title">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-start justify-between gap-6">
                <div className="flex min-w-0 items-start gap-3">
                  <Image aria-hidden alt="" src={STATUS_ART[selected.status]} width={44} height={40} className="mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 id="context-title" className="text-xl font-semibold tracking-[-0.025em]">
                        {selected.name}
                      </h2>
                      <StatusBadge status={selected.status} />
                    </div>
                    <ChangedByLine entry={selected} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selected.status === "Draft" ? (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => openPreview(selected)}>
                        <Eye aria-hidden />
                        Preview effect
                      </Button>
                      <Button size="sm" disabled={pending} onClick={() => run(() => confirmBrandDraft({ id: selected.id }), "Saved for Otto.")}>
                        Save context
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pending}
                        onClick={() => run(() => discardBrandDraft({ id: selected.id }), "Draft discarded.")}
                      >
                        Discard
                      </Button>
                    </>
                  ) : null}
                  {selected.status === "Ready" && selected.kind === "memory" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setEditing(editing?.id === selected.id ? null : { id: selected.id, content: selected.content })
                      }
                    >
                      {editing?.id === selected.id ? "Cancel" : "Edit"}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    aria-label="Remove this context"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => (selected.kind === "memory" ? deleteMemory({ id: selected.id }) : deleteBrandRecord({ id: selected.id })),
                        "Removed. You can restore it from the list.",
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>

              {editing?.id === selected.id ? (
                <div className="mt-6 space-y-3">
                  <Label htmlFor="context-content">Context</Label>
                  <Textarea
                    id="context-content"
                    value={editing.content}
                    onChange={(event) => setEditing({ id: selected.id, content: event.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={pending || !editing.content.trim()}
                      onClick={() => {
                        const next = editing.content;
                        setEditing(null);
                        run(() => updateMemory({ id: selected.id, content: packBrandContent(selected.name, next) }), "Saved.");
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-6 whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {selected.content || "This context has no text yet."}
                </p>
              )}

              <DetailAccordion entry={selected} />
            </div>
          </section>
        ) : (
          <section className="min-w-0 flex-1 px-8 py-7">
            <div className="mx-auto max-w-3xl">
              <h2 className="text-xl font-semibold tracking-[-0.025em]">
                Nothing in {brandSectionLabel(section).toLowerCase()} yet
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                {SECTION_DESCRIPTIONS[section]} Add one and Otto will use it in every generation.
              </p>
              <Button className="mt-5" size="sm" onClick={() => setAddOpen(true)}>
                <Plus aria-hidden />
                {brandSectionAction(section)}
              </Button>
            </div>
          </section>
        )}
      </div>

      <AddContextDialog
        section={section}
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(id) => {
          setSelectedIds((current) => ({ ...current, [section]: id }));
          router.refresh();
        }}
      />
      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} name={selected?.name ?? "this context"} result={preview} />
    </main>
  );
}
