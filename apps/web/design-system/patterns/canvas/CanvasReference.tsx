"use client"

import Image, { type StaticImageData } from "next/image"
import * as React from "react"
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyPlusIcon,
  DownloadIcon,
  FilmIcon,
  FrameIcon,
  HandIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  MousePointer2Icon,
  Redo2Icon,
  Share2Icon,
  Trash2Icon,
  Undo2Icon,
  WandSparklesIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"

import { FikirtiveMark } from "@/design-system/brand/components/FikirtiveMark"
import { OttoAvatar } from "@/design-system/brand/components/OttoAvatar"
import { Badge } from "@/design-system/primitives/badge"
import { Button } from "@/design-system/primitives/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/design-system/primitives/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/design-system/primitives/popover"
import { Spinner } from "@/design-system/primitives/spinner"
import { toast } from "@/design-system/primitives/toast"
import { cn } from "@/lib/utils"

import bottleVideoFrame from "./assets/blue-bottle-video-frame.png"
import giftBoxImage from "./assets/gift-box-portrait.png"
import { CreationComposer } from "./CreationComposer"
import { DEFAULT_PROMPT } from "./fixtures"
import { autoNameProject, inferGenerationKind, type GenerationKind } from "./model"
import { CREATE_WORKSPACE_REVIEW_HREF } from "./review-links"

type CanvasTool = "select" | "frame" | "hand" | "media"
type TurnStatus = "needs-answer" | "needs-confirmation" | "queued" | "working" | "done" | "failed" | "cancelled" | "confirming-status"

type Artifact = {
  id: string
  kind: GenerationKind
  name: string
  version: number
  status: "generating" | "ready" | "failed"
  credits: number
  treatment: number
  x: number
  y: number
  width: number
  height: number
  sourceId?: string
}

type BoardNote = {
  id: string
  kind: "sticky" | "reference"
  x: number
  y: number
  width: number
}

type CreationTurn = {
  id: string
  prompt: string
  response: string
  kind: GenerationKind
  status: TurnStatus
  credits: number
  outputCount: number
  spec: string
  reference?: string
  resultIds?: string[]
  questionStep?: number
  answers?: string[]
}

type PointerSession =
  | { type: "node"; pointerId: number; nodeType: "artifact" | "note"; nodeId: string; startX: number; startY: number; originX: number; originY: number }
  | { type: "pan"; pointerId: number; startX: number; startY: number; originX: number; originY: number }

const TREATMENTS = [
  "saturate(1.02) contrast(1.01)",
  "saturate(.82) contrast(1.08) brightness(.96)",
  "sepia(.12) saturate(1.15)",
  "hue-rotate(8deg) saturate(.9)",
  "contrast(1.12) brightness(1.04)",
  "saturate(.72) brightness(1.08)",
]

const INITIAL_ARTIFACTS: Artifact[] = [
  { id: "gift-box-v1", kind: "image", name: "Warm editorial", version: 1, status: "ready", credits: 2, treatment: 0, x: 385, y: 225, width: 134, height: 235 },
  { id: "gift-box-v2", kind: "image", name: "Muted product", version: 2, status: "ready", credits: 2, treatment: 1, x: 537, y: 225, width: 134, height: 235, sourceId: "gift-box-v1" },
  { id: "gift-box-v3", kind: "image", name: "Festive warmth", version: 3, status: "ready", credits: 2, treatment: 2, x: 689, y: 225, width: 134, height: 235, sourceId: "gift-box-v1" },
  { id: "gift-box-v4", kind: "image", name: "Bright gifting", version: 4, status: "ready", credits: 2, treatment: 4, x: 841, y: 225, width: 134, height: 235, sourceId: "gift-box-v1" },
]

const INITIAL_NOTES: BoardNote[] = [
  { id: "creative-note", kind: "sticky", x: 80, y: 260, width: 190 },
  { id: "page-reference", kind: "reference", x: 1168, y: 70, width: 250 },
]

const INITIAL_TURNS: CreationTurn[] = [
  { id: "turn-initial", prompt: DEFAULT_PROMPT, response: "I created four starting directions. Select any one to edit, vary or animate it.", kind: "image", status: "done", credits: 8, outputCount: 4, spec: "Portrait · 4:5 · Brand and product photo", resultIds: ["gift-box-v1", "gift-box-v2", "gift-box-v3", "gift-box-v4"] },
  { id: "turn-status-check", prompt: "Check the status of the interrupted render", response: "I’m confirming the original generation before allowing another charge.", kind: "image", status: "confirming-status", credits: 0, outputCount: 1, spec: "Original action only · No duplicate charge" },
  { id: "turn-failed", prompt: "Try the night-market background", response: "That generation failed and the 2 credits were returned.", kind: "image", status: "failed", credits: 0, outputCount: 1, spec: "Portrait · 4:5 · Credits returned" },
]

const STATUS_META: Record<TurnStatus, { label: string; dot: string }> = {
  "needs-answer": { label: "Needs answer", dot: "bg-warning" },
  "needs-confirmation": { label: "Needs confirmation", dot: "bg-brand" },
  queued: { label: "Queued", dot: "bg-muted-foreground" },
  working: { label: "Working", dot: "bg-brand" },
  done: { label: "Done", dot: "bg-success" },
  failed: { label: "Failed", dot: "bg-destructive" },
  cancelled: { label: "Cancelled", dot: "bg-muted-foreground" },
  "confirming-status": { label: "Confirming status", dot: "bg-warning" },
}

const QUESTION_STEPS = [
  {
    eyebrow: "Lead product · Required",
    title: "Which product should lead this concept?",
    help: "Otto found more than one valid direction. Choose one so the result stays specific.",
    options: [
      ["Teal batik candle", "Use the strongest Raya visual cue"],
      ["Pandan gift set", "Lead with gifting and product value"],
      ["Use both", "Create a paired-product hero"],
    ],
  },
  {
    eyebrow: "Deliverables · Required",
    title: "Which format should Otto prepare first?",
    help: "The other formats can be created as non-destructive versions later.",
    options: [
      ["Instagram Story", "9:16 vertical concept"],
      ["Feed post", "1:1 single-image concept"],
      ["Portrait post", "4:5 campaign concept"],
    ],
  },
] as const

function buildRequestTurn({
  id,
  prompt,
  kind,
  reference,
  hasWorkingTurn = false,
}: {
  id: string
  prompt: string
  kind: GenerationKind
  reference?: string
  hasWorkingTurn?: boolean
}): CreationTurn {
  const needsVideoSource = kind === "video" && !reference
  const needsCreativeDecision = /premium|luxury|better|polished|surprise|audience|offer|goal|outcome|channel|format|schedule|when|deliverable/i.test(prompt)
  const needsAnswer = !hasWorkingTurn && (needsVideoSource || needsCreativeDecision)

  return {
    id,
    prompt,
    response: hasWorkingTurn
      ? "Queued behind the generation already in progress. You can keep working on the Canvas."
      : needsAnswer
        ? "There are two valid directions, so I need the decisions that change the result before I quote it."
        : "I have enough context. Review the exact output and cost before anything paid starts.",
    kind,
    status: hasWorkingTurn ? "queued" : needsAnswer ? "needs-answer" : "needs-confirmation",
    credits: kind === "video" ? 20 : 2,
    outputCount: 1,
    spec: kind === "video" ? "Landscape · 16:9 · 6 seconds" : "Portrait · 4:5 · One direction",
    reference,
    questionStep: needsAnswer ? 0 : undefined,
    answers: needsAnswer ? [] : undefined,
  }
}

function Media({ kind, treatment = 0 }: { kind: GenerationKind; treatment?: number }) {
  const source: StaticImageData = kind === "video" ? bottleVideoFrame : giftBoxImage
  return <Image alt={kind === "video" ? "Blue bottle launch video preview" : "Merdeka gift-box generation"} className="object-cover" fill loading="eager" sizes="420px" src={source} style={{ filter: TREATMENTS[treatment % TREATMENTS.length] }} />
}

function CanvasSurface({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[var(--radius-card)] border border-border bg-background/96 shadow-[var(--shadow-sm)] backdrop-blur",
        className,
      )}
      {...props}
    />
  )
}

function ShareView() {
  return (
    <main className="gb min-h-dvh bg-muted/40 px-5 py-8 text-foreground">
      <div className="mx-auto max-w-md">
        <header className="flex items-center justify-between"><div className="flex items-center gap-2 font-semibold"><FikirtiveMark size={28} /> Merdeka launch</div><Badge variant="outline">View only</Badge></header>
        <div className="mt-10"><p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Selected work</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">Warm gift-box hero</h1><p className="mt-2 text-sm text-muted-foreground">Prompts, history and private references are not included in this share link.</p></div>
        <article className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-md)]">
          <div className="relative aspect-[4/5] bg-muted"><Media kind="image" /></div>
          <div className="flex items-center justify-between p-4"><div><h2 className="font-semibold">Merdeka launch</h2><p className="text-xs text-muted-foreground">Image · Version 2</p></div><Badge variant="success"><CheckIcon /> Ready</Badge></div>
        </article>
        <footer className="mt-6 text-center text-xs text-muted-foreground">This unlisted link can be revoked by its owner.</footer>
      </div>
    </main>
  )
}

function CurrentTurn({ turn, onAnswer, onCustomAnswer, onConfirm, onCancel }: {
  turn: CreationTurn
  onAnswer: (answer: string) => void
  onCustomAnswer: () => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const status = STATUS_META[turn.status]
  const question = QUESTION_STEPS[Math.min(turn.questionStep ?? 0, QUESTION_STEPS.length - 1)]
  const costTruth = turn.status === "needs-answer"
    ? "Waiting costs 0 credits"
    : turn.status === "needs-confirmation"
      ? "Nothing paid starts before confirmation"
      : turn.status === "confirming-status"
        ? "No duplicate charge"
        : turn.status === "cancelled"
          ? "0 credits charged"
          : turn.status === "failed"
            ? "Credits returned"
            : turn.status === "queued"
              ? "Waiting to start"
              : turn.status === "working"
                ? "Confirmed once"
                : "Charged once"
  const truthIcon = turn.status === "working" || turn.status === "queued" || turn.status === "confirming-status"
    ? <Spinner className="text-brand" />
    : turn.status === "failed"
      ? <CircleAlertIcon className="size-3.5 text-destructive" />
      : turn.status === "cancelled"
        ? <XIcon className="size-3.5 text-muted-foreground" />
        : <CheckIcon className="size-3.5 text-success" />
  return <CanvasSurface aria-label="Otto current turn" className="pointer-events-auto w-[280px]">
    <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
      <div className="flex items-center gap-2"><OttoAvatar mood={turn.status === "working" ? "thinking" : turn.status === "failed" ? "error" : "helpful"} size={22} /><span className="text-xs font-semibold">Otto</span></div>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("size-1.5 rounded-full", status.dot)} />{status.label}</span>
    </div>
    <div className="px-3 py-3">
      <p className="text-sm leading-5">{turn.response}</p>
      {turn.status === "needs-answer" ? <div className="mt-3">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{question.eyebrow}</span><span>{(turn.questionStep ?? 0) + 1}/{QUESTION_STEPS.length}</span></div>
        <h2 className="mt-1.5 text-sm font-semibold leading-5">{question.title}</h2>
        <div className="mt-2 grid gap-1.5">{question.options.map(([label]) => <Button className="h-auto w-full justify-start px-2.5 py-2 text-left" key={label} size="xs" variant="outline" onClick={() => onAnswer(label)}>{label}</Button>)}<Button className="h-auto w-full justify-start px-2.5 py-1.5 text-left font-normal text-muted-foreground" size="xs" variant="ghost" onClick={onCustomAnswer}>Something else…</Button></div>
        <div className="mt-2 flex items-center justify-between"><span className="text-xs text-muted-foreground">0 credits while waiting</span><Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button></div>
      </div> : null}
      {turn.status === "needs-confirmation" ? <div aria-label="Generation confirmation" className="mt-3 border-t border-border pt-3">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium">{turn.outputCount} {turn.kind}{turn.outputCount > 1 ? "s" : ""}</p><p className="mt-0.5 text-xs leading-4 text-muted-foreground">{turn.spec}</p></div><strong className="shrink-0 text-sm">{turn.credits} credits</strong></div>
        {turn.reference ? <p className="mt-2 truncate rounded-[var(--radius)] bg-muted px-2 py-1.5 text-xs text-muted-foreground">Using {turn.reference}</p> : null}
        <div className="mt-3 flex justify-end gap-1.5"><Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button><Button size="xs" variant="otto" onClick={onConfirm}>Generate · {turn.credits} credits</Button></div>
      </div> : null}
      {turn.status !== "needs-answer" && turn.status !== "needs-confirmation" ? <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">{truthIcon}<span>{costTruth}</span></div> : null}
    </div>
  </CanvasSurface>
}

function Conversation({ open, turns, activeTurnId, onOpenChange, setActiveTurnId }: {
  open: boolean
  turns: CreationTurn[]
  activeTurnId: string
  onOpenChange: (open: boolean) => void
  setActiveTurnId: (id: string) => void
}) {
  const chronologicalTurns = [...turns].reverse()
  return <CanvasSurface className="pointer-events-auto w-[280px]">
    {open && <div className="max-h-[260px] overflow-y-auto border-b border-border p-1.5">{chronologicalTurns.map((turn) => { const meta = STATUS_META[turn.status]; return <Button aria-current={turn.id === activeTurnId ? "true" : undefined} className={cn("h-auto w-full justify-start rounded-[var(--radius)] px-2.5 py-2 text-left font-normal", turn.id === activeTurnId && "bg-accent")} key={turn.id} variant="ghost" onClick={() => setActiveTurnId(turn.id)}><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} /><span className="min-w-0 flex-1 truncate text-xs font-medium">{turn.prompt}</span><span className="text-xs text-muted-foreground">{meta.label}</span></span><span className="mt-1 line-clamp-1 block pl-3.5 text-xs text-muted-foreground">{turn.response}</span>{turn.answers?.length ? <span className="mt-1 block truncate pl-3.5 text-xs text-muted-foreground">{turn.answers.join(" · ")}</span> : null}</span></Button> })}</div>}
    <Button aria-expanded={open} className="h-10 w-full justify-between rounded-none px-3 text-xs" motion="instant" variant="ghost" onClick={() => onOpenChange(!open)}><span className="flex items-center gap-2"><span>Conversation</span><span className="text-xs text-muted-foreground">{turns.length}</span></span><ChevronDownIcon className={cn("size-3.5 text-muted-foreground transition-transform duration-[var(--dur-2)] ease-[var(--ease-out)] motion-reduce:transition-none", open && "rotate-180")} /></Button>
  </CanvasSurface>
}

function BoardNoteCard({ note, activeTool, onPointerDown, onPointerMove, onPointerUp }: {
  note: BoardNote
  activeTool: CanvasTool
  onPointerDown: (event: React.PointerEvent<HTMLElement>, nodeType: "note", node: BoardNote) => void
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void
}) {
  return <article data-canvas-node data-node-kind={note.kind} className={cn("absolute touch-none select-none rounded-[var(--radius-card)] border border-border p-4 shadow-[var(--shadow-sm)]", note.kind === "sticky" ? "bg-warning-soft" : "bg-card", activeTool === "select" ? "cursor-grab active:cursor-grabbing" : "cursor-default")} style={{ left: note.x, top: note.y, width: note.width }} onPointerDown={(event) => onPointerDown(event, "note", note)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    {note.kind === "sticky" ? <><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sticky · free</p><p className="mt-2 text-sm leading-5">Teal + gold table set. Try one flat-lay, one lifestyle shot.</p></> : <><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Extracted from your page</p><code className="mt-2 block text-xs text-muted-foreground">harvestcandle.co / raya-collection</code><p className="mt-2 text-sm leading-5">Four scents inspired by Raya mornings — teal batik, gold thread, warm oud, and pandan light.</p></>}
  </article>
}

function ArtifactCard({ artifact, selected, activeTool, zoom, onPointerDown, onPointerMove, onPointerUp, onSelect, startEditWithOtto, startVariations, startAnimation, onRemove }: {
  artifact: Artifact
  selected: boolean
  activeTool: CanvasTool
  zoom: number
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, artifact: Artifact) => void
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
  onSelect: (event: React.MouseEvent, id: string) => void
  startEditWithOtto: (artifact: Artifact) => void
  startVariations: (artifact: Artifact, count: number) => void
  startAnimation: (artifact: Artifact) => void
  onRemove: (id: string) => void
}) {
  return <div data-canvas-artifact data-canvas-node data-node-kind={artifact.kind} className={cn("absolute touch-none select-none", activeTool === "select" ? "cursor-grab active:cursor-grabbing" : "cursor-default")} style={{ left: artifact.x, top: artifact.y, width: artifact.width, height: artifact.height }} onClick={(event) => onSelect(event, artifact.id)} onPointerDown={(event) => onPointerDown(event, artifact)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    {selected && artifact.status === "ready" && <div className="absolute -top-12 left-1/2 z-20 flex items-center gap-1 rounded-[var(--radius-card)] border border-border bg-background p-1 shadow-[var(--shadow-md)]" style={{ transform: `translateX(-50%) scale(${1 / zoom})`, transformOrigin: "bottom center" }}>
      <Button aria-label="Edit with Otto" size="icon-xs" variant="ghost" onClick={(event) => { event.stopPropagation(); startEditWithOtto(artifact) }}><WandSparklesIcon /></Button>
      <Popover><PopoverTrigger asChild><Button aria-label="Create variations" size="icon-xs" variant="ghost" onClick={(event) => event.stopPropagation()}><CopyPlusIcon /></Button></PopoverTrigger><PopoverContent className="w-52" side="top"><p className="text-xs font-semibold">Create variations</p><div className="mt-2 grid grid-cols-3 gap-1.5">{[2, 3, 4].map((count) => <Button key={count} size="xs" variant={count === 2 ? "default" : "secondary"} onClick={() => startVariations(artifact, count)}>{count}</Button>)}</div><p className="mt-2 text-xs text-muted-foreground">2 credits each</p></PopoverContent></Popover>
      {artifact.kind === "image" && <Button aria-label="Animate" size="icon-xs" variant="ghost" onClick={(event) => { event.stopPropagation(); startAnimation(artifact) }}><FilmIcon /></Button>}
      <Button aria-label="Download" size="icon-xs" variant="ghost" onClick={(event) => { event.stopPropagation(); toast.success("Download ready") }}><DownloadIcon /></Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button aria-label="More actions" size="icon-xs" variant="ghost" onClick={(event) => event.stopPropagation()}><MoreHorizontalIcon /></Button></DropdownMenuTrigger><DropdownMenuContent side="top"><DropdownMenuItem onSelect={() => window.location.assign("/product-patterns/canvas?share=selected")}><Share2Icon /> Share selected output</DropdownMenuItem><DropdownMenuItem onSelect={() => toast.success("Copied to project")}><CopyPlusIcon /> Duplicate</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => onRemove(artifact.id)}><Trash2Icon /> Remove from canvas</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </div>}
    <article className={cn("relative h-full w-full overflow-hidden rounded-[var(--radius-card)] border bg-card shadow-[var(--shadow-md)]", selected ? "border-foreground ring-2 ring-foreground/15" : "border-border", artifact.status === "generating" && "border-brand/40")}>
      <div className="relative h-[calc(100%-42px)] overflow-hidden bg-muted"><Media kind={artifact.kind} treatment={artifact.treatment} />{artifact.kind === "video" && artifact.status === "ready" && <span className="absolute left-2 top-2 rounded-[var(--radius)] bg-foreground/80 px-2 py-1 text-xs font-medium text-background">00:06</span>}{artifact.status === "generating" && <div className="absolute inset-0 grid place-items-center bg-background/75 backdrop-blur-sm"><div className="text-center"><LoaderCircleIcon className="mx-auto size-5 animate-spin text-brand" /><p className="mt-2 text-xs font-semibold">Generating {artifact.kind}…</p></div></div>}{artifact.status === "failed" && <div className="absolute inset-0 grid place-items-center bg-background/85"><div className="text-center text-xs"><CircleAlertIcon className="mx-auto mb-2 size-5 text-destructive" />Generation failed</div></div>}</div>
      <footer className="flex h-[42px] items-center justify-between px-3 text-xs"><span className="truncate font-medium">{artifact.name}</span><span className="ml-2 shrink-0 text-muted-foreground">v{artifact.version}</span></footer>
    </article>
  </div>
}

type WorkspaceProps = {
  projectName: string
  prompt: string
  reference?: string
  turns: CreationTurn[]
  artifacts: Artifact[]
  notes: BoardNote[]
  activeTurnId: string
  selectedArtifactIds: string[]
  activeTool: CanvasTool
  pan: { x: number; y: number }
  zoom: number
  agentLogOpen: boolean
  composerRef: React.RefObject<HTMLTextAreaElement | null>
  pointerSessionRef: React.MutableRefObject<PointerSession | null>
  onHome: () => void
  onPromptChange: (value: string) => void
  onReferenceChange: (value?: string) => void
  onSubmit: () => void
  onAnswer: (answer: string) => void
  onConfirm: () => void
  onCancel: () => void
  setActiveTurnId: (id: string) => void
  setSelectedArtifactIds: React.Dispatch<React.SetStateAction<string[]>>
  setActiveTool: (tool: CanvasTool) => void
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
  setZoom: React.Dispatch<React.SetStateAction<number>>
  setAgentLogOpen: (open: boolean) => void
  setArtifacts: React.Dispatch<React.SetStateAction<Artifact[]>>
  setNotes: React.Dispatch<React.SetStateAction<BoardNote[]>>
  startEditWithOtto: (artifact: Artifact) => void
  startVariations: (artifact: Artifact, count: number) => void
  startAnimation: (artifact: Artifact) => void
}

function CanvasWorkspace(props: WorkspaceProps) {
  const { projectName, prompt, reference, turns, artifacts, notes, activeTurnId, selectedArtifactIds, activeTool, pan, zoom, agentLogOpen, composerRef, pointerSessionRef, onHome, onPromptChange, onReferenceChange, onSubmit, onAnswer, onConfirm, onCancel, setActiveTurnId, setSelectedArtifactIds, setActiveTool, setPan, setZoom, setAgentLogOpen, setArtifacts, setNotes, startEditWithOtto, startVariations, startAnimation } = props
  const activeTurn = turns.find((turn) => turn.id === activeTurnId) ?? turns[0]
  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactIds.at(-1))

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || (activeTool !== "hand" && event.button !== 1)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerSessionRef.current = { type: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y }
  }
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current
    if (!session || session.type !== "pan" || session.pointerId !== event.pointerId) return
    setPan({ x: session.originX + event.clientX - session.startX, y: session.originY + event.clientY - session.startY })
  }
  const beginNodeDrag = (event: React.PointerEvent<HTMLElement>, nodeType: "artifact" | "note", node: Artifact | BoardNote) => {
    if (!event.isPrimary || activeTool !== "select") return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerSessionRef.current = { type: "node", pointerId: event.pointerId, nodeType, nodeId: node.id, startX: event.clientX, startY: event.clientY, originX: node.x, originY: node.y }
  }
  const moveNode = (event: React.PointerEvent<HTMLElement>) => {
    const session = pointerSessionRef.current
    if (!session || session.type !== "node" || session.pointerId !== event.pointerId) return
    const nextX = session.originX + (event.clientX - session.startX) / zoom
    const nextY = session.originY + (event.clientY - session.startY) / zoom
    if (session.nodeType === "artifact") setArtifacts((current) => current.map((item) => item.id === session.nodeId ? { ...item, x: nextX, y: nextY } : item))
    else setNotes((current) => current.map((item) => item.id === session.nodeId ? { ...item, x: nextX, y: nextY } : item))
  }
  const endPointerSession = (event: React.PointerEvent<HTMLElement>) => {
    if (pointerSessionRef.current?.pointerId === event.pointerId) pointerSessionRef.current = null
  }

  return <div className="relative h-dvh min-h-[700px] overflow-hidden bg-muted/35 text-foreground">
    <header className="absolute inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/95 px-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2"><Button aria-label="Back to Create" size="icon-sm" variant="ghost" onClick={onHome}><ArrowLeftIcon /></Button><Button className="min-w-0 gap-1 px-2" size="xs" variant="ghost">{projectName}<ChevronDownIcon className="size-3.5 text-muted-foreground" /></Button><span className="hidden text-xs text-muted-foreground sm:inline">Saved just now</span></div>
      <span className="absolute left-1/2 -translate-x-1/2 text-xs text-muted-foreground">Prototype · sample data · Review fixture only</span>
      <div className="size-8" aria-hidden="true" />
    </header>

    <div aria-label="Canvas board" className={cn("absolute inset-x-0 bottom-0 top-14 overflow-hidden touch-none", activeTool === "hand" ? "cursor-grab active:cursor-grabbing" : "cursor-default")} style={{ backgroundImage: "radial-gradient(circle, color-mix(in oklab, var(--border) 70%, transparent) 1px, transparent 1px)", backgroundSize: "20px 20px" }} onClick={(event) => { if (event.target === event.currentTarget) setSelectedArtifactIds([]) }} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPointerSession} onPointerCancel={endPointerSession}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {notes.map((note) => <BoardNoteCard key={note.id} note={note} activeTool={activeTool} onPointerDown={beginNodeDrag} onPointerMove={moveNode} onPointerUp={endPointerSession} />)}
        {artifacts.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} activeTool={activeTool} selected={selectedArtifactIds.includes(artifact.id)} zoom={zoom} onPointerDown={(event, node) => beginNodeDrag(event, "artifact", node)} onPointerMove={moveNode} onPointerUp={endPointerSession} onSelect={(event, id) => setSelectedArtifactIds((current) => event.shiftKey ? (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) : [id])} startEditWithOtto={startEditWithOtto} startVariations={startVariations} startAnimation={startAnimation} onRemove={(id) => { setArtifacts((current) => current.filter((artifact) => artifact.id !== id)); setSelectedArtifactIds((current) => current.filter((item) => item !== id)); toast.success("Removed from canvas · generation stays in Library") }} />)}
      </div>
    </div>

    <div className="pointer-events-none absolute left-4 top-[72px] z-30"><CurrentTurn turn={activeTurn} onAnswer={onAnswer} onCustomAnswer={() => composerRef.current?.focus()} onConfirm={onConfirm} onCancel={onCancel} /></div>
    <div className="pointer-events-none absolute bottom-4 left-4 z-30"><Conversation open={agentLogOpen} turns={turns} activeTurnId={activeTurnId} onOpenChange={setAgentLogOpen} setActiveTurnId={setActiveTurnId} /></div>
    <div className="pointer-events-none absolute bottom-4 left-[300px] right-[160px] z-30 flex justify-center"><div className="pointer-events-auto w-full max-w-[620px]"><CreationComposer inputRef={composerRef} prompt={prompt} reference={reference} placeholder={activeTurn.status === "needs-answer" ? "Answer Otto" : undefined} selectedContext={selectedArtifact ? { label: selectedArtifact.name, meta: "Selected context", preview: <span className="relative size-7 overflow-hidden rounded"><Media kind={selectedArtifact.kind} treatment={selectedArtifact.treatment} /></span> } : undefined} onPromptChange={onPromptChange} onReferenceChange={onReferenceChange} onSubmit={onSubmit} /></div></div>

    <div className="absolute right-4 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-background p-1 shadow-[var(--shadow-sm)]">{([["select", MousePointer2Icon, "Select"], ["frame", FrameIcon, "Frame select"], ["hand", HandIcon, "Pan canvas"]] as const).map(([tool, Icon, label]) => <Button aria-label={label} aria-pressed={activeTool === tool} key={tool} size="icon-sm" variant={activeTool === tool ? "secondary" : "ghost"} onClick={() => setActiveTool(tool)}><Icon /></Button>)}</div>
    <div className="absolute bottom-4 right-4 z-30 flex items-center gap-1 rounded-[var(--radius-card)] border border-border bg-background p-1 shadow-[var(--shadow-sm)]"><Button aria-label="Undo" size="icon-sm" variant="ghost" onClick={() => toast.info("Undo is available after your next Canvas change.")}><Undo2Icon /></Button><Button aria-label="Redo" size="icon-sm" variant="ghost" onClick={() => toast.info("Nothing to redo.")}><Redo2Icon /></Button><span className="mx-1 h-5 w-px bg-border" /><Button aria-label="Zoom out" size="icon-sm" variant="ghost" onClick={() => setZoom((value) => Math.max(.55, Number((value - .1).toFixed(2))))}><ZoomOutIcon /></Button><Button aria-label="Reset zoom" className="w-12 px-0" size="icon-sm" variant="ghost" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button><Button aria-label="Zoom in" size="icon-sm" variant="ghost" onClick={() => setZoom((value) => Math.min(1.5, Number((value + .1).toFixed(2))))}><ZoomInIcon /></Button></div>
  </div>
}

export function CanvasReference({
  shareMode = false,
  newProject = false,
  initialPrompt,
  initialMode = "image",
  initialContext,
  initialContextLabel,
}: {
  shareMode?: boolean
  newProject?: boolean
  initialPrompt?: string
  initialMode?: GenerationKind
  initialContext?: string
  initialContextLabel?: string
}) {
  const startingPrompt = initialPrompt?.trim() || DEFAULT_PROMPT
  const initialReference = initialContextLabel ?? initialContext
  const initialTurn = newProject
    ? buildRequestTurn({ id: "turn-home-entry", prompt: startingPrompt, kind: initialMode, reference: initialReference })
    : null
  const [projectName] = React.useState(() => newProject ? autoNameProject(startingPrompt) : "Merdeka launch")
  const [prompt, setPrompt] = React.useState("")
  const [reference, setReference] = React.useState<string | undefined>(initialReference)
  const [turns, setTurns] = React.useState<CreationTurn[]>(() => initialTurn ? [initialTurn] : INITIAL_TURNS)
  const [activeTurnId, setActiveTurnId] = React.useState(() => initialTurn?.id ?? INITIAL_TURNS[0].id)
  const [artifacts, setArtifacts] = React.useState<Artifact[]>(() => newProject ? [] : INITIAL_ARTIFACTS)
  const [notes, setNotes] = React.useState<BoardNote[]>(() => newProject ? [] : INITIAL_NOTES)
  const [selectedArtifactIds, setSelectedArtifactIds] = React.useState<string[]>([])
  const [activeTool, setActiveTool] = React.useState<CanvasTool>("select")
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  const [zoom, setZoom] = React.useState(1)
  const [agentLogOpen, setAgentLogOpen] = React.useState(false)
  const composerRef = React.useRef<HTMLTextAreaElement>(null)
  const pointerSessionRef = React.useRef<PointerSession | null>(null)
  const timersRef = React.useRef<number[]>([])
  const confirmedTurnIdsRef = React.useRef(new Set<string>())
  const turnSequenceRef = React.useRef(100)

  React.useEffect(() => () => timersRef.current.forEach((timer) => window.clearTimeout(timer)), [])
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing = target?.matches("input, textarea, [contenteditable=true]")
      if (event.key === "Escape") { setSelectedArtifactIds([]); setActiveTool("select") }
      if (!editing && (event.key === "Backspace" || event.key === "Delete") && selectedArtifactIds.length) { setArtifacts((current) => current.filter((artifact) => !selectedArtifactIds.includes(artifact.id))); setSelectedArtifactIds([]) }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectedArtifactIds])

  const activeTurn = turns.find((turn) => turn.id === activeTurnId) ?? turns[0]
  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactIds.at(-1))
  const addTurn = (turn: CreationTurn) => { setTurns((current) => [turn, ...current]); setActiveTurnId(turn.id) }

  const submitPrompt = () => {
    const value = prompt.trim()
    if (!value) return
    if (activeTurn.status === "needs-answer") {
      answerQuestion(value)
      setPrompt("")
      return
    }
    const hasWorkingTurn = turns.some((turn) => turn.status === "working")
    const kind = inferGenerationKind(value, selectedArtifact?.kind)
    turnSequenceRef.current += 1
    addTurn(buildRequestTurn({ id: `turn-${turnSequenceRef.current}`, prompt: value, kind, reference: selectedArtifact?.name ?? reference, hasWorkingTurn }))
    setPrompt("")
  }
  const answerQuestion = (answer: string) => setTurns((current) => current.map((turn) => {
    if (turn.id !== activeTurnId) return turn
    const answers = [...(turn.answers ?? []), answer]
    const step = turn.questionStep ?? 0
    if (step < QUESTION_STEPS.length - 1) return { ...turn, questionStep: step + 1, answers, response: "One more decision changes the deliverable before I can quote it." }
    return { ...turn, status: "needs-confirmation", answers, reference: answers.join(" · "), response: "Decisions saved. Review the exact cost before generating." }
  }))
  const cancelTurn = () => setTurns((current) => current.map((turn) => turn.id === activeTurnId ? { ...turn, status: "cancelled", response: "Cancelled before generation started." } : turn))

  const confirmGeneration = () => {
    if (activeTurn.status !== "needs-confirmation" || confirmedTurnIdsRef.current.has(activeTurn.id)) return
    confirmedTurnIdsRef.current.add(activeTurn.id)
    const source = selectedArtifact ?? (activeTurn.reference === "Use latest image" ? artifacts.at(-1) : artifacts.find((artifact) => artifact.name === activeTurn.reference))
    const count = Math.min(activeTurn.outputCount, 4)
    const occupiedRight = artifacts.reduce((right, artifact) => Math.max(right, artifact.x + artifact.width), 420)
    const baseX = source ? source.x + source.width + 32 : occupiedRight + 32
    const baseY = source ? source.y : 225
    const outputWidth = activeTurn.kind === "video" ? 300 : source?.width ?? 134
    const outputHeight = activeTurn.kind === "video" ? 188 : source?.height ?? 235
    const newArtifacts: Artifact[] = Array.from({ length: count }, (_, index) => ({ id: `${activeTurn.id}-artifact-${index}`, kind: activeTurn.kind, name: activeTurn.kind === "video" ? "Launch motion" : count > 1 ? `Direction ${index + 1}` : "Edited direction", version: source ? source.version + index + 1 : index + 1, status: "generating", credits: activeTurn.credits / count, treatment: source ? source.treatment + index + 1 : index, x: baseX + index * (outputWidth + 18), y: baseY, width: outputWidth, height: outputHeight, sourceId: source?.id }))
    const resultIds = newArtifacts.map((artifact) => artifact.id)
    setTurns((current) => current.map((turn) => turn.id === activeTurn.id ? { ...turn, status: "working", response: "I’m creating the confirmed outputs directly on the Canvas.", resultIds } : turn))
    setArtifacts((current) => [...current, ...newArtifacts]); setSelectedArtifactIds(resultIds.slice(0, 1))
    const timer = window.setTimeout(() => {
      setArtifacts((current) => current.map((artifact) => resultIds.includes(artifact.id) ? { ...artifact, status: "ready" } : artifact))
      let releasedQueue = false
      setTurns((current) => current.map((turn) => {
        if (turn.id === activeTurn.id) return { ...turn, status: "done", response: `${count} ${activeTurn.kind}${count > 1 ? "s are" : " is"} ready on the Canvas. The originals are unchanged.` }
        if (!releasedQueue && turn.status === "queued") { releasedQueue = true; return { ...turn, status: "needs-confirmation", response: "The previous generation is complete. Review this output and exact cost before it starts." } }
        return turn
      }))
    }, 1200)
    timersRef.current.push(timer)
  }
  const startEditWithOtto = (artifact: Artifact) => { setSelectedArtifactIds([artifact.id]); setPrompt(""); composerRef.current?.focus(); toast.info(`${artifact.name} added as context. Describe the change.`) }
   const startVariations = (artifact: Artifact, count: number) => { turnSequenceRef.current += 1; addTurn({ id: `turn-variations-${turnSequenceRef.current}`, prompt: `Create ${count} variations of ${artifact.name}`, response: "I’ll preserve the original and place every version beside it.", kind: artifact.kind, status: "needs-confirmation", credits: count * 2, outputCount: count, spec: `${artifact.kind === "image" ? "Portrait · 4:5" : "Landscape · 16:9"} · Balanced range · Composition and styling`, reference: artifact.name }); setSelectedArtifactIds([artifact.id]) }
   const startAnimation = (artifact: Artifact) => { turnSequenceRef.current += 1; addTurn({ id: `turn-animation-${turnSequenceRef.current}`, prompt: `Animate ${artifact.name}`, response: "I’ll create a new video beside the selected image. The original image stays unchanged.", kind: "video", status: "needs-confirmation", credits: 20, outputCount: 1, spec: "Landscape · 16:9 · 6 seconds · Gentle product reveal", reference: artifact.name }); setSelectedArtifactIds([artifact.id]) }

  if (shareMode) return <ShareView />
  return <main className="gb min-h-dvh bg-background text-foreground">
    <div className="grid min-h-dvh place-items-center px-6 text-center lg:hidden"><div className="max-w-sm"><FikirtiveMark className="mx-auto" size={42} /><h1 className="mt-5 text-2xl font-semibold">Open Creation on desktop</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">This spatial Canvas is designed for a desktop pointer and keyboard. Shared results remain mobile-friendly.</p></div></div>
    <div className="hidden lg:block"><CanvasWorkspace projectName={projectName} prompt={prompt} reference={reference} turns={turns} artifacts={artifacts} notes={notes} activeTurnId={activeTurnId} selectedArtifactIds={selectedArtifactIds} activeTool={activeTool} pan={pan} zoom={zoom} agentLogOpen={agentLogOpen} composerRef={composerRef} pointerSessionRef={pointerSessionRef} onHome={() => window.location.assign(CREATE_WORKSPACE_REVIEW_HREF)} onPromptChange={setPrompt} onReferenceChange={setReference} onSubmit={submitPrompt} onAnswer={answerQuestion} onConfirm={confirmGeneration} onCancel={cancelTurn} setActiveTurnId={setActiveTurnId} setSelectedArtifactIds={setSelectedArtifactIds} setActiveTool={setActiveTool} setPan={setPan} setZoom={setZoom} setAgentLogOpen={setAgentLogOpen} setArtifacts={setArtifacts} setNotes={setNotes} startEditWithOtto={startEditWithOtto} startVariations={startVariations} startAnimation={startAnimation} /></div>
  </main>
}
