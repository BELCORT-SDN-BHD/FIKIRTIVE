"use client";

/**
 * Canvas 主场 — GOAL §2 全表(Grok 创作画布手感,零后台)
 *
 * A1 三模式输入框 · A2 左 chat + 右无限画布 · A3 左栏 Search/Projects/History
 * B1 点阵画布 + pan + 缩放(40%–160%,滚轮) · B2 自动落位同带 · B3 生成中可选
 * C1 手柄/描边/拖动+对齐线 · C2 可寻址 + ☰prompt · C3 视频内嵌播放器 · C4 中间态
 * D1-D5 贴附工具条 + Type to imagine · E1 Make Video · F1 多选批量条 + Stitch
 * H0 命名思考子步骤 + ↑↔■ · H3/I1 并行生成四镜像 · J1 👍👎 · J2 @Image N
 * 边界 A:视频/批量花费确认 + 余额即时刷新;图直出(余额即闸)。
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowUp,
  Bot,
  ChevronDown,
  Copy,
  Crop,
  Download,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Menu,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  Scissors,
  Search,
  Square,
  Trash2,
  Video,
  Volume2,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useInsideImmersive } from "../immersive/_context";
import { MockNote } from "../_shared";
import { NS_BRAND } from "../_mock";
import {
  CV_HISTORY,
  CV_PROJECTS,
  CV_SEED_OBJECTS,
  CV_SEED_TURNS,
  CV_SESSIONS,
  nsPlaceholder,
  type CvChatTurn,
  type CvObject,
} from "./_fixtures";
import {
  FeedbackControls,
  InkNarrationPill,
  LAND_STYLE,
  SpendConfirmDialog,
  SWEEP_STYLE,
  useCreateKeyframes,
  type FeedbackValue,
} from "./_create-ui";

type Mode = "image" | "video" | "agent";
type SideTab = "chat" | "projects" | "history";

const VIDEO_COST = 40;
const IMAGE_COST = 12;
const CLIP_COUNT = 4;

interface GenJob {
  objectId: string;
  pct: number;
}

export function CanvasPage() {
  useCreateKeyframes();

  // 可寻址名计数(C2:Image 1/2… Video 1/2…)— 只在事件处理器里改
  const refCounter = React.useRef({ image: 3, video: 1 });
  const uidCounter = React.useRef(0);
  const nextUid = () => {
    uidCounter.current += 1;
    return uidCounter.current;
  };

  // ── 画布状态 ──
  const [objects, setObjects] = React.useState<CvObject[]>(CV_SEED_OBJECTS);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [guideY, setGuideY] = React.useState<number | null>(null);
  const [sweepId, setSweepId] = React.useState<string | null>(null);
  const [promptFor, setPromptFor] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [playingVideo, setPlayingVideo] = React.useState<string | null>(null);
  const [undoChip, setUndoChip] = React.useState<CvObject[] | null>(null);

  // ── 会话 / chat 状态 ──
  const [sessionId, setSessionId] = React.useState<string>(CV_SESSIONS[0].id);
  const [sessionMenu, setSessionMenu] = React.useState(false);
  const [turns, setTurns] = React.useState<CvChatTurn[]>(CV_SEED_TURNS);
  const [mode, setMode] = React.useState<Mode>("agent");
  const [draft, setDraft] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [streamSteps, setStreamSteps] = React.useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [feedback, setFeedback] = React.useState<Record<string, FeedbackValue>>({});
  const [sideTab, setSideTab] = React.useState<SideTab>("chat");
  const [sideSearch, setSideSearch] = React.useState("");
  // 沉浸式外壳内:壳级 240 导航已提供 New 与 History,画布 A3 栏收敛为「工作区上下文」
  // (Search + Chat 会话 + Projects),不再并列成第二条全局导航(蓝图 canvas double-rail 修法)。
  const insideImmersive = useInsideImmersive();

  // ── 生成 / 花费状态 ──
  const [balance, setBalance] = React.useState<number>(NS_BRAND.creditBalance);
  const [jobs, setJobs] = React.useState<GenJob[]>([]);
  const [narration, setNarration] = React.useState<string | null>(null);
  const [historyNew, setHistoryNew] = React.useState(0);
  const [spendAsk, setSpendAsk] = React.useState<
    | { kind: "make-video"; sourceId: string }
    | { kind: "evolve-video"; sourceId: string; prompt: string }
    | { kind: "agent-batch"; prompt: string }
    | null
  >(null);

  const timersRef = React.useRef<number[]>([]);
  React.useEffect(() => () => timersRef.current.forEach((t) => window.clearInterval(t)), []);

  const canvasRef = React.useRef<HTMLDivElement>(null);
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  // 滚轮 zoom(B1)— 非 passive 监听
  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(1.6, Math.max(0.4, z - Math.sign(e.deltaY) * 0.1)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Escape 剥一层(§N8):菜单 → prompt 卡 → 选区
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (sessionMenu) setSessionMenu(false);
      else if (mentionOpen) setMentionOpen(false);
      else if (promptFor) setPromptFor(null);
      else setSelected([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionMenu, mentionOpen, promptFor]);

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [turns, streamSteps]);

  const selectedObjects = objects.filter((o) => selected.includes(o.id));
  const singleSelected = selectedObjects.length === 1 ? selectedObjects[0] : null;
  const runningJobs = jobs.filter((j) => j.pct < 100);
  const avgPct = runningJobs.length
    ? Math.round(runningJobs.reduce((s, j) => s + j.pct, 0) / runningJobs.length)
    : 100;

  /* ── 生成引擎(定时器模拟;C4 中间态由 pct 段位渲染) ── */
  const startGeneration = React.useCallback(
    (newObjects: CvObject[], narrationText: string, onAllDone?: () => void) => {
      setObjects((prev) => [...prev, ...newObjects]);
      setJobs((prev) => [...prev, ...newObjects.map((o) => ({ objectId: o.id, pct: 0 }))]);
      setNarration(narrationText);
      newObjects.forEach((obj, i) => {
        const timer = window.setInterval(() => {
          setJobs((prev) => {
            const next = prev.map((j) =>
              j.objectId === obj.id ? { ...j, pct: Math.min(100, j.pct + 6 + i * 2) } : j,
            );
            const mine = next.find((j) => j.objectId === obj.id);
            if (mine && mine.pct >= 100) {
              window.clearInterval(timer);
              setObjects((os) => os.map((o) => (o.id === obj.id ? { ...o, status: "ready" } : o)));
              setSweepId(obj.id);
              window.setTimeout(() => setSweepId((s) => (s === obj.id ? null : s)), 650);
              setHistoryNew((n) => n + 1);
              const stillRunning = next.filter((j) => j.pct < 100).length;
              if (stillRunning === 0) {
                window.setTimeout(() => {
                  setNarration(null);
                  setJobs([]);
                }, 400);
                onAllDone?.();
              }
            }
            return next;
          });
        }, 220 + i * 60);
        timersRef.current.push(timer);
      });
    },
    [],
  );

  /* ── 就地进化(D3):图直出;视频过花费确认 ── */
  const evolveImage = (source: CvObject, prompt: string) => {
    refCounter.current.image += 1;
    const n = refCounter.current.image;
    const id = `cv-img-${n}-${nextUid()}`;
    setBalance((b) => b - IMAGE_COST); // 图直出:余额即闸,立即入账
    startGeneration(
      [
        {
          id,
          ref: `Image ${n}`,
          kind: "image",
          title: prompt.slice(0, 40),
          prompt,
          src: nsPlaceholder(`Image ${n}`, 640, 640, "pandan"),
          x: source.x + source.w + 56,
          y: source.y,
          w: source.w,
          h: source.h,
          status: "generating",
          parentId: source.id,
          credits: IMAGE_COST,
        },
      ],
      "Generating image…",
    );
  };

  const makeVideo = (source: CvObject, prompt: string) => {
    refCounter.current.video += 1;
    const n = refCounter.current.video;
    const id = `cv-vid-${n}-${nextUid()}`;
    setBalance((b) => b - VIDEO_COST); // 边界 A:确认后立即入账,余额即时刷新
    startGeneration(
      [
        {
          id,
          ref: `Video ${n}`,
          kind: "video",
          title: prompt.slice(0, 40),
          prompt,
          src: nsPlaceholder(`Video ${n}`, 360, 640, "video"),
          x: source.x + source.w + 56,
          y: source.y - 20,
          w: 168,
          h: 300,
          status: "generating",
          parentId: source.id,
          duration: 6,
          credits: VIDEO_COST,
        },
      ],
      "Generating video…",
    );
  };

  /* ── Agent 并行批量(H3):流式子步骤 → 花费确认 → 4 clip 落同带 ── */
  const runAgent = (text: string) => {
    setStreaming(true);
    setStreamSteps([]);
    const steps = ["Thinking", "Analyzing your brief", `Planning ${CLIP_COUNT} clips`];
    steps.forEach((s, i) => {
      const t = window.setTimeout(() => setStreamSteps((prev) => [...prev, s]), 700 * (i + 1));
      timersRef.current.push(t as unknown as number);
    });
    const done = window.setTimeout(() => {
      setStreaming(false);
      setTurns((prev) => [
        ...prev,
        {
          id: `t-${prev.length + 1}`,
          from: "otto",
          text: `I'll make ${CLIP_COUNT} clips for that. Total is ${CLIP_COUNT * VIDEO_COST} credits. Confirm to start.`,
          steps,
        },
      ]);
      setSpendAsk({ kind: "agent-batch", prompt: text });
    }, 700 * (steps.length + 1));
    timersRef.current.push(done as unknown as number);
  };

  const confirmAgentBatch = (prompt: string) => {
    setBalance((b) => b - CLIP_COUNT * VIDEO_COST);
    const bandY = 540;
    const clips: CvObject[] = Array.from({ length: CLIP_COUNT }, (_, i) => {
      refCounter.current.video += 1;
      const n = refCounter.current.video;
      return {
        id: `cv-vid-${n}-${nextUid()}`,
        ref: `Video ${n}`,
        kind: "video" as const,
        title: `${prompt.slice(0, 28)} · clip ${i + 1}`,
        prompt: `${prompt} — clip ${i + 1} of ${CLIP_COUNT}`,
        src: nsPlaceholder(`Clip ${i + 1}`, 360, 640, "video"),
        x: 40 + i * 196,
        y: bandY,
        w: 168,
        h: 300,
        status: "generating" as const,
        duration: 6,
        credits: VIDEO_COST,
      };
    });
    startGeneration(clips, `Generating ${CLIP_COUNT} clips…`, () => {
      setTurns((prev) => [
        ...prev,
        {
          id: `t-${prev.length + 1}`,
          from: "otto",
          text: `All ${CLIP_COUNT} clips are ready on the canvas. You approved this. It used ${CLIP_COUNT * VIDEO_COST} credits.`,
          objectIds: clips.map((c) => c.id),
        },
      ]);
    });
    setTurns((prev) => [
      ...prev,
      {
        id: `t-${prev.length + 1}`,
        from: "otto",
        text: `Generating ${CLIP_COUNT} clips in parallel. Each shows its own progress on the canvas.`,
        objectIds: clips.map((c) => c.id),
      },
    ]);
  };

  const send = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setTurns((prev) => [...prev, { id: `t-${prev.length + 1}`, from: "user", text }]);
    setDraft("");
    setMentionOpen(false);
    if (mode === "agent") {
      runAgent(text);
    } else if (mode === "image") {
      const source = singleSelected ?? objects.find((o) => o.kind === "image");
      if (source) evolveImage(source, text);
      setTurns((prev) => [
        ...prev,
        { id: `t-${prev.length + 1}`, from: "otto", text: "On it. The new image lands next to its source.", steps: ["Generating image"] },
      ]);
    } else {
      setSpendAsk({ kind: "evolve-video", sourceId: singleSelected?.id ?? objects[0].id, prompt: text });
    }
  };

  const stopStreaming = () => {
    setStreaming(false);
    setStreamSteps([]);
    setTurns((prev) => [...prev, { id: `t-${prev.length + 1}`, from: "otto", text: "Stopped. Nothing was charged." }]);
  };

  /* ── 对象拖动 + 对齐线(C1) ── */
  const dragState = React.useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(null);

  const onNodePointerDown = (e: React.PointerEvent, obj: CvObject) => {
    e.stopPropagation();
    if (e.shiftKey) {
      setSelected((prev) => (prev.includes(obj.id) ? prev.filter((s) => s !== obj.id) : [...prev, obj.id]));
      return;
    }
    if (!selected.includes(obj.id)) setSelected([obj.id]);
    dragState.current = { id: obj.id, startX: e.clientX, startY: e.clientY, ox: obj.x, oy: obj.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onNodePointerMove = (e: React.PointerEvent) => {
    const d = dragState.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    setObjects((prev) => {
      const me = prev.find((o) => o.id === d.id);
      if (!me) return prev;
      let ny = d.oy + dy;
      let guide: number | null = null;
      for (const o of prev) {
        if (o.id !== d.id && Math.abs(o.y - ny) < 8) {
          ny = o.y;
          guide = o.y;
          break;
        }
      }
      setGuideY(guide);
      return prev.map((o) => (o.id === d.id ? { ...o, x: d.ox + dx, y: ny } : o));
    });
  };

  const onNodePointerUp = () => {
    dragState.current = null;
    setGuideY(null);
  };

  /* ── 画布 pan(抓手) ── */
  const panState = React.useRef<{ startX: number; startY: number; px: number; py: number } | null>(null);

  const deleteObjects = (ids: string[]) => {
    const removed = objects.filter((o) => ids.includes(o.id));
    setObjects((prev) => prev.filter((o) => !ids.includes(o.id)));
    setSelected([]);
    setUndoChip(removed);
    window.setTimeout(() => setUndoChip((u) => (u === removed ? null : u)), 8000);
  };

  const mentionables = objects.filter((o) => o.status === "ready");
  const historyItems = CV_HISTORY.filter((h) => h.title.toLowerCase().includes(sideSearch.toLowerCase()));
  const exactlyTwoVideos = selectedObjects.length === 2 && selectedObjects.every((o) => o.kind === "video");

  return (
    <TooltipProvider>
    <div className="flex h-full min-h-0">
      {/* ── A3 左栏:Search / New generation / Chat / Projects / History ──
         沉浸式外壳内去掉硬右框、换极淡底色,读作 chat 的会话侧栏而非第二条导航 rail。 */}
      <aside
        className={cn(
          "flex w-56 shrink-0 flex-col",
          insideImmersive ? "bg-muted/40" : "border-r border-border",
        )}
      >
        <div className="flex flex-col gap-2 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={2} />
            <input
              value={sideSearch}
              onChange={(e) => setSideSearch(e.target.value)}
              placeholder="Search"
              className="h-9 w-full rounded-[10px] border border-input bg-card pr-2 pl-8 text-[13px] text-foreground shadow-[var(--shadow-xs)] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            />
          </div>
          <Button
            size="sm"
            variant={insideImmersive ? "outline" : "default"}
            className="w-full"
            onClick={() => setSelected([])}
          >
            <Plus className="size-4" strokeWidth={2.2} />
            New generation
          </Button>
        </div>
        <div className="flex gap-1 px-3">
          {/* 沉浸式外壳内隐藏 A3「History」页签 —— 壳级 HISTORY 已在;画布历史走 Library。 */}
          {((insideImmersive ? ["chat", "projects"] : ["chat", "projects", "history"]) as SideTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setSideTab(t);
                if (t === "history") setHistoryNew(0);
              }}
              className={cn(
                "relative h-8 flex-1 rounded-[10px] text-xs font-semibold capitalize transition-colors duration-[120ms]",
                sideTab === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t}
              {t === "history" && historyNew > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 font-mono text-[10px] leading-none font-medium text-brand-foreground tabular-nums">
                  {historyNew}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {sideTab === "chat" && (
            <div className="flex flex-col gap-1">
              {CV_SESSIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSessionId(s.id)}
                  className={cn(
                    "flex h-9 items-center rounded-[10px] px-3 text-left text-[13px] transition-colors duration-[120ms]",
                    sessionId === s.id
                      ? "bg-secondary font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="truncate">{s.name}</span>
                </button>
              ))}
            </div>
          )}
          {sideTab === "projects" && (
            <div className="flex flex-col gap-3">
              {CV_PROJECTS.map((p) => (
                <button key={p.id} type="button" className="group overflow-hidden rounded-[14px] border border-border bg-card text-left shadow-[var(--shadow-xs)] transition-shadow duration-[150ms] hover:shadow-[var(--shadow-md)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt="" className="aspect-[8/5] w-full object-cover" />
                  <div className="flex items-center justify-between p-2.5">
                    <span className="truncate text-[13px] font-semibold text-foreground">{p.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{p.count}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          {sideTab === "history" && (
            historyItems.length === 0 ? (
              <p className="px-1 py-4 text-[13px] text-muted-foreground">Nothing matches this search.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {historyItems.map((h) => (
                  <button key={h.id} type="button" className="group relative overflow-hidden rounded-[10px] border border-border bg-card">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={h.thumb} alt={h.title} className="aspect-square w-full object-cover" />
                    {h.status === "generating" && (
                      <span className="absolute inset-x-1 bottom-1 rounded-md bg-primary/80 px-1 py-0.5 text-center font-mono text-[10px] leading-3 text-primary-foreground">
                        generating
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </aside>

      {/* ── Chat pane(A2 左半) ── */}
      <section className="flex w-[clamp(320px,30%,420px)] shrink-0 flex-col border-r border-border">
        {/* 会话切换器(名▾ + New agent) */}
        <div className="relative flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4">
          <button
            type="button"
            onClick={() => setSessionMenu((v) => !v)}
            aria-expanded={sessionMenu}
            className="flex min-w-0 items-center gap-1 rounded-[10px] px-2 py-1 text-sm font-semibold text-foreground hover:bg-accent"
          >
            <span className="truncate">{CV_SESSIONS.find((s) => s.id === sessionId)?.name}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          </button>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => setSessionMenu(false)}>
            <Plus className="size-3.5" strokeWidth={2.2} />
            New agent
          </Button>
          {sessionMenu && (
            <div className="absolute top-12 left-4 z-50 w-56 rounded-[14px] border border-border bg-popover p-1 shadow-[var(--shadow-lg)]">
              {CV_SESSIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSessionId(s.id);
                    setSessionMenu(false);
                  }}
                  className={cn(
                    "flex h-9 w-full items-center rounded-[10px] px-3 text-left text-[13px]",
                    sessionId === s.id ? "bg-secondary font-semibold text-foreground" : "text-foreground hover:bg-accent",
                  )}
                >
                  <span className="truncate">{s.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 消息流(H0/H4:chat 与 canvas 同一状态两视图) */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {turns.map((t) => (
            <div key={t.id} className={cn("flex flex-col", t.from === "user" ? "items-end" : "items-start")}>
              {t.from === "otto" && t.steps && (
                <div className="mb-1.5 flex flex-col gap-1">
                  {t.steps.map((s) => (
                    <span key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="size-1 rounded-full bg-muted-foreground/50" />
                      {s}
                    </span>
                  ))}
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-[14px] px-4 py-3 text-sm leading-5",
                  t.from === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground",
                )}
              >
                {t.text}
              </div>
              {/* chat 缩略图镜像(I1) */}
              {t.objectIds && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {t.objectIds.map((oid) => {
                    const obj = objects.find((o) => o.id === oid);
                    if (!obj) return null;
                    const job = jobs.find((j) => j.objectId === oid);
                    return (
                      <button
                        key={oid}
                        type="button"
                        onClick={() => setSelected([oid])}
                        className="relative size-14 overflow-hidden rounded-[10px] border border-border"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={obj.src} alt={obj.ref} className="size-full object-cover" />
                        {job && job.pct < 100 && (
                          <span className="absolute inset-0 flex items-center justify-center bg-primary/60 font-mono text-[10px] font-medium text-primary-foreground tabular-nums">
                            {job.pct}%
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {t.from === "otto" && (
                <FeedbackControls
                  withFlag
                  className="mt-1.5"
                  value={feedback[t.id] ?? null}
                  onChange={(v) => setFeedback((f) => ({ ...f, [t.id]: v }))}
                />
              )}
            </div>
          ))}
          {streaming && (
            <div className="flex flex-col gap-1" role="status">
              {streamSteps.map((s) => (
                <span key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-1 animate-pulse rounded-full bg-brand" />
                  {s}…
                </span>
              ))}
              {streamSteps.length === 0 && <span className="text-xs text-muted-foreground">Thinking…</span>}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Composer(A1 三模式 + J2 @mention + H0 ↑↔■) */}
        <div className="shrink-0 border-t border-border p-3">
          <div className="relative rounded-[14px] border border-input bg-card shadow-[var(--shadow-xs)] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40">
            {mentionOpen && (
              <div className="absolute bottom-full left-3 z-50 mb-2 w-56 rounded-[14px] border border-border bg-popover p-1 shadow-[var(--shadow-lg)]">
                <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Reference a canvas object</p>
                {mentionables.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setDraft((d) => `${d.replace(/@$/, "")}@${o.ref} `);
                      setMentionOpen(false);
                    }}
                    className="flex h-9 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[13px] text-foreground hover:bg-accent"
                  >
                    {o.kind === "image" ? <ImageIcon className="size-4 text-muted-foreground" strokeWidth={2} /> : <Video className="size-4 text-muted-foreground" strokeWidth={2} />}
                    {o.ref}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setMentionOpen(e.target.value.endsWith("@"));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder={
                mode === "agent"
                  ? "Tell Otto what you're after. Type @ to reference a canvas object."
                  : mode === "image"
                    ? "Describe the image to make…"
                    : "Describe the video to make…"
              }
              className="max-h-40 w-full resize-none bg-transparent px-3.5 pt-3 text-[15px] leading-[22px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center gap-2 px-2.5 pb-2.5">
              <div className="flex rounded-[10px] border border-border bg-card p-0.5">
                {(["image", "video", "agent"] as Mode[]).map((m) => {
                  const Icon = m === "image" ? ImageIcon : m === "video" ? Video : Bot;
                  return (
                    <Tooltip key={m}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${m} mode`}
                          aria-pressed={mode === m}
                          onClick={() => setMode(m)}
                          className={cn(
                            "flex size-7 items-center justify-center rounded-lg transition-colors duration-[120ms]",
                            mode === m ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon className="size-4" strokeWidth={2} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="capitalize">{m}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              {/* 参数栏随模式重排(A1) */}
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {mode === "image" && "1:1 · 4 variants · direct, balance is the gate"}
                {mode === "video" && "6s · 720p · asks before spending"}
                {mode === "agent" && "Plans first · asks before spending"}
              </span>
              <span className="hidden text-[11px] text-muted-foreground/70 sm:inline">Shift+Enter to send</span>
              {streaming ? (
                <Button size="icon" variant="secondary" className="size-9 rounded-[10px]" aria-label="Stop" onClick={stopStreaming}>
                  <Square className="size-3.5 fill-current" strokeWidth={2} />
                </Button>
              ) : (
                <Button size="icon" className="size-9 rounded-[10px]" aria-label="Send" onClick={send}>
                  <ArrowUp className="size-4" strokeWidth={2.2} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Canvas pane(A2 右半) ── */}
      <section className="relative flex min-w-0 flex-1 flex-col">
        {/* 顶条:项目名 + 余额 + 进度胶囊 */}
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-4">
          <span className="truncate text-sm font-semibold text-foreground">Untitled project · Merdeka box shots</span>
          <Badge variant="outline" className="hidden text-muted-foreground md:inline-flex">Auto-saved</Badge>
          <div className="flex-1" />
          {runningJobs.length > 0 && (
            <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 shadow-[var(--shadow-xs)]">
              <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
                {runningJobs.length} generating · {avgPct}%
              </span>
            </span>
          )}
          <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
            {balance.toLocaleString()} credits
          </span>
        </div>

        {/* 叙述胶囊(§O5:canvas = ink pill,顶部居中) */}
        {narration && (
          <div className="pointer-events-none absolute top-16 left-1/2 z-[10] -translate-x-1/2">
            <InkNarrationPill text={narration} counter={runningJobs.length > 1 ? `${jobs.length - runningJobs.length}/${jobs.length}` : undefined} />
          </div>
        )}

        {/* 点阵画布(B1) */}
        <div
          ref={canvasRef}
          className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
          style={{
            backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return;
            setSelected([]);
            panState.current = { startX: e.clientX, startY: e.clientY, px: pan.x, py: pan.y };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const p = panState.current;
            if (!p) return;
            setPan({ x: p.px + (e.clientX - p.startX), y: p.py + (e.clientY - p.startY) });
          }}
          onPointerUp={() => {
            panState.current = null;
          }}
        >
          <div
            className="absolute top-0 left-0"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}
          >
            {/* 谱系连线(D3)+ 对齐参考线(C1) */}
            <svg aria-hidden className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1">
              {objects.map((o) => {
                if (!o.parentId) return null;
                const p = objects.find((x) => x.id === o.parentId);
                if (!p) return null;
                const x1 = p.x + p.w;
                const y1 = p.y + p.h / 2;
                const x2 = o.x;
                const y2 = o.y + o.h / 2;
                return (
                  <path
                    key={`${p.id}-${o.id}`}
                    d={`M ${x1} ${y1} C ${x1 + 28} ${y1}, ${x2 - 28} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="var(--muted-foreground)"
                    strokeOpacity={0.45}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />
                );
              })}
              {guideY !== null && (
                <line x1={-200} y1={guideY} x2={2400} y2={guideY} stroke="var(--info)" strokeWidth={1} strokeDasharray="6 4" />
              )}
            </svg>

            {/* 对象(B3 生成中也可选) */}
            {objects.map((obj) => {
              const isSel = selected.includes(obj.id);
              const job = jobs.find((j) => j.objectId === obj.id);
              const pct = job?.pct ?? 100;
              const phase = obj.status === "ready" ? "ready" : pct < 8 ? "Queued" : pct < 85 ? `Generating ${pct}%` : "Refining…";
              return (
                <div
                  key={obj.id}
                  className="absolute"
                  style={{ left: obj.x, top: obj.y, width: obj.w }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`${obj.ref} · ${obj.title}`}
                    onPointerDown={(e) => onNodePointerDown(e, obj)}
                    onPointerMove={onNodePointerMove}
                    onPointerUp={onNodePointerUp}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected([obj.id]);
                      }
                    }}
                    className={cn(
                      "relative cursor-move touch-none overflow-hidden rounded-[14px] border bg-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                      isSel ? "border-brand border-2" : "border-border",
                    )}
                    style={{
                      height: obj.h,
                      ...(sweepId === obj.id ? SWEEP_STYLE : obj.status === "generating" ? undefined : undefined),
                      ...(obj.status === "generating" && pct === 0 ? LAND_STYLE : {}),
                    }}
                  >
                    {/* 内容 / C4 中间态 */}
                    {obj.status === "generating" && pct < 85 ? (
                      <div className="flex size-full flex-col items-center justify-center gap-2 bg-muted">
                        <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">{phase}</span>
                        <span className="relative h-[5px] w-24 overflow-hidden rounded-full border border-border bg-background">
                          <span className="absolute top-0 left-0 h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="text-[11px] text-muted-foreground">Billed only when it finishes</span>
                      </div>
                    ) : (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={obj.src}
                          alt={obj.title}
                          draggable={false}
                          className={cn("size-full object-cover", obj.status === "generating" && "opacity-70 blur-[1px]")}
                        />
                        {obj.status === "generating" && (
                          <span className="absolute inset-x-2 bottom-2 rounded-md bg-primary/70 px-2 py-0.5 text-center font-mono text-[10px] text-primary-foreground tabular-nums">
                            {phase}
                          </span>
                        )}
                      </>
                    )}

                    {/* 类型角标(C3)+ A/B 分叉标签 + 可寻址名(C2) */}
                    <span className="absolute top-2 left-2 flex items-center gap-1">
                      <span className="flex h-5 items-center gap-1 rounded-full bg-primary/75 px-1.5 font-mono text-[10px] leading-none font-medium text-primary-foreground">
                        {obj.kind === "image" ? <ImageIcon className="size-3" strokeWidth={2} /> : <Video className="size-3" strokeWidth={2} />}
                        {obj.ref}
                      </span>
                      {obj.fork && (
                        <span className="flex h-5 items-center rounded-full bg-primary/75 px-1.5 font-mono text-[10px] leading-none font-medium text-primary-foreground">
                          {obj.fork}
                        </span>
                      )}
                    </span>

                    {/* 视频内嵌播放器 chrome(C3) */}
                    {obj.kind === "video" && obj.status === "ready" && (
                      <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 rounded-[10px] bg-primary/75 px-2 py-1">
                        <button
                          type="button"
                          aria-label={playingVideo === obj.id ? "Pause" : "Play"}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => setPlayingVideo((p) => (p === obj.id ? null : obj.id))}
                          className="text-primary-foreground"
                        >
                          {playingVideo === obj.id ? <Pause className="size-3.5" strokeWidth={2} /> : <Play className="size-3.5" strokeWidth={2} />}
                        </button>
                        <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-primary-foreground/30">
                          <span className={cn("block h-full rounded-full bg-primary-foreground", playingVideo === obj.id ? "w-2/3" : "w-1/4")} />
                        </span>
                        <span className="font-mono text-[10px] leading-none text-primary-foreground tabular-nums">{obj.duration ?? 6}s</span>
                        <Volume2 className="size-3 text-primary-foreground" strokeWidth={2} />
                        <Repeat className="size-3 text-primary-foreground/70" strokeWidth={2} />
                        <span className="rounded-sm border border-primary-foreground/50 px-0.5 font-mono text-[9px] leading-3 text-primary-foreground">HD</span>
                      </div>
                    )}

                    {/* 手柄(C1:选中 = 八点) */}
                    {isSel && (
                      <>
                        {[
                          "top-0 left-0 -translate-x-1/2 -translate-y-1/2",
                          "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2",
                          "top-0 right-0 translate-x-1/2 -translate-y-1/2",
                          "top-1/2 left-0 -translate-x-1/2 -translate-y-1/2",
                          "top-1/2 right-0 translate-x-1/2 -translate-y-1/2",
                          "bottom-0 left-0 -translate-x-1/2 translate-y-1/2",
                          "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2",
                          "bottom-0 right-0 translate-x-1/2 translate-y-1/2",
                        ].map((pos) => (
                          <span key={pos} aria-hidden className={cn("absolute z-10 size-2 rounded-full border border-brand bg-card", pos)} />
                        ))}
                      </>
                    )}
                  </div>

                  {/* 贴附工具条(D1)+ Type to imagine(D2)— 随对象移动 */}
                  {isSel && singleSelected?.id === obj.id && (
                    <ObjectToolbar
                      obj={obj}
                      feedback={feedback[obj.id] ?? null}
                      onFeedback={(v) => setFeedback((f) => ({ ...f, [obj.id]: v }))}
                      onMakeVideo={() => setSpendAsk({ kind: "make-video", sourceId: obj.id })}
                      onDelete={() => deleteObjects([obj.id])}
                      onPrompt={() => {
                        setPromptFor((p) => (p === obj.id ? null : obj.id));
                        setCopied(false);
                      }}
                      promptOpen={promptFor === obj.id}
                      copied={copied}
                      onCopy={() => {
                        void navigator.clipboard?.writeText(obj.prompt).catch(() => undefined);
                        setCopied(true);
                      }}
                      onImagine={(text) => {
                        if (obj.kind === "image") evolveImage(obj, text);
                        else setSpendAsk({ kind: "evolve-video", sourceId: obj.id, prompt: text });
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* 缩放器(B1) */}
          <div className="absolute bottom-4 left-4 z-[10] flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-1 shadow-[var(--shadow-md)]">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.2) * 10) / 10))}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Minus className="size-4" strokeWidth={2} />
            </button>
            <span className="w-11 text-center font-mono text-[11px] leading-[14px] font-medium text-foreground tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(1.6, Math.round((z + 0.2) * 10) / 10))}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-4" strokeWidth={2} />
            </button>
          </div>

          {/* 多选批量条(F1)— 右下;恰好 2 视频 → Stitch + play */}
          {selectedObjects.length > 1 && (
            <div className="absolute right-4 bottom-4 z-[10] flex items-center gap-1 rounded-[14px] border border-border bg-card p-1.5 shadow-[var(--shadow-md)]" style={LAND_STYLE}>
              <span className="px-2 font-mono text-[11px] leading-[14px] font-medium text-muted-foreground tabular-nums">
                {selectedObjects.length} selected
              </span>
              <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs">
                <Layers className="size-3.5" strokeWidth={2} />
                Group
              </Button>
              <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs">
                <Copy className="size-3.5" strokeWidth={2} />
                Duplicate
              </Button>
              <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs">
                <Download className="size-3.5" strokeWidth={2} />
                Download
              </Button>
              {exactlyTwoVideos && (
                <>
                  <Button variant="secondary" size="sm" className="h-8 px-2.5 text-xs">
                    <Scissors className="size-3.5" strokeWidth={2} />
                    Stitch
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" aria-label="Play both">
                    <Play className="size-3.5" strokeWidth={2} />
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs text-error-soft-foreground hover:bg-error-soft" onClick={() => deleteObjects(selected)}>
                <Trash2 className="size-3.5" strokeWidth={2} />
                Delete
              </Button>
            </div>
          )}

          {/* 删除 Undo(FB6 tier 1:可逆 → 不确认,给 Undo) */}
          {undoChip && selectedObjects.length <= 1 && (
            <div className="absolute bottom-4 left-1/2 z-[10] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-[var(--shadow-md)]">
              <span className="text-[13px] text-foreground">
                Deleted {undoChip.length} {undoChip.length === 1 ? "object" : "objects"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setObjects((prev) => [...prev, ...undoChip]);
                  setUndoChip(null);
                }}
                className="text-[13px] font-semibold text-foreground underline underline-offset-2"
              >
                Undo
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 花费确认(§FB6 money + §V5) */}
      <SpendConfirmDialog
        open={spendAsk !== null}
        onOpenChange={(v) => !v && setSpendAsk(null)}
        title={spendAsk?.kind === "agent-batch" ? `Generate ${CLIP_COUNT} clips?` : "Generate this video?"}
        ask={
          spendAsk?.kind === "agent-batch"
            ? `Otto will generate ${CLIP_COUNT} clips in parallel. This will spend real credits.`
            : "This will spend real credits."
        }
        impacts={
          spendAsk?.kind === "agent-batch"
            ? [
                `Cost: ${CLIP_COUNT * VIDEO_COST} credits (${CLIP_COUNT} clips × ${VIDEO_COST}). No charge until you confirm.`,
                "Each clip shows its own progress and can be deleted after.",
                "If a clip fails, you aren't charged for it.",
              ]
            : [
                `Cost: ${VIDEO_COST} credits. No charge until you confirm.`,
                "The video lands next to its source with a lineage line.",
                "If it fails, you aren't charged.",
              ]
        }
        confirmLabel={
          spendAsk?.kind === "agent-batch"
            ? `Confirm generate · ${CLIP_COUNT * VIDEO_COST} credits`
            : `Confirm generate · ${VIDEO_COST} credits`
        }
        onConfirm={() => {
          const ask = spendAsk;
          setSpendAsk(null);
          if (!ask) return;
          if (ask.kind === "agent-batch") confirmAgentBatch(ask.prompt);
          else {
            const source = objects.find((o) => o.id === ask.sourceId);
            if (source) makeVideo(source, ask.kind === "evolve-video" ? ask.prompt : `Animate: ${source.prompt}`);
          }
        }}
      />

      <MockNote path="/northstar/create/canvas" />
    </div>
    </TooltipProvider>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * ObjectToolbar — D1/D4/D5 贴附工具条 + D2 Type to imagine + C2 ☰prompt
 * ──────────────────────────────────────────────────────────────────────── */
function ObjectToolbar({
  obj,
  feedback,
  onFeedback,
  onMakeVideo,
  onDelete,
  onPrompt,
  promptOpen,
  copied,
  onCopy,
  onImagine,
}: {
  obj: CvObject;
  feedback: FeedbackValue;
  onFeedback: (v: FeedbackValue) => void;
  onMakeVideo: () => void;
  onDelete: () => void;
  onPrompt: () => void;
  promptOpen: boolean;
  copied: boolean;
  onCopy: () => void;
  onImagine: (text: string) => void;
}) {
  const [text, setText] = React.useState("");

  const tool = (label: string, icon: React.ReactNode, onClick?: () => void, href?: string, danger?: boolean) => {
    const cls = cn(
      "flex size-8 items-center justify-center rounded-[10px] transition-colors duration-[120ms]",
      danger
        ? "text-error-soft-foreground hover:bg-error-soft"
        : "text-muted-foreground hover:bg-accent hover:text-foreground",
    );
    return (
      <Tooltip key={label}>
        <TooltipTrigger asChild>
          {href ? (
            <Link href={href} aria-label={label} className={cls} onPointerDown={(e) => e.stopPropagation()}>
              {icon}
            </Link>
          ) : (
            <button type="button" aria-label={label} onClick={onClick} onPointerDown={(e) => e.stopPropagation()} className={cls}>
              {icon}
            </button>
          )}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="absolute left-1/2 z-20 w-max -translate-x-1/2 pt-2" style={{ top: "100%" }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-0.5 rounded-[14px] border border-border bg-card p-1 shadow-[var(--shadow-md)]" style={LAND_STYLE}>
        {obj.kind === "image" ? (
          <>
            {tool("Make video · 40 credits", <Video className="size-4" strokeWidth={2} />, onMakeVideo)}
            {tool("Crop", <Crop className="size-4" strokeWidth={2} />, undefined, "/northstar/create/media-editor")}
          </>
        ) : (
          <>
            {tool("Trim", <Scissors className="size-4" strokeWidth={2} />, undefined, "/northstar/create/media-editor")}
            {tool("Extract frame", <ImageIcon className="size-4" strokeWidth={2} />, undefined, "/northstar/create/media-editor")}
            {tool("Effects", <Wand2 className="size-4" strokeWidth={2} />, undefined, "/northstar/create/media-editor")}
          </>
        )}
        {tool("Full screen", <Maximize2 className="size-4" strokeWidth={2} />, undefined, `/northstar/create/asset-viewer?asset=${obj.id}`)}
        {tool("Prompt", <Menu className="size-4" strokeWidth={2} />, onPrompt)}
        {tool("Download", <Download className="size-4" strokeWidth={2} />, () => undefined)}
        <span className="mx-0.5 h-5 w-px bg-border" />
        <FeedbackControls value={feedback} onChange={onFeedback} />
        <span className="mx-0.5 h-5 w-px bg-border" />
        {tool("Delete", <Trash2 className="size-4" strokeWidth={2} />, onDelete, undefined, true)}
      </div>

      {/* ☰ prompt 卡(C2) */}
      {promptOpen && (
        <div className="mt-2 w-72 rounded-[14px] border border-border bg-popover p-3 shadow-[var(--shadow-lg)]" style={LAND_STYLE}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {obj.ref} · prompt
            </span>
            <button
              type="button"
              onClick={onCopy}
              className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Copy className="size-3" strokeWidth={2} />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1.5 text-[13px] leading-[18px] text-foreground">{obj.prompt}</p>
        </div>
      )}

      {/* Type to imagine(D2:占位符随对象类型变) */}
      <form
        className="mt-2 flex items-center gap-1.5 rounded-[14px] border border-input bg-card p-1.5 shadow-[var(--shadow-md)] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onImagine(text.trim());
          setText("");
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={obj.kind === "image" ? "Type to imagine a new version of this image…" : "Type to imagine what happens next…"}
          className="h-8 w-72 min-w-0 bg-transparent px-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <span className="font-mono text-[10px] leading-3 text-muted-foreground tabular-nums">
          {obj.kind === "image" ? "~12 cr" : "asks first"}
        </span>
        <Button type="submit" size="icon" className="size-8 rounded-[10px]" aria-label="Imagine">
          <ArrowUp className="size-4" strokeWidth={2.2} />
        </Button>
      </form>
    </div>
  );
}
