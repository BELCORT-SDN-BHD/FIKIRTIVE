"use client"

import Image from "next/image"
import * as React from "react"
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  Eye,
  FileText,
  Globe2,
  History,
  Layers3,
  Lightbulb,
  MoreHorizontal,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react"

import { SHELL_ROUTES } from "@fikirtive/core/navigation"
import { ProductPatternShellFrame } from "@/design-system/patterns/application-shell/ProductPatternShellFrame"
import { OttoPanelFlowReference } from "@/components/otto/panel/OttoPanelFlowReference"
import { REVIEW_ACCOUNT } from "@/design-system/patterns/application-shell/review-account"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/design-system/primitives/accordion"
import { Button } from "@/design-system/primitives/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/design-system/primitives/dialog"
import { Input } from "@/design-system/primitives/input"
import { Label } from "@/design-system/primitives/label"
import { Tabs, TabsList, TabsTrigger } from "@/design-system/primitives/tabs"
import { Textarea } from "@/design-system/primitives/textarea"
import { toast } from "@/design-system/primitives/toast"
import { cn } from "@/lib/utils"

import { BRAND_CONTEXT_FIXTURES } from "./fixtures"
import {
  BRAND_SECTIONS,
  isBrandSectionKey,
  sectionAction,
  sectionLabel,
  type BrandSectionKey,
  type ContextRecord,
  type ContextStatus,
} from "./model"

type SourceKind = "text" | "url" | "file"

const SECTION_DESCRIPTIONS: Record<BrandSectionKey, string> = {
  "brand-voice": "How Otto should sound when it writes for your business.",
  audiences: "The people Otto should understand before it creates.",
  "knowledge-base": "Approved facts and claims Otto can rely on.",
  "style-guide": "Writing rules that stay consistent everywhere.",
  "visual-guidelines": "The visual direction Otto should follow in Creation.",
}

const STATUS_ART: Record<ContextStatus, string> = {
  Ready: "/brand/otto-success.svg",
  Draft: "/brand/otto-approving.svg",
  Processing: "/brand/otto-thinking.svg",
}

const STATUS_STYLE: Record<ContextStatus, string> = {
  Ready: "bg-success-soft text-success-soft-foreground",
  Draft: "bg-secondary text-secondary-foreground",
  Processing: "bg-warning-soft text-warning-soft-foreground",
}

function updateSectionRoute(section: BrandSectionKey, mode: "push" | "replace" = "push") {
  const url = new URL(window.location.href)
  url.searchParams.set("section", section)
  window.history[mode === "push" ? "pushState" : "replaceState"](window.history.state, "", url)
}

function StatusBadge({ status }: { status: ContextStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium", STATUS_STYLE[status])}>
      {status === "Processing" ? <Clock3 className="size-3" aria-hidden /> : null}
      {status}
    </span>
  )
}

function ContextList({
  label,
  records,
  selectedId,
  onSelect,
}: {
  label: string
  records: readonly ContextRecord[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <aside className="w-[324px] shrink-0 border-r border-border bg-background px-4 py-5" aria-label="Saved context">
      <div className="mb-3 flex items-center justify-between px-1">
        <p className="text-sm font-medium">{label} <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{records.length}</span></p>
        <Button variant="ghost" size="icon-xs" aria-label="Add context from this list" onClick={() => document.querySelector<HTMLElement>("[data-add-context]")?.click()}><Plus aria-hidden /></Button>
      </div>
      <div>
        {records.map((record) => {
          const selected = record.id === selectedId
          return (
            <Button
              key={record.id}
              variant="ghost"
              motion="instant"
              aria-selected={selected}
              onClick={() => onSelect(record.id)}
              className={cn(
                "h-auto w-full items-start justify-start rounded-lg border border-transparent px-3 py-3.5 text-left font-normal",
                !selected && "rounded-none border-b-border",
                selected && "border-foreground/70 bg-card shadow-xs aria-selected:bg-card",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{record.name}</span>
                <span className={cn("mt-1 flex items-center gap-1.5 text-xs", record.status === "Ready" ? "text-success" : record.status === "Processing" ? "text-warning-soft-foreground" : "text-muted-foreground")}>
                  <span className={cn("size-2 rounded-full", record.status === "Ready" ? "bg-success" : record.status === "Processing" ? "bg-warning" : "bg-muted-foreground/45")} aria-hidden />
                  {record.status}
                </span>
              </span>
            </Button>
          )
        })}
      </div>
    </aside>
  )
}

function DetailAccordion({ record }: { record: ContextRecord }) {
  return (
    <Accordion multiple defaultValue={["evidence"]} className="mt-7 border-t border-border [&_[data-slot=accordion-item]]:border-border">
      <AccordionItem value="evidence">
        <AccordionTrigger className="rounded-none py-5">
          <span className="flex items-start gap-3">
            <span className="grid size-7 place-items-center"><Sparkles className="size-4" aria-hidden /></span>
            <span><span className="block font-semibold">Evidence <span className="font-normal text-muted-foreground">· 2 sources</span></span><span className="mt-0.5 block text-xs font-normal text-muted-foreground">Sources that define this context.</span></span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-3 px-4 py-3.5">
              {record.source.includes("website") ? <Globe2 className="size-4 text-muted-foreground" aria-hidden /> : <FileText className="size-4 text-muted-foreground" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{record.source}</p>
                <p className="truncate text-xs text-muted-foreground">{record.sourceDetail}</p>
              </div>
              <CheckCircle2 className="size-4 text-success" aria-label="Source reviewed" />
            </div>
            <div className="flex items-center gap-3 border-t border-border px-4 py-3.5">
              <FileText className="size-4 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-sm font-medium">Founder notes</p>
                <p className="text-xs text-muted-foreground">Instructions reviewed before this context became ready.</p>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="mt-2 px-1" onClick={() => toast.info("All available evidence is shown in this review fixture.")}>View all sources <ChevronRight aria-hidden /></Button>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="usage">
        <AccordionTrigger className="rounded-none py-5">
          <span className="flex items-start gap-3"><span className="grid size-7 place-items-center"><Layers3 className="size-4" aria-hidden /></span><span><span className="block font-semibold">Usage <span className="font-normal text-muted-foreground">· {record.usage.length} place{record.usage.length === 1 ? "" : "s"}</span></span><span className="mt-0.5 block text-xs font-normal text-muted-foreground">Where this context is applied.</span></span></span>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <ul className="space-y-2 text-sm text-muted-foreground">
            {record.usage.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="instructions">
        <AccordionTrigger className="rounded-none py-5">
          <span className="flex items-start gap-3"><span className="grid size-7 place-items-center"><Lightbulb className="size-4" aria-hidden /></span><span><span className="block font-semibold">Instructions <span className="font-normal text-muted-foreground">· {record.instructions.length} rules</span></span><span className="mt-0.5 block text-xs font-normal text-muted-foreground">How Otto should use this context.</span></span></span>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <ul className="space-y-2 text-sm text-muted-foreground">
            {record.instructions.map((item) => <li key={item} className="flex gap-2"><span aria-hidden>·</span>{item}</li>)}
          </ul>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="history">
        <AccordionTrigger className="rounded-none py-5">
          <span className="flex items-start gap-3"><span className="grid size-7 place-items-center"><History className="size-4" aria-hidden /></span><span><span className="block font-semibold">Change history</span><span className="mt-0.5 block text-xs font-normal text-muted-foreground">See what changed and when.</span></span></span>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <ul className="space-y-2 text-sm text-muted-foreground">
            {record.history.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function PreviewDialog({ record, open, onOpenChange }: { record: ContextRecord; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(720px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Preview effect</DialogTitle>
          <DialogDescription>Compare the same sample before and after applying {record.name}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-border bg-muted/40 p-4">
            <p className="text-xs font-semibold text-muted-foreground">Without context</p>
            <p className="mt-3 text-sm leading-6">{record.withoutPreview}</p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-xs">
            <p className="text-xs font-semibold text-muted-foreground">With context</p>
            <p className="mt-3 text-sm leading-6">{record.withPreview}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddContextDialog({
  section,
  open,
  onOpenChange,
  onCreate,
}: {
  section: BrandSectionKey
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (record: ContextRecord) => void
}) {
  const [sourceKind, setSourceKind] = React.useState<SourceKind>("text")
  const [name, setName] = React.useState("")
  const [sourceValue, setSourceValue] = React.useState("")

  function reset() {
    setSourceKind("text")
    setName("")
    setSourceValue("")
  }

  function createDraft() {
    const trimmedName = name.trim()
    if (!trimmedName) return
    const sourceLabel = sourceKind === "url" ? "Company website" : sourceKind === "file" ? "File upload" : "Pasted text"
    onCreate({
      id: `${section}-${Date.now()}`,
      name: trimmedName,
      description: "Review the extracted details before saving this context for Otto.",
      status: "Draft",
      updated: "Created now",
      source: sourceLabel,
      sourceDetail: sourceValue || (sourceKind === "file" ? "Selected file" : "New source"),
      instructions: ["Draft instructions are ready for Founder review"],
      usage: ["Not used yet"],
      history: ["Draft created in this review session"],
      withoutPreview: "A general marketing message without this context.",
      withPreview: "A preview will update after the draft instructions are reviewed.",
    })
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) reset(); onOpenChange(nextOpen) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sectionAction(section)}</DialogTitle>
          <DialogDescription>Add a source, then review what Otto extracts before anything is saved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="context-name">Name</Label>
            <Input id="context-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={`Name this ${sectionLabel(section).toLowerCase()}`} />
          </div>
          <Tabs value={sourceKind} onValueChange={(value) => { setSourceKind(value as SourceKind); setSourceValue("") }}>
            <TabsList className="w-full transition-none">
              <TabsTrigger value="text" className="transition-none"><FileText aria-hidden />Text</TabsTrigger>
              <TabsTrigger value="url" className="transition-none"><Globe2 aria-hidden />URL</TabsTrigger>
              <TabsTrigger value="file" className="transition-none"><Upload aria-hidden />File</TabsTrigger>
            </TabsList>
          </Tabs>
          {sourceKind === "text" ? (
            <div className="space-y-2"><Label htmlFor="source-text">Source text</Label><Textarea id="source-text" value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} placeholder="Paste the material Otto should learn from" /></div>
          ) : null}
          {sourceKind === "url" ? (
            <div className="space-y-2"><Label htmlFor="source-url">Source URL</Label><Input id="source-url" type="url" value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} placeholder="https://" /></div>
          ) : null}
          {sourceKind === "file" ? (
            <div className="space-y-2"><Label htmlFor="source-file">Choose file</Label><Input id="source-file" type="file" onChange={(event) => setSourceValue(event.target.files?.[0]?.name ?? "")} /></div>
          ) : null}
          <p className="text-xs text-muted-foreground">Preview only. This creates a session draft and does not change persistent Otto context.</p>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name.trim() || !sourceValue.trim()} onClick={createDraft}>Review draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BrandReference({ initialSection = "brand-voice" }: { initialSection?: BrandSectionKey }) {
  const [section, setSection] = React.useState<BrandSectionKey>(initialSection)
  const [recordsBySection, setRecordsBySection] = React.useState(BRAND_CONTEXT_FIXTURES)
  const [selectedIds, setSelectedIds] = React.useState<Record<BrandSectionKey, string>>(() => Object.fromEntries(
    BRAND_SECTIONS.map((item) => [item.key, BRAND_CONTEXT_FIXTURES[item.key][0]?.id ?? ""]),
  ) as Record<BrandSectionKey, string>)
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)

  React.useEffect(() => {
    const syncFromRoute = () => {
      const next = new URL(window.location.href).searchParams.get("section") ?? undefined
      if (isBrandSectionKey(next)) setSection(next)
    }
    window.addEventListener("popstate", syncFromRoute)
    return () => window.removeEventListener("popstate", syncFromRoute)
  }, [])

  const records = recordsBySection[section]
  const selected = records.find((record) => record.id === selectedIds[section]) ?? records[0]

  function chooseSection(nextSection: BrandSectionKey) {
    setSection(nextSection)
    updateSectionRoute(nextSection)
  }

  function addDraft(record: ContextRecord) {
    setRecordsBySection((current) => ({ ...current, [section]: [record, ...current[section]] }))
    setSelectedIds((current) => ({ ...current, [section]: record.id }))
  }

  return (
    <div className="gb min-h-dvh bg-background text-foreground">
      <OttoPanelFlowReference founderName={REVIEW_ACCOUNT.displayName} recommendedPrompt={`Help me improve my ${sectionLabel(section).toLowerCase()}.`}>
        <ProductPatternShellFrame
          pathname={SHELL_ROUTES.brand}
        >
          <main className="flex h-[calc(100dvh-2.75rem)] min-w-0 flex-col overflow-hidden bg-background">
            <header className="shrink-0 border-b border-border px-7 pt-6">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h1 className="text-2xl font-semibold tracking-[-0.03em]">{sectionLabel(section)}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">{SECTION_DESCRIPTIONS[section]}</p>
                </div>
                <Button data-add-context size="sm" onClick={() => setAddOpen(true)}><Plus aria-hidden />{sectionAction(section)}</Button>
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

            <div className="flex min-h-0 flex-1">
              <ContextList label={section === "brand-voice" ? "Brand voices" : sectionLabel(section)} records={records} selectedId={selected?.id ?? ""} onSelect={(id) => setSelectedIds((current) => ({ ...current, [section]: id }))} />
              {selected ? (
                <section className="min-w-0 flex-1 overflow-y-auto px-8 py-7" aria-labelledby="context-title">
                  <div className="mx-auto max-w-3xl">
                    <div className="flex items-start justify-between gap-6">
                      <div className="flex min-w-0 items-start gap-3">
                        <Image aria-hidden alt="" src={STATUS_ART[selected.status]} width={44} height={40} className="mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 id="context-title" className="text-xl font-semibold tracking-[-0.025em]">{selected.name}</h2>
                            <StatusBadge status={selected.status} />
                          </div>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{selected.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" disabled={selected.status === "Processing"} onClick={() => setPreviewOpen(true)}><Eye aria-hidden />Preview effect</Button>
                        <Button variant="secondary" size="icon-sm" aria-label="More context actions" onClick={() => toast.info("Editing actions are outside this review fixture.")}><MoreHorizontal aria-hidden /></Button>
                      </div>
                    </div>
                    <DetailAccordion record={selected} />
                  </div>
                </section>
              ) : null}
            </div>

            {selected ? <PreviewDialog record={selected} open={previewOpen} onOpenChange={setPreviewOpen} /> : null}
            <AddContextDialog section={section} open={addOpen} onOpenChange={setAddOpen} onCreate={addDraft} />
          </main>
        </ProductPatternShellFrame>
      </OttoPanelFlowReference>
    </div>
  )
}
