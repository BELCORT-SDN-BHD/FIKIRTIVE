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
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUp,
  Bot,
  Columns2,
  Copy,
  Crop,
  Download,
  FolderPlus,
  GitBranch,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Menu,
  Minus,
  Play,
  Plus,
  Repeat,
  Scan,
  Scissors,
  Search,
  Sparkles,
  Trash2,
  Video,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useInsideImmersive } from "../immersive/_context";
import { useQueryParam, useSweep } from "../immersive/_kit";
// [wave-c] 空态 hero 的 Otto 云(≥16px 用有眼 avatar,§O1;idle 心情)。
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import {
  castPersonas,
  recentEvents,
  registerCanvasObject,
  useStore,
} from "../immersive/_store";
import {
  canvasFailureRetryMode,
  canvasVariantClusterFootprint,
  useImmersiveCanvasRuntime,
  nearestOpenCanvasPosition,
  ottoCanvasSyncEvents,
  type ImmersiveCanvasNode,
  type ImmersiveCanvasRuntimeContext,
} from "@/components/canvas/immersive-canvas-runtime";
import { isInFlightPaidGen } from "@/components/canvas/useCanvasGen";
import { isCanvasCardFace, isInFlightCardFace } from "@/lib/canvas-card-status";
import { canvasBatchLetter, canvasCardsComparable } from "@/lib/canvas-batch-identity";
// [cx-canvas-runtime] 断层 3/5 ②:品牌记忆「Make for them」带 ?audience=,选角「Make with this face」
// 带 ?persona=;canvas 读它解析出上下文名,显示可关 context chip 并预填进 prompt 前缀。
import { AUDIENCE_PROFILES } from "../immersive/assets/data";
import { PERSONAS } from "../assets/_data";
import {
  resolveCanvasSeed,
  type CvChatTurn,
  type CvObject,
  type CvStatus,
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
type SideTab = "chat" | "projects" | "tree";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

// [wave-c] Studio canvas · 无参进入 = 一张真正的空画布(STALL #1/#6:第一眼不再落进别人的
// 示例会话);种子会话(Merdeka / Croissant / Menu)降为侧栏「示例」。
/** Empty-canvas examples only prefill the composer; they never simulate an Otto reply. */
const CANVAS_STARTERS: { id: string; label: string; mode: Mode; draft: string }[] = [
  {
    id: "product",
    label: "A product photo of what I sell",
    mode: "image",
    draft: "A clean product photo of what I sell on a plain surface, soft morning light, simple background",
  },
  {
    id: "reel",
    label: "A short reel of my shop",
    mode: "video",
    draft: "A short reel of my shop counter in the morning, warm light, close on what I sell",
  },
  {
    id: "ideas",
    label: "3 post ideas for this week",
    mode: "agent",
    draft: "Give me 3 post ideas for this week",
  },
];

interface GenJob {
  objectId: string;
  pct: number;
}

type RuntimeRequest =
  | {
      kind: "image";
      prompt: string;
      count: number;
      actionId: string;
      sourceGenerationId?: string;
      sourceNodeId?: string;
    }
  | {
      kind: "video";
      prompt: string;
      actionId: string;
      sourceGenerationId?: string;
      sourceNodeId?: string;
    };

/** 视觉 group frame(F1:Group)—— 记录成员 + 一个 label,画布画外框。 */
interface CvGroup {
  id: string;
  objectIds: string[];
  label: string;
}

/**
 * 两对象是否同源可比 —— evolve 分叉并排对比闸(GOAL §6),现在只读落盘事实(#603 T4)。
 *
 * 从前这道闸认「同父兄弟」:一批四张的兄弟卡在同一列里都指着批次锚点,于是四张里任意两张
 * 都判为可比,闸对图片批次实际已成死代码。真正的 A/B 只有一种:一次只出两张的那一批,
 * 序号 0 与序号 1。父子(真派生)照旧可比。
 */
function comparable(a: CvObject, b: CvObject): boolean {
  return canvasCardsComparable(
    { id: a.id, type: a.kind, genJobId: a.genJobId, batchIndex: a.batchIndex, batchSize: a.batchSize, madeFromNodeId: a.parentId },
    { id: b.id, type: b.kind, genJobId: b.genJobId, batchIndex: b.batchIndex, batchSize: b.batchSize, madeFromNodeId: b.parentId },
  );
}

/** 从一组对象派生下一个可寻址名的计数(切会话后名号接得上)。 */
function deriveCounters(objs: CvObject[]): { image: number; video: number } {
  let image = 0;
  let video = 0;
  for (const o of objs) {
    const n = Number(o.ref.replace(/\D+/g, "")) || 0;
    if (o.kind === "image") image = Math.max(image, n);
    else video = Math.max(video, n);
  }
  return { image, video };
}

/**
 * The board's card faces come from the ONE derivation, not from a table here (#602 T3).
 *
 * What stood here was a translation table whose last line was `return "generating"`, so every word
 * it had not been taught — `cancelled` above all — was drawn as work in progress. A merchant who
 * pressed Cancel watched their card generate for ever (F21). The server now hands over a face from
 * the closed set (`canvasCardFace`); this only refuses to draw anything it cannot name, and what
 * it cannot name is `unknown` — a state that RESTS.
 */
function runtimeFace(status: string): CvStatus {
  return isCanvasCardFace(status) ? status : "unknown";
}

function runtimeNodeToObject(
  node: ImmersiveCanvasNode,
  ref: string,
  previous?: CvObject,
  actionId?: string,
): CvObject | null {
  if (node.type !== "image" && node.type !== "video") return null;
  // A/B 只由落盘序号决定,拖到哪里都不会换(#603 T4)。
  const fork = canvasBatchLetter({ batchIndex: node.batchIndex, batchSize: node.batchSize }) ?? undefined;
  return {
    id: node.id,
    ref,
    kind: node.type,
    title: node.prompt.trim().slice(0, 40) || (node.type === "image" ? "Generated image" : "Generated video"),
    prompt: node.prompt,
    src: node.url ?? previous?.src ?? "",
    x: node.pos.x,
    y: node.pos.y,
    w: node.pos.w,
    h: node.pos.h,
    status: runtimeFace(node.status),
    generationId: node.generationId ?? previous?.generationId,
    genJobId: node.genJobId ?? previous?.genJobId,
    threadId: node.threadId ?? previous?.threadId,
    actionId: actionId ?? previous?.actionId,
    batchIndex: node.batchIndex ?? previous?.batchIndex,
    batchSize: node.batchSize ?? previous?.batchSize,
    progress: previous?.progress ?? (node.status === "done" ? 100 : 0),
    parentId: node.madeFromNodeId ?? previous?.parentId,
    fork,
    credits: 0,
  };
}

function newCanvasActionId(projectId: string): string {
  return `canvas:${projectId}:${crypto.randomUUID()}`;
}

export function CanvasPage({ runtimeContext }: { runtimeContext: ImmersiveCanvasRuntimeContext }) {
  useCreateKeyframes();
  useStore(); // 订阅共享 store(余额 / Otto 工作态 / 事件流 = 单一循环系统)
  const router = useRouter();

  // ── ?from / ?prompt 落地画布(create gap#4:断头路全通)──
  // from=<id> 解析成真实对象 → 一张只含它的干净画布;prompt 预填首句。
  const fromParam = useQueryParam("from");
  const promptParam = useQueryParam("prompt");
  // [cx-canvas-runtime] ②:?audience=<seg id>(品牌记忆)/ ?persona=<persona id>(选角)落地画布。
  // id 从对应表解析出人名;查不到就优雅忽略(不显 chip、不改 prompt)。chip 显示「For: 名」,
  // prompt 前缀预填(audience = 卖给谁;persona = 出镜的脸),让按钮承诺的上下文真的带进画布。
  // 走 useSearchParams(reactive)而非 useQueryParam(window.location 快照):品牌记忆/选角的
  // 「Make …」是 client-nav Link,App Router 在 URL commit 前就渲染,窗口快照读到上一页 → 参数丢、
  // chip 不显。useSearchParams 反映当前路由 query,client-nav 过来才拿得到 audience/persona。
  const searchParams = useSearchParams();
  const audienceParam = searchParams.get("audience");
  const personaParam = searchParams.get("persona");
  const canvasContext = React.useMemo(() => {
    if (audienceParam) {
      const seg = AUDIENCE_PROFILES.find((a) => a.id === audienceParam);
      if (seg) return { name: seg.name, prefix: `For ${seg.name}: ` };
    }
    if (personaParam) {
      // castPersonas() 优先:cast 新建/训练好的人设已迁 store,静态 PERSONAS 只作种子兜底 ——
      // 否则新训人设点「Use in a video」到画布拿不到上下文(chip / prompt 前缀双丢)。
      const ps = castPersonas().find((p) => p.id === personaParam) ?? PERSONAS.find((p) => p.id === personaParam);
      if (ps) return { name: ps.name, prefix: `Starring ${ps.name}: ` };
    }
    return null;
  }, [audienceParam, personaParam]);
  const [contextDismissed, setContextDismissed] = React.useState(false);
  const bootSeed = React.useMemo(() => resolveCanvasSeed(fromParam), [fromParam]);
  const bootObjects = React.useMemo(() => (bootSeed ? [{ ...bootSeed, example: true }] : null), [bootSeed]);
  // 可寻址名计数(C2:Image 1/2… Video 1/2…)— 只在事件处理器里改;从起始画布对象派生
  const refCounter = React.useRef(deriveCounters(bootObjects ?? []));
  const uidCounter = React.useRef(0);
  const nextUid = () => {
    uidCounter.current += 1;
    return uidCounter.current;
  };

  // ── 画布状态 ──
  const [objects, setObjects] = React.useState<CvObject[]>(bootObjects ?? []);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [guideY, setGuideY] = React.useState<number | null>(null);
  const [sweepId, setSweepId] = React.useState<string | null>(null);
  const [promptFor, setPromptFor] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [undoChip, setUndoChip] = React.useState<CvObject[] | null>(null);
  const [groups, setGroups] = React.useState<CvGroup[]>([]);
  const [compareIds, setCompareIds] = React.useState<string[] | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);
  const flashTimer = React.useRef<number | null>(null);

  // ── 会话 / chat 状态 ──
  const [turns, setTurns] = React.useState<CvChatTurn[]>([]);
  const [mode, setMode] = React.useState<Mode>("agent");
  // context 前缀 + ?prompt 一起作为输入框初值(context chip 承诺的上下文一落地就预填)。
  const [draft, setDraft] = React.useState((canvasContext?.prefix ?? "") + (promptParam ?? ""));
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [feedback, setFeedback] = React.useState<Record<string, FeedbackValue>>({});
  const [sideTab, setSideTab] = React.useState<SideTab>("chat");
  const [sideSearch, setSideSearch] = React.useState("");
  // 沉浸式外壳内:壳级 240 导航已提供 New 与 History,画布 A3 栏收敛为「工作区上下文」
  // (Search + Chat 会话 + Projects),不再并列成第二条全局导航(蓝图 canvas double-rail 修法)。
  const insideImmersive = useInsideImmersive();

  // ── 真实生成 / 花费状态 ──
  const [jobs, setJobs] = React.useState<GenJob[]>([]);
  const [narration, setNarration] = React.useState<string | null>(null);
  const [imageCount, setImageCount] = React.useState(1);
  const [costQuote, setCostQuote] = React.useState<{ imageCredits: number; videoCredits: number; imageCount: number } | null>(null);
  const [spendAsk, setSpendAsk] = React.useState<{ request: Extract<RuntimeRequest, { kind: "video" }>; credits: number } | null>(null);
  const [runtimeFailure, setRuntimeFailure] = React.useState<{
    message: string;
    request?: RuntimeRequest;
    retryMode?: "same-action" | "new-action";
  } | null>(null);
  const [retryRequests, setRetryRequests] = React.useState<Record<string, RuntimeRequest>>({});
  const [uncertainRequest, setUncertainRequest] = React.useState<RuntimeRequest | null>(null);
  const activeRequestRef = React.useRef<RuntimeRequest | null>(null);
  const pendingRequestsRef = React.useRef<RuntimeRequest[]>([]);
  const requestByRuntimeNodeRef = React.useRef(new Map<string, RuntimeRequest>());
  const submittingActionRef = React.useRef<string | null>(null);
  const lastRequestErrorRef = React.useRef<{ actionId: string; outcomeUnknown: boolean } | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // 轻量 toast(诚实反馈:download / play both 等无真产物的动作)—— 复用底部居中 chip。
  const showFlash = React.useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2600);
  }, []);
  React.useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  const canvasRef = React.useRef<HTMLDivElement>(null);
  const chatEndRef = React.useRef<HTMLDivElement>(null);
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  const compareDialogRef = React.useRef<HTMLDivElement>(null);
  const runtimeRefById = React.useRef(new Map<string, string>());
  const registeredCanvasObjectsRef = React.useRef(new Map<string, string>());
  const runtimeSyncStateRef = React.useRef({
    projectId: runtimeContext.activeProjectId,
    hasLoaded: false,
    nodes: new Map<string, ImmersiveCanvasNode>(),
  });
  // [wave-c] §O7 Apply / 空态起手式回填 composer 时的一次性 coral sweep(§8a)。
  const composerSweep = useSweep();

  const refForRuntimeNode = React.useCallback((node: ImmersiveCanvasNode) => {
    const known = runtimeRefById.current.get(node.id);
    if (known) return known;
    if (node.type === "video") refCounter.current.video += 1;
    else refCounter.current.image += 1;
    const ref = `${node.type === "video" ? "Video" : "Image"} ${node.type === "video" ? refCounter.current.video : refCounter.current.image}`;
    runtimeRefById.current.set(node.id, ref);
    return ref;
  }, []);

  const findRequestForNode = React.useCallback((node: ImmersiveCanvasNode) => {
    const existing = requestByRuntimeNodeRef.current.get(node.id);
    if (existing) return existing;
    return [...pendingRequestsRef.current].reverse().find((request) => {
      if (request.kind !== node.type || request.prompt !== node.prompt) return false;
      if (request.sourceNodeId && request.sourceNodeId !== node.madeFromNodeId) return false;
      return true;
    });
  }, []);

  const onRuntimeLoad = React.useCallback((nodes: ImmersiveCanvasNode[]) => {
    const priorSync = runtimeSyncStateRef.current;
    const sameProject = priorSync.projectId === runtimeContext.activeProjectId;
    const hadLoaded = sameProject && priorSync.hasLoaded;
    const priorNodes = sameProject
      ? priorSync.nodes
      : new Map<string, ImmersiveCanvasNode>();
    const ottoEvents = ottoCanvasSyncEvents(priorNodes, nodes, hadLoaded);
    const nextRuntimeNodes = new Map(nodes.map((node) => [node.id, node]));
    const nextRuntimeIds = new Set(nextRuntimeNodes.keys());
    runtimeSyncStateRef.current = {
      projectId: runtimeContext.activeProjectId,
      hasLoaded: true,
      nodes: nextRuntimeNodes,
    };
    if (!hadLoaded) {
      runtimeRefById.current.clear();
      requestByRuntimeNodeRef.current.clear();
      refCounter.current = { image: 0, video: 0 };
    } else {
      for (const id of runtimeRefById.current.keys()) {
        if (!nextRuntimeIds.has(id)) runtimeRefById.current.delete(id);
      }
      for (const id of requestByRuntimeNodeRef.current.keys()) {
        if (!nextRuntimeIds.has(id)) requestByRuntimeNodeRef.current.delete(id);
      }
    }
    const live = nodes
      .map((node) => {
        const request = findRequestForNode(node);
        if (request) requestByRuntimeNodeRef.current.set(node.id, request);
        return runtimeNodeToObject(node, refForRuntimeNode(node), undefined, request?.actionId);
      })
      .filter((node): node is CvObject => !!node);
    const next = live.length > 0 ? live : (bootObjects ?? []);
    refCounter.current = deriveCounters(next);
    setObjects(next);
    const nextObjectIds = new Set(next.map((node) => node.id));
    setSelected((current) => current.filter((id) => nextObjectIds.has(id)));
    setJobs(
      live
        .filter((node) => isInFlightCardFace(node.status))
        .map((node) => ({ objectId: node.id, pct: node.progress ?? 0 })),
    );
    setUncertainRequest((current) => {
      if (!current) return current;
      const matchingNode = nodes.find((node) => findRequestForNode(node)?.actionId === current.actionId);
      if (!matchingNode) return current;
      const status = runtimeFace(matchingNode.status);
      // Cancelled belongs here too: the merchant ended it, so there is nothing left uncertain.
      return status === "done" || status === "failed" || status === "missing" || status === "cancelled" ? null : current;
    });
    if (ottoEvents.length > 0) {
      const latest = ottoEvents[ottoEvents.length - 1]!;
      const highlightedId = latest.id;
      setSweepId(highlightedId);
      setNarration(ottoEvents.length > 1
        ? `Otto updated ${ottoEvents.length} items on Canvas.`
        : latest.phase === "started"
          ? "Otto started a generation on Canvas."
          : latest.phase === "result"
            ? "Otto added the result to Canvas."
            : "Otto's Canvas generation needs attention.");
      window.setTimeout(() => {
        setSweepId((current) => current === highlightedId ? null : current);
      }, 650);
    }
  }, [bootObjects, findRequestForNode, refForRuntimeNode, runtimeContext.activeProjectId]);

  const onRuntimeNode = React.useCallback((node: ImmersiveCanvasNode) => {
    if (runtimeSyncStateRef.current.projectId === runtimeContext.activeProjectId) {
      runtimeSyncStateRef.current.nodes.set(node.id, node);
    }
    const request = findRequestForNode(node);
    if (request) requestByRuntimeNodeRef.current.set(node.id, request);
    const ref = refForRuntimeNode(node);
    setObjects((previous) => {
      const existing = previous.find((item) => item.id === node.id);
      const mapped = runtimeNodeToObject(node, existing?.ref ?? ref, existing, request?.actionId);
      if (!mapped) return previous;
      return existing
        ? previous.map((item) => item.id === node.id ? mapped : item)
        : [...previous, mapped];
    });
    setJobs((previous) => previous.some((job) => job.objectId === node.id)
      ? previous
      : [...previous, { objectId: node.id, pct: 0 }]);
  }, [findRequestForNode, refForRuntimeNode, runtimeContext.activeProjectId]);

  const onRuntimeResolve = React.useCallback((nodeId: string, url: string | null, status: string, generationId?: string) => {
    const nextStatus = runtimeFace(status);
    const request = requestByRuntimeNodeRef.current.get(nodeId);
    const syncedNode = runtimeSyncStateRef.current.nodes.get(nodeId);
    if (syncedNode) {
      runtimeSyncStateRef.current.nodes.set(nodeId, {
        ...syncedNode,
        url,
        status,
        generationId: generationId ?? syncedNode.generationId,
      });
    }
    setObjects((previous) => previous.map((item) => item.id === nodeId
      ? {
          ...item,
          src: url ?? item.src,
          status: nextStatus,
          generationId: generationId ?? item.generationId,
          progress: 100,
          error: nextStatus === "failed" || nextStatus === "timeout" || nextStatus === "missing"
            ? status === "timeout" ? "The result is still uncertain. Check the same action before starting anything new." : "This generation did not produce usable media."
            : undefined,
        }
      : item));
    setJobs((previous) => previous.filter((job) => job.objectId !== nodeId));
    setNarration(null);
    if (request) {
      if (nextStatus === "timeout") {
        setUncertainRequest(request);
      } else {
        setUncertainRequest((current) => current?.actionId === request.actionId ? null : current);
      }
    }
    if (nextStatus === "done") {
      setSweepId(nodeId);
      window.setTimeout(() => setSweepId((current) => current === nodeId ? null : current), 650);
    } else if (nextStatus !== "cancelled") {
      // A cancel raises NOTHING (#602 T3). The board-wide banner exists to tell a merchant that
      // something went wrong with work they asked for; a job they stopped themselves is not that,
      // and announcing it as a runtime failure is the same lie as the red card.
      setRuntimeFailure({
        message: nextStatus === "timeout"
          ? "We cannot confirm the final result yet. Checking again must reuse the same action ID."
          : nextStatus === "failed"
            ? "This job failed and its reservation was refunded. Trying again is a new paid action."
            : "The job finished without usable media. Reload the saved status before deciding what to do next.",
        request,
        retryMode: nextStatus === "timeout" ? "same-action" : nextStatus === "failed" ? "new-action" : undefined,
      });
    }
  }, []);

  const onRuntimeProgress = React.useCallback((nodeId: string, pct: number) => {
    const progress = Math.max(0, Math.min(100, Math.round(pct)));
    setJobs((previous) => previous.some((job) => job.objectId === nodeId)
      ? previous.map((job) => job.objectId === nodeId ? { ...job, pct: progress } : job)
      : [...previous, { objectId: nodeId, pct: progress }]);
    setObjects((previous) => previous.map((item) => item.id === nodeId ? { ...item, progress } : item));
  }, []);

  const onRuntimeError = React.useCallback((message: string, source?: "request") => {
    // Balance refresh, background sync, and initial-load errors share the visible runtime
    // channel, but they say nothing about whether the active paid request was accepted.
    const request = source === "request" ? activeRequestRef.current : null;
    const retryMode = canvasFailureRetryMode(message, !!request);
    const outcomeUnknown = retryMode === "same-action";
    if (request) {
      lastRequestErrorRef.current = { actionId: request.actionId, outcomeUnknown };
      if (outcomeUnknown) setUncertainRequest(request);
    }
    setRuntimeFailure({
      message,
      request: request ?? undefined,
      retryMode,
    });
    setNarration(null);
  }, []);

  const runtime = useImmersiveCanvasRuntime({
    runtimeContext,
    onLoad: onRuntimeLoad,
    onNode: onRuntimeNode,
    onResolve: onRuntimeResolve,
    onProgress: onRuntimeProgress,
    onError: onRuntimeError,
  });
  const bal = runtime.balance;
  const quoteCosts = runtime.quoteCosts;
  const activeProject = runtimeContext.projects.find((project) => project.id === runtimeContext.activeProjectId);
  const activeThread = runtimeContext.threads.find((thread) => thread.id === runtimeContext.activeThreadId);

  React.useEffect(() => {
    for (const object of objects) {
      if (object.example || object.status !== "done" || !object.src) continue;
      const fingerprint = [object.kind, object.src, object.prompt, object.title, object.parentId ?? "", object.ref, object.duration ?? ""].join("\u0000");
      if (registeredCanvasObjectsRef.current.get(object.id) === fingerprint) continue;
      registerCanvasObject({
        id: object.id,
        kind: object.kind,
        imageUrl: object.src,
        posterUrl: object.src,
        prompt: object.prompt,
        title: object.title,
        lineage: object.parentId,
        ref: object.ref,
        ...(object.duration !== undefined ? { duration: object.duration } : {}),
      });
      registeredCanvasObjectsRef.current.set(object.id, fingerprint);
    }
  }, [objects]);

  React.useEffect(() => {
    let cancelled = false;
    void quoteCosts(imageCount)
      .then((quote) => { if (!cancelled) setCostQuote({ ...quote, imageCount }); })
      .catch(() => { if (!cancelled) setRuntimeFailure({ message: "Could not load the current generation price. Nothing can be sent until it is available." }); });
    return () => { cancelled = true; };
  }, [imageCount, quoteCosts, runtimeContext.activeProjectId]);

  /** [wave-c] 把一段起手式填进 composer(空态 chip / Otto Apply 共用):设模式 + 草稿 +
   * 焦点 + sweep。只填字段,店主再亲手发(§O7:发/花永不由此触发)。 */
  const prefillComposer = React.useCallback((nextMode: Mode, text: string) => {
    setMode(nextMode);
    setDraft(text);
    composerSweep.fire();
    window.requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  }, [composerSweep]);

  // 滚轮 zoom(B1)— 非 passive 监听
  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z - Math.sign(e.deltaY) * 0.1)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Escape 剥一层(§N8):prompt 卡 → 选区
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (mentionOpen) setMentionOpen(false);
      else if (compareIds) setCompareIds(null);
      else if (promptFor) setPromptFor(null);
      else setSelected([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mentionOpen, compareIds, promptFor]);

  React.useEffect(() => {
    if (compareIds) compareDialogRef.current?.focus();
  }, [compareIds]);

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const selectedObjects = objects.filter((o) => selected.includes(o.id));
  const singleSelected = selectedObjects.length === 1 ? selectedObjects[0] : null;
  const runningJobs = jobs.filter((j) => j.pct < 100);
  const avgPct = runningJobs.length
    ? Math.round(runningJobs.reduce((s, j) => s + j.pct, 0) / runningJobs.length)
    : 100;

  const positionForRequest = React.useCallback((request: RuntimeRequest) => {
    const source = request.sourceNodeId ? objects.find((item) => item.id === request.sourceNodeId) : null;
    const preferredCard = request.kind === "video"
      ? source
        ? { x: source.x + source.w + 56, y: source.y - 20, w: 280, h: 180 }
        : { x: 96, y: 120, w: 280, h: 180 }
      : source
        ? { x: source.x + source.w + 56, y: source.y, w: source.w, h: source.h }
        : { x: 96, y: 120, w: 224, h: 224 };
    const footprint = request.kind === "image"
      ? canvasVariantClusterFootprint(preferredCard, request.count)
      : preferredCard;
    const open = nearestOpenCanvasPosition(
      footprint,
      objects.map(({ x, y, w, h }) => ({ x, y, w, h })),
    );
    return { ...preferredCard, x: open.x, y: open.y };
  }, [objects]);

  const runRuntimeRequest = React.useCallback(async (request: RuntimeRequest) => {
    if (uncertainRequest && uncertainRequest.actionId !== request.actionId) {
      setRuntimeFailure({
        message: "Check the unresolved request before starting a new paid action.",
        request: uncertainRequest,
        retryMode: "same-action",
      });
      return;
    }
    if (submittingActionRef.current) return;
    submittingActionRef.current = request.actionId;
    lastRequestErrorRef.current = null;
    setIsSubmitting(true);
    activeRequestRef.current = request;
    if (!pendingRequestsRef.current.some((item) => item.actionId === request.actionId)) {
      pendingRequestsRef.current.push(request);
    }
    setRetryRequests((previous) => ({ ...previous, [request.actionId]: request }));
    setRuntimeFailure(null);
    setNarration(request.kind === "image"
      ? `Generating ${request.count} ${request.count === 1 ? "image" : "images"}…`
      : "Generating video…");
    try {
      const pos = positionForRequest(request);
      const accepted = request.kind === "image"
        ? await runtime.generateImage({
            prompt: request.prompt,
            pos,
            count: request.count,
            actionId: request.actionId,
            ...(request.sourceGenerationId ? { sourceGenerationId: request.sourceGenerationId } : {}),
            ...(request.sourceNodeId ? { sourceNodeId: request.sourceNodeId } : {}),
          })
        : request.sourceGenerationId && request.sourceNodeId
          ? await runtime.animate({
              sourceGenerationId: request.sourceGenerationId,
              sourceNodeId: request.sourceNodeId,
              prompt: request.prompt,
              pos,
              actionId: request.actionId,
            })
          : await runtime.generateVideoFromText({ prompt: request.prompt, pos, actionId: request.actionId });
      if (accepted !== false) {
        setUncertainRequest((current) => current?.actionId === request.actionId ? null : current);
        return;
      }
      setNarration(null);
      const requestError = lastRequestErrorRef.current as { actionId: string; outcomeUnknown: boolean } | null;
      const outcomeUnknown = requestError?.actionId === request.actionId && requestError.outcomeUnknown;
      if (outcomeUnknown) {
        setUncertainRequest(request);
        setRuntimeFailure((current) => current ?? {
          message: "The request outcome is not confirmed. Check the same action before starting anything new.",
          request,
          retryMode: "same-action",
        });
      }
    } catch {
      setNarration(null);
      setUncertainRequest(request);
      setRuntimeFailure({
        message: "The request outcome is unknown. Check the same action before starting anything new.",
        request,
        retryMode: "same-action",
      });
    } finally {
      if (activeRequestRef.current?.actionId === request.actionId) activeRequestRef.current = null;
      if (submittingActionRef.current === request.actionId) submittingActionRef.current = null;
      setIsSubmitting(false);
    }
  }, [positionForRequest, runtime, uncertainRequest]);

  const queueVideoRequest = (prompt: string, source?: CvObject | null) => {
    if (uncertainRequest) {
      setRuntimeFailure({
        message: "Check the unresolved request before starting a new paid action.",
        request: uncertainRequest,
        retryMode: "same-action",
      });
      return;
    }
    if (!costQuote) {
      setRuntimeFailure({ message: "The exact video price is not available yet, so nothing was submitted." });
      return;
    }
    if (source && (!source.generationId || source.example)) {
      setRuntimeFailure({ message: "Make Video needs a real generated image. This example has no live generation to animate." });
      return;
    }
    setSpendAsk({
      request: {
        kind: "video",
        prompt,
        actionId: newCanvasActionId(runtimeContext.activeProjectId),
        ...(source?.generationId ? { sourceGenerationId: source.generationId } : {}),
        ...(source?.id ? { sourceNodeId: source.id } : {}),
      },
      credits: costQuote.videoCredits,
    });
  };

  const retryRequest = (request: RuntimeRequest, retryMode: "same-action" | "new-action") => {
    if (retryMode === "same-action") {
      void runRuntimeRequest(request);
      return;
    }
    if (request.kind === "image") {
      setRuntimeFailure(null);
      setMode("image");
      setImageCount(request.count);
      setDraft(request.prompt);
      setSelected(request.sourceNodeId ? [request.sourceNodeId] : []);
      showFlash("Review the current price, then Send a new action");
      window.requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    if (!costQuote) {
      setRuntimeFailure({ message: "The exact video price is not available yet, so a new action was not opened." });
      return;
    }
    setRuntimeFailure(null);
    setSpendAsk({
      request: { ...request, actionId: newCanvasActionId(runtimeContext.activeProjectId) },
      credits: costQuote.videoCredits,
    });
  };

  const send = () => {
    const text = draft.trim();
    if (!text || runtime.isLoading || isSubmitting || submittingActionRef.current || mode === "agent") return;
    if (uncertainRequest) {
      setRuntimeFailure({
        message: "Check the unresolved request before starting a new paid action.",
        request: uncertainRequest,
        retryMode: "same-action",
      });
      return;
    }
    if (mode === "image" && costQuote?.imageCount !== imageCount) {
      setRuntimeFailure({ message: "The exact price for this image count is still loading, so nothing was submitted." });
      return;
    }
    if (mode === "video" && !costQuote) {
      setRuntimeFailure({ message: "The exact video price is not available yet, so nothing was submitted." });
      return;
    }
    const source = singleSelected?.kind === "image" ? singleSelected : null;
    if (source && (!source.generationId || source.example)) {
      setRuntimeFailure({
        message: mode === "image"
          ? "Editing needs a real generated image. This example cannot be submitted as a live source."
          : "Make Video needs a real generated image. This example has no live generation to animate.",
      });
      return;
    }
    setTurns((previous) => [...previous, { id: `t-${previous.length + 1}`, from: "user", text }]);
    setDraft("");
    setMentionOpen(false);
    if (mode === "image") {
      const request: RuntimeRequest = {
        kind: "image",
        prompt: text,
        count: imageCount,
        actionId: newCanvasActionId(runtimeContext.activeProjectId),
        ...(source?.generationId ? { sourceGenerationId: source.generationId } : {}),
        ...(source?.id ? { sourceNodeId: source.id } : {}),
      };
      void runRuntimeRequest(request);
      return;
    }
    queueVideoRequest(text, source);
  };

  /* ── 对象拖动 + 对齐线(C1) ── */
  const dragState = React.useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(null);

  const onNodePointerDown = (e: React.PointerEvent, obj: CvObject) => {
    e.stopPropagation();
    if (e.shiftKey) {
      setSelected((prev) => (prev.includes(obj.id) ? prev.filter((s) => s !== obj.id) : [...prev, obj.id]));
      return;
    }
    if (selected.length !== 1 || selected[0] !== obj.id) setSelected([obj.id]);
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

  const onNodePointerUp = (obj: CvObject) => {
    dragState.current = null;
    setGuideY(null);
    if (obj.example) return;
    const current = objects.find((item) => item.id === obj.id);
    if (!current) return;
    void runtime.moveNode(current.id, { x: current.x, y: current.y, w: current.w, h: current.h }).then((moved) => {
      if (moved) return;
      setRuntimeFailure({ message: "That move was not saved. The canvas has been reloaded from the project." });
      void runtime.reload();
    });
  };

  /* ── 画布 pan(抓手) ── */
  const panState = React.useRef<{ startX: number; startY: number; px: number; py: number } | null>(null);

  const deleteObjects = async (ids: string[]) => {
    const removed = objects.filter((o) => ids.includes(o.id));
    const live = removed.filter((object) => !object.example);
    if (live.length > 0) {
      const label = live.length === 1 ? live[0].ref : `${live.length} objects`;
      // One vocabulary now, so the face goes straight in — this used to translate `generating`
      // back into the row word `pending` to make the shared guard understand it (#602 T3).
      const includesInFlightPaidGeneration = live.some((object) => isInFlightPaidGen({
        type: object.kind,
        status: object.status,
        url: object.src || null,
      }));
      const warning = includesInFlightPaidGeneration
        ? `Delete ${label} from this project canvas? Deleting an in-flight card does not cancel or refund the generation. Starting again may create another paid action.`
        : `Delete ${label} from this project canvas? This cannot be undone here.`;
      if (!window.confirm(warning)) return;
      for (const object of live) {
        const deleted = await runtime.deleteNode(object.id);
        if (!deleted) {
          setRuntimeFailure({ message: `${object.ref} was not deleted. The canvas has been reloaded to show the saved state.` });
          await runtime.reload();
          return;
        }
      }
    }
    setObjects((prev) => prev.filter((o) => !ids.includes(o.id)));
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, objectIds: g.objectIds.filter((id) => !ids.includes(id)) }))
        .filter((g) => g.objectIds.length > 1),
    );
    setSelected([]);
    const examples = removed.filter((object) => object.example);
    setUndoChip(examples.length > 0 && live.length === 0 ? examples : null);
    if (examples.length > 0 && live.length === 0) {
      window.setTimeout(() => setUndoChip((undo) => undo === examples ? null : undo), 8000);
    }
  };

  /* ── 多选批量条：只保留已接通或明确标注 unavailable 的动作。 ── */
  const groupSelected = () => {
    const ids = selected.slice();
    if (ids.length < 2) return;
    setGroups((prev) => [
      ...prev,
      { id: `grp-${nextUid()}`, objectIds: ids, label: `Group ${prev.length + 1}` },
    ]);
    showFlash(`Grouped ${ids.length} objects`);
  };

  /* ── Zoom-to-fit(B1:框住所有对象,居中缩放到视口) ── */
  const zoomToFit = () => {
    if (objects.length === 0) return;
    const el = canvasRef.current;
    if (!el) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const minX = Math.min(...objects.map((o) => o.x));
    const minY = Math.min(...objects.map((o) => o.y));
    const maxX = Math.max(...objects.map((o) => o.x + o.w));
    const maxY = Math.max(...objects.map((o) => o.y + o.h));
    const pad = 80;
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(vw / bw, vh / bh)));
    setZoom(z);
    setPan({
      x: (vw - (maxX - minX) * z) / 2 - minX * z,
      y: (vh - (maxY - minY) * z) / 2 - minY * z,
    });
  };

  const mentionables = objects.filter((o) => o.status === "done");
  const highlightedMentionIndex = Math.min(mentionIndex, Math.max(mentionables.length - 1, 0));
  const selectMention = (object: CvObject) => {
    setDraft((current) => `${current.replace(/@$/, "")}@${object.ref} `);
    setMentionOpen(false);
    setMentionIndex(0);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };
  const exactlyTwoVideos = selectedObjects.length === 2 && selectedObjects.every((o) => o.kind === "video");
  const canCompare = selectedObjects.length === 2 && comparable(selectedObjects[0], selectedObjects[1]);
  const compareObjects = compareIds
    ? (compareIds.map((id) => objects.find((o) => o.id === id)).filter(Boolean) as CvObject[])
    : [];
  const lastEvent = recentEvents(1)[0];
  const imageQuote = costQuote?.imageCount === imageCount ? costQuote.imageCredits : null;
  const runtimeErrorMessage = runtimeFailure?.message ?? runtime.error;
  const ottoHref = `/otto?project=${encodeURIComponent(runtimeContext.activeProjectId)}${runtimeContext.activeThreadId ? `&thread=${encodeURIComponent(runtimeContext.activeThreadId)}` : ""}`;

  return (
    <TooltipProvider>
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* ── A3 左栏:Search / New generation / Chat / Projects / History ──
         沉浸式外壳内去掉硬右框、换极淡底色,读作 chat 的会话侧栏而非第二条导航 rail。 */}
      <aside
        className={cn(
          "hidden w-56 shrink-0 flex-col lg:flex",
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
            disabled
            title="Creating a new project canvas is not connected in this vertical yet"
          >
            <Plus className="size-4" strokeWidth={2.2} />
            New canvas · coming soon
          </Button>
        </div>
        <div className="flex gap-1 px-3">
          {(["chat", "projects", "tree"] as SideTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSideTab(t)}
              className={cn(
                "relative h-8 flex-1 rounded-[10px] text-xs font-semibold capitalize transition-colors duration-[120ms]",
                sideTab === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {sideTab === "chat" && (
            <div className="flex flex-col gap-1">
              {runtimeContext.threads
                .filter((thread) => thread.projectId === runtimeContext.activeProjectId && thread.title.toLowerCase().includes(sideSearch.toLowerCase()))
                .map((thread) => (
                <Link
                  key={thread.id}
                  href={`/northstar-immersive/create/canvas?project=${encodeURIComponent(thread.projectId)}&thread=${encodeURIComponent(thread.id)}`}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-[10px] px-3 text-left text-[13px] transition-colors duration-[120ms]",
                    runtimeContext.activeThreadId === thread.id
                      ? "bg-secondary font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="truncate">{thread.title}</span>
                  {thread.pinnedAt && <span className="ml-auto text-[10px] text-muted-foreground">Pinned</span>}
                </Link>
              ))}
              {runtimeContext.threads.filter((thread) => thread.projectId === runtimeContext.activeProjectId).length === 0 && (
                <p className="px-2 py-3 text-[12px] leading-4 text-muted-foreground">No live thread is attached to this project canvas.</p>
              )}
            </div>
          )}
          {sideTab === "projects" && (
            <div className="flex flex-col gap-1">
              {runtimeContext.projects
                .filter((project) => project.name.toLowerCase().includes(sideSearch.toLowerCase()))
                .map((project) => (
                  <Link
                    key={project.id}
                    href={`/northstar-immersive/create/canvas?project=${encodeURIComponent(project.id)}`}
                    className={cn(
                      "flex min-h-9 items-center rounded-[10px] px-3 py-2 text-[13px] transition-colors duration-[120ms]",
                      runtimeContext.activeProjectId === project.id
                        ? "bg-secondary font-semibold text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{project.name}</span>
                  </Link>
              ))}
            </div>
          )}
          {sideTab === "tree" && (
            <div className="flex flex-col gap-0.5">
              {/* 血缘树 mini 视图(GOAL §5:父子分支可点选 → 选中该对象) */}
              {objects.length === 0 ? (
                <p className="px-1 py-4 text-[13px] text-muted-foreground">This session is empty.</p>
              ) : (
                objects
                  .filter((o) => !o.parentId || !objects.some((p) => p.id === o.parentId))
                  .map((root) => {
                    const children = objects.filter((c) => c.parentId === root.id);
                    return (
                      <div key={root.id} className="flex flex-col">
                        <LineageRow obj={root} selected={selected.includes(root.id)} onSelect={() => setSelected([root.id])} />
                        {children.map((c) => (
                          <div key={c.id} className="ml-3 border-l border-border pl-2">
                            <LineageRow obj={c} selected={selected.includes(c.id)} onSelect={() => setSelected([c.id])} />
                          </div>
                        ))}
                      </div>
                    );
                  })
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ── Chat pane(A2 左半) ── */}
      <section className="flex h-[46%] min-h-0 w-full shrink-0 flex-col border-b border-border lg:h-auto lg:w-[clamp(320px,30%,420px)] lg:border-r lg:border-b-0">
        {/* Active project/thread come only from the authenticated runtime context. */}
        <div className="relative flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4">
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">{activeThread?.title ?? "Canvas"}</span>
          {activeThread && <Badge variant="outline" className="text-[10px] text-muted-foreground">Live thread</Badge>}
          <div className="flex-1" />
          <span className="truncate text-[11px] text-muted-foreground">{activeProject?.name ?? "Current project"}</span>
        </div>

        {/* [cx-canvas-runtime] ② context chip:从品牌记忆/选角点「Make …」过来,顶部显示为谁做,
           可关(关只是收起提示,已预填进输入框的前缀留给用户自己改)。 */}
        {canvasContext && !contextDismissed && (
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-4 py-2">
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-foreground">
              <Sparkles className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
              <span className="text-muted-foreground">For:</span>
              <span className="truncate font-semibold">{canvasContext.name}</span>
            </span>
            <button
              type="button"
              aria-label="Clear context"
              onClick={() => setContextDismissed(true)}
              className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          </div>
        )}

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
                        {obj.kind === "video" ? (
                          <video src={obj.src} aria-label={obj.ref} muted playsInline preload="metadata" className="pointer-events-none size-full object-cover" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={obj.src} alt={obj.ref} className="size-full object-cover" />
                        )}
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
          <div ref={chatEndRef} />
        </div>

        {/* Composer(A1 三模式 + J2 @mention + H0 ↑↔■) */}
        <div className="shrink-0 border-t border-border p-3">
          <div
            style={composerSweep.style}
            className="relative rounded-[14px] border border-input bg-card shadow-[var(--shadow-xs)] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40"
          >
            {mode === "agent" && (
              <div className="mx-2.5 mt-2.5 flex items-start gap-2 rounded-[10px] border border-border bg-muted/50 p-2.5">
                <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] leading-4 font-semibold text-foreground">Agent work runs in Otto</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">Your live project and thread will open there. Copy this draft first if you want to keep it.</p>
                </div>
                <Button asChild variant="secondary" size="sm" className="h-8 shrink-0 px-2.5 text-xs">
                  <Link href={ottoHref}>Open Otto</Link>
                </Button>
              </div>
            )}
            {mentionOpen && mentionables.length > 0 && (
              <div id="canvas-mentions" role="listbox" aria-label="Canvas objects" className="absolute bottom-full left-3 z-50 mb-2 w-56 rounded-[14px] border border-border bg-popover p-1 shadow-[var(--shadow-lg)]">
                <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Reference a canvas object</p>
                {mentionables.map((o, index) => (
                  <button
                    key={o.id}
                    id={`canvas-mention-${o.id}`}
                    type="button"
                    role="option"
                    aria-selected={highlightedMentionIndex === index}
                    onPointerMove={() => setMentionIndex(index)}
                    onClick={() => selectMention(o)}
                    className={cn(
                      "flex h-9 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[13px] text-foreground",
                      highlightedMentionIndex === index ? "bg-accent" : "hover:bg-accent",
                    )}
                  >
                    {o.kind === "image" ? <ImageIcon className="size-4 text-muted-foreground" strokeWidth={2} /> : <Video className="size-4 text-muted-foreground" strokeWidth={2} />}
                    {o.ref}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const shouldOpen = e.target.value.endsWith("@") && mentionables.length > 0;
                setMentionOpen(shouldOpen);
                if (shouldOpen) setMentionIndex(0);
              }}
              onKeyDown={(e) => {
                if (mentionOpen && mentionables.length > 0) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const direction = e.key === "ArrowDown" ? 1 : -1;
                    setMentionIndex((current) => (Math.min(current, mentionables.length - 1) + direction + mentionables.length) % mentionables.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    const mention = mentionables[highlightedMentionIndex] ?? mentionables[0];
                    if (mention) selectMention(mention);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setMentionOpen(false);
                    return;
                  }
                }
                if (e.key === "Enter" && e.shiftKey) {
                  e.preventDefault();
                  if (mode === "agent") router.push(ottoHref);
                  else send();
                }
              }}
              aria-controls={mentionOpen ? "canvas-mentions" : undefined}
              aria-autocomplete="list"
              aria-activedescendant={mentionOpen && mentionables[highlightedMentionIndex] ? `canvas-mention-${mentionables[highlightedMentionIndex].id}` : undefined}
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
            {/* Keep the exact server quote on its own line. The chat column is intentionally
                narrow, so sharing the controls row could collapse this text to zero width. */}
            <div className="flex items-start gap-2 px-3.5 pb-1.5">
              <span aria-live="polite" className="min-w-0 flex-1 text-xs leading-4 text-muted-foreground">
                {mode === "image" && (imageQuote === null
                  ? "Loading exact price…"
                  : `${imageCount === 2 ? "Real A/B · " : ""}${imageCount} ${imageCount === 1 ? "image" : "images"} · ${imageQuote} credits total`)}
                {mode === "video" && (costQuote ? `Video · ${costQuote.videoCredits} credits · confirm before spend` : "Loading exact price…")}
                {mode === "agent" && "Continue in real Otto · no simulated plan"}
              </span>
              <span className="hidden shrink-0 text-[11px] leading-4 text-muted-foreground/70 2xl:inline">
                {mode === "agent" ? "Shift+Enter to open Otto" : "Shift+Enter to send"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5">
              {/* Real Otto only: this never opens the prototype assist store or emits a canned reply. */}
              {mode !== "agent" && (
                <button
                  type="button"
                  onClick={() => router.push(ottoHref)}
                  aria-label="Ask Otto in the real project workspace"
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <Bot className="size-3.5 text-brand" strokeWidth={2} aria-hidden />
                  <span>Ask Otto</span>
                </button>
              )}
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
              {mode === "image" && (
                <div className="flex shrink-0 items-center rounded-[10px] border border-border bg-card p-0.5" aria-label="Image count">
                  {[1, 2, 3, 4].map((count) => (
                    <button
                      key={count}
                      type="button"
                      aria-label={`${count} ${count === 1 ? "image" : "images"}${count === 2 ? " A/B" : ""}`}
                      aria-pressed={imageCount === count}
                      onClick={() => setImageCount(count)}
                      className={cn(
                        "h-7 min-w-7 rounded-lg px-1.5 font-mono text-[11px] font-semibold tabular-nums transition-colors duration-[120ms]",
                        imageCount === count ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {count === 2 ? "2 · A/B" : count}
                    </button>
                  ))}
                </div>
              )}
              {mode === "agent" ? (
                <Button asChild size="icon" className="ml-auto size-9 shrink-0 rounded-[10px]">
                  <Link href={ottoHref} aria-label="Open this project and thread in Otto"><Bot className="size-4" strokeWidth={2} /></Link>
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="ml-auto size-9 shrink-0 rounded-[10px]"
                  aria-label={mode === "image" && imageQuote !== null ? `Send · ${imageQuote} credits` : "Send"}
                  aria-busy={isSubmitting}
                  disabled={runtime.isLoading || isSubmitting || uncertainRequest !== null || (mode === "image" ? imageQuote === null : !costQuote)}
                  onClick={send}
                >
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
          <span className="truncate text-sm font-semibold text-foreground">
            {activeProject?.name ?? "Current project"} · {activeThread?.title ?? "Canvas"}
          </span>
          {/* 'Auto-saved' 徽章接 store 事件流:有过动作即读作「刚保存」,tooltip 显示上一条 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="hidden text-muted-foreground md:inline-flex">
                {lastEvent ? "Saved just now" : "Auto-saved"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{lastEvent ? lastEvent.label : "Every change saves to this session"}</TooltipContent>
          </Tooltip>
          <div className="flex-1" />
          {runningJobs.length > 0 && (
            <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 shadow-[var(--shadow-xs)]">
              <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
                {runningJobs.length} generating · {avgPct}%
              </span>
            </span>
          )}
          <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">
            {bal.toLocaleString()} credits
          </span>
        </div>

        {runtimeErrorMessage && (
          <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-error-soft-foreground/20 bg-error-soft px-4 py-2 text-[12px] text-error-soft-foreground">
            <span className="min-w-0 flex-1">{runtimeErrorMessage}</span>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 shrink-0 px-2.5 text-xs"
              onClick={() => {
                if (runtimeFailure?.request && runtimeFailure.retryMode) retryRequest(runtimeFailure.request, runtimeFailure.retryMode);
                else void runtime.reload();
              }}
            >
              <Repeat className="size-3.5" strokeWidth={2} />
              {runtimeFailure?.retryMode === "same-action"
                ? "Check same action"
                : runtimeFailure?.retryMode === "new-action" ? "Set up a new action" : "Reload status"}
            </Button>
            {runtimeFailure?.retryMode !== "same-action" && (
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => setRuntimeFailure(null)}
                className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-background/60"
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
        )}

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

            {/* 视觉 group frame(F1:Group)—— 框住成员,随成员移动重算 */}
            {groups.map((g) => {
              const members = objects.filter((o) => g.objectIds.includes(o.id));
              if (members.length < 2) return null;
              const minX = Math.min(...members.map((o) => o.x));
              const minY = Math.min(...members.map((o) => o.y));
              const maxX = Math.max(...members.map((o) => o.x + o.w));
              const maxY = Math.max(...members.map((o) => o.y + o.h));
              const pad = 14;
              return (
                <div
                  key={g.id}
                  aria-hidden
                  className="pointer-events-none absolute rounded-[18px] border border-dashed border-muted-foreground/50"
                  style={{ left: minX - pad, top: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 }}
                >
                  <span className="absolute -top-2.5 left-3 rounded-full bg-card px-2 font-mono text-[10px] leading-4 font-medium text-muted-foreground">
                    {g.label}
                  </span>
                </div>
              );
            })}

            {/* 对象(B3 生成中也可选) */}
            {objects.map((obj) => {
              const isSel = selected.includes(obj.id);
              const job = jobs.find((j) => j.objectId === obj.id);
              const pct = job?.pct ?? obj.progress ?? (obj.status === "done" ? 100 : 0);
              // WHAT IS HAPPENING comes from the state, and only HOW FAR from the percentage
              // (#602 T3). The old fallback did it the other way round — anything the table could
              // not name fell through to `pct < 8 ? "Queued" : "Generating …"`, so a cancelled
              // card announced a percentage of a job that had stopped.
              const inFlight = isInFlightCardFace(obj.status);
              const cancelled = obj.status === "cancelled";
              const phase = obj.status === "done"
                ? "Ready"
                : obj.status === "failed"
                  ? "Failed"
                  : obj.status === "cancelled"
                    ? "Cancelled"
                    : obj.status === "timeout"
                      ? "Status uncertain"
                      : obj.status === "missing"
                        ? "Media missing"
                        : obj.status === "queued"
                          ? "Queued"
                          : obj.status === "generating"
                            ? (pct < 85 ? `Generating ${pct}%` : "Refining…")
                            : "Status unknown";
              const objectRequest = obj.actionId
                ? retryRequests[obj.actionId]
                : undefined;
              return (
                <div
                  key={obj.id}
                  className="absolute"
                  style={{ left: obj.x, top: obj.y, width: obj.w }}
                >
                  <div
                    role="group"
                    tabIndex={0}
                    aria-label={`${obj.ref} · ${obj.title}${isSel ? " · selected" : ""}`}
                    aria-keyshortcuts="Enter Space"
                    onPointerDown={(e) => onNodePointerDown(e, obj)}
                    onPointerMove={onNodePointerMove}
                    onPointerUp={() => onNodePointerUp(obj)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (e.shiftKey || e.metaKey || e.ctrlKey) {
                          setSelected((current) => current.includes(obj.id)
                            ? current.filter((id) => id !== obj.id)
                            : [...current, obj.id]);
                        } else {
                          setSelected([obj.id]);
                        }
                      }
                    }}
                    className={cn(
                      "relative cursor-move touch-none overflow-hidden rounded-[14px] border bg-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                      isSel ? "border-brand border-2" : "border-border",
                    )}
                    style={{
                      height: obj.h,
                      ...(sweepId === obj.id ? SWEEP_STYLE : undefined),
                      ...(inFlight && pct === 0 ? LAND_STYLE : {}),
                    }}
                  >
                    {/* 内容 / C4 中间态 */}
                    {inFlight && pct < 85 ? (
                      <div className="flex size-full flex-col items-center justify-center gap-2 bg-muted">
                        <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground tabular-nums">{phase}</span>
                        <span className="relative h-[5px] w-24 overflow-hidden rounded-full border border-border bg-background">
                          <span className="absolute top-0 left-0 h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="text-[11px] text-muted-foreground">Credits reserved on acceptance · terminal failures refund</span>
                      </div>
                    ) : cancelled ? (
                      // THE MERCHANT'S OWN DECISION, NOT A FAILURE (#602 T3 · spec #599 D4).
                      // No warning tone and no retry button: nothing went wrong, they stopped it,
                      // and the hold went back at that moment. Offering "try again" here reads as
                      // an apology for something they chose.
                      <div className="flex size-full flex-col items-center justify-center gap-1.5 bg-muted p-4 text-center">
                        <span className="text-[12px] font-semibold text-foreground">Cancelled</span>
                        <span className="text-[11px] leading-4 text-muted-foreground">You stopped this one — you weren&rsquo;t charged.</span>
                      </div>
                    ) : obj.status === "failed" || obj.status === "timeout" || obj.status === "missing" || obj.status === "unknown" ? (
                      <div className="flex size-full flex-col items-center justify-center gap-2 bg-muted p-4 text-center">
                        <span className="text-[12px] font-semibold text-foreground">{phase}</span>
                        <span className="text-[11px] leading-4 text-muted-foreground">{obj.error ?? "Reload the saved status or retry the same action."}</span>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-8 px-2.5 text-xs"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => {
                            if (objectRequest && obj.status === "failed") retryRequest(objectRequest, "new-action");
                            else if (objectRequest && obj.status === "timeout") retryRequest(objectRequest, "same-action");
                            else void runtime.reload();
                          }}
                        >
                          <Repeat className="size-3.5" strokeWidth={2} />
                          {objectRequest && obj.status === "failed"
                            ? "Set up a new action"
                            : objectRequest && obj.status === "timeout" ? "Check same action" : "Reload status"}
                        </Button>
                      </div>
                    ) : obj.src ? (
                      <>
                        {obj.kind === "video" ? (
                          <video
                            src={obj.src}
                            aria-label={obj.title}
                            controls
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={(event) => {
                              const duration = event.currentTarget.duration;
                              if (!Number.isFinite(duration) || duration <= 0) return;
                              const exactDuration = Math.round(duration * 10) / 10;
                              setObjects((current) => current.map((item) => item.id === obj.id && item.duration !== exactDuration
                                ? { ...item, duration: exactDuration }
                                : item));
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            className={cn("size-full bg-black object-contain", inFlight && "opacity-70 blur-[1px]")}
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={obj.src}
                            alt={obj.title}
                            draggable={false}
                            className={cn("size-full object-cover", inFlight && "opacity-70 blur-[1px]")}
                          />
                        )}
                        {inFlight && (
                          <span className="absolute inset-x-2 bottom-2 rounded-md bg-primary/70 px-2 py-0.5 text-center font-mono text-[10px] text-primary-foreground tabular-nums">
                            {phase}
                          </span>
                        )}
                      </>
                    ) : (
                      <div className="flex size-full items-center justify-center bg-muted text-[11px] text-muted-foreground">Waiting for media…</div>
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
                      {obj.example && (
                        <span className="flex h-5 items-center rounded-full bg-card/90 px-1.5 font-mono text-[9px] leading-none font-medium text-foreground shadow-[var(--shadow-xs)]">
                          Example
                        </span>
                      )}
                    </span>

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
                  {isSel && singleSelected?.id === obj.id && obj.status === "done" && (
                    <ObjectToolbar
                      obj={obj}
                      feedback={feedback[obj.id] ?? null}
                      onFeedback={(v) => setFeedback((f) => ({ ...f, [obj.id]: v }))}
                      onMakeVideo={() => queueVideoRequest(`Animate: ${obj.prompt}`, obj)}
                      onDelete={() => { void deleteObjects([obj.id]); }}
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
                        prefillComposer(obj.kind === "image" ? "image" : "video", text);
                        showFlash(obj.kind === "image" ? "Review the exact image price, then send" : "Review the exact video price, then confirm");
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* [wave-c] 空画布起步态(STALL #6):不再只有一片灰点点。居中 Otto 云 + 一句人话
             + 零打字起手式(点一下填进 composer,店主再亲手发)。跟随视口居中(不进 pan/zoom
             变换),reduced-motion 无动画。pointer-events 只给卡片,画布其余处仍可 pan。 */}
          {objects.length === 0 && !runtime.isLoading && (
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center p-6">
              <div className="pointer-events-auto flex w-full max-w-[420px] flex-col items-center text-center">
                <OttoAvatar size={48} mood="idle" />
                <h2 className="mt-4 text-[20px] leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
                  A blank canvas, all yours
                </h2>
                <p className="mt-1.5 max-w-[340px] text-[13px] leading-[18px] text-muted-foreground">
                  Make images here with the exact price shown before Send. Video asks for confirmation. Agent work opens in the real Otto workspace.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  {CANVAS_STARTERS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => prefillComposer(s.mode, s.draft)}
                      className="ns-pressable flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                    >
                      {s.mode === "image" ? (
                        <ImageIcon className="size-3.5 text-muted-foreground" strokeWidth={2} />
                      ) : s.mode === "video" ? (
                        <Video className="size-3.5 text-muted-foreground" strokeWidth={2} />
                      ) : (
                        <Sparkles className="size-3.5 text-muted-foreground" strokeWidth={2} />
                      )}
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 缩放器(B1:25%–300% + Zoom-to-fit) */}
          <div className="absolute bottom-4 left-4 z-[10] flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-1 shadow-[var(--shadow-md)]">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - 0.2) * 10) / 10))}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-[transform,background-color,color] duration-[120ms] hover:bg-accent hover:text-foreground active:scale-[0.9]"
            >
              <Minus className="size-4" strokeWidth={2} />
            </button>
            <span className="w-11 text-center font-mono text-[11px] leading-[14px] font-medium text-foreground tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + 0.2) * 10) / 10))}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-[transform,background-color,color] duration-[120ms] hover:bg-accent hover:text-foreground active:scale-[0.9]"
            >
              <Plus className="size-4" strokeWidth={2} />
            </button>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Zoom to fit"
                  onClick={zoomToFit}
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-[transform,background-color,color] duration-[120ms] hover:bg-accent hover:text-foreground active:scale-[0.9]"
                >
                  <Scan className="size-4" strokeWidth={2} />
                </button>
              </TooltipTrigger>
              <TooltipContent>Zoom to fit</TooltipContent>
            </Tooltip>
          </div>

          {/* 多选批量条(F1)— 右下;恰好 2 视频 → Stitch + play;同源 2 对象 → Compare */}
          {selectedObjects.length > 1 && (
            <div className="absolute right-4 bottom-16 z-[10] flex max-w-[calc(100%-2rem)] items-center gap-1 overflow-x-auto rounded-[14px] border border-border bg-card p-1.5 shadow-[var(--shadow-md)]" style={LAND_STYLE}>
              <span className="px-2 font-mono text-[11px] leading-[14px] font-medium text-muted-foreground tabular-nums">
                {selectedObjects.length} selected
              </span>
              {canCompare && (
                <Button variant="secondary" size="sm" className="h-8 px-2.5 text-xs" onClick={() => setCompareIds(selected.slice())}>
                  <Columns2 className="size-3.5" strokeWidth={2} />
                  Compare
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" onClick={groupSelected}>
                <Layers className="size-3.5" strokeWidth={2} />
                Group
              </Button>
              <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" disabled title="Duplicate is not persisted by the live runtime yet">
                <Copy className="size-3.5" strokeWidth={2} />
                Duplicate · coming soon
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs"
                disabled
                title="Campaign promotion is not connected to the live runtime yet"
              >
                <FolderPlus className="size-3.5" strokeWidth={2} />
                Campaign · coming soon
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs"
                disabled
                title="Batch download is not connected in this vertical yet"
              >
                <Download className="size-3.5" strokeWidth={2} />
                Download · coming soon
              </Button>
              {exactlyTwoVideos && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    disabled
                    title="Stitch is not connected to the live generation runtime yet"
                  >
                    <Scissors className="size-3.5" strokeWidth={2} />
                    Stitch · coming soon
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" disabled aria-label="Play sequence unavailable">
                    <Play className="size-3.5" strokeWidth={2} />
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs text-error-soft-foreground hover:bg-error-soft" onClick={() => { void deleteObjects(selected); }}>
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

          {/* 轻量 toast(诚实反馈条) */}
          {flash && (
            <div
              role="status"
              className="absolute bottom-16 left-1/2 z-[10] flex -translate-x-1/2 items-center rounded-full border border-border bg-card px-3 py-1.5 shadow-[var(--shadow-md)]"
              style={LAND_STYLE}
            >
              <span className="text-[13px] text-foreground">{flash}</span>
            </div>
          )}

          {/* evolve 分叉并排对比(GOAL §6:选中父+子 → Compare → 两版同屏) */}
          {compareObjects.length === 2 && (
            <div
              ref={compareDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="canvas-compare-title"
              tabIndex={-1}
              className="absolute inset-0 z-30 flex flex-col bg-background/80 p-3 outline-none backdrop-blur-sm sm:p-6"
              style={LAND_STYLE}
            >
              <div className="flex items-center justify-between pb-4">
                <span id="canvas-compare-title" className="text-sm font-semibold text-foreground">
                  Comparing {compareObjects[0].ref} and {compareObjects[1].ref}
                </span>
                <button
                  type="button"
                  aria-label="Close compare"
                  onClick={() => setCompareIds(null)}
                  className="flex size-8 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-4" strokeWidth={2} />
                </button>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto sm:grid-cols-2">
                {compareObjects.map((o) => (
                  <div key={o.id} className="flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-border bg-card">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                      <span className="flex h-5 items-center gap-1 rounded-full bg-primary/75 px-1.5 font-mono text-[10px] leading-none font-medium text-primary-foreground">
                        {o.kind === "image" ? <ImageIcon className="size-3" strokeWidth={2} /> : <Video className="size-3" strokeWidth={2} />}
                        {o.ref}
                      </span>
                      {o.fork && (
                        <span className="flex h-5 items-center rounded-full bg-secondary px-1.5 font-mono text-[10px] leading-none font-medium text-secondary-foreground">
                          {o.fork}
                        </span>
                      )}
                      <span className="truncate text-[13px] font-medium text-foreground">{o.title}</span>
                    </div>
                    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
                      {o.kind === "video" ? (
                        <video
                          src={o.src}
                          aria-label={o.title}
                          controls
                          playsInline
                          preload="metadata"
                          className="max-h-full max-w-full rounded-[10px] bg-black object-contain"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.src} alt={o.title} className="max-h-full max-w-full rounded-[10px] object-contain" />
                      )}
                    </div>
                    <p className="border-t border-border px-3 py-2 text-[12px] leading-[16px] text-muted-foreground">{o.prompt}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Video is the confirmation boundary. The amount is the current server-derived quote. */}
      <SpendConfirmDialog
        open={spendAsk !== null}
        onOpenChange={(v) => !v && setSpendAsk(null)}
        title="Generate this video?"
        ask={spendAsk ? `This exact video request costs ${spendAsk.credits} credits.` : "Loading the exact price…"}
        impacts={[
          spendAsk?.request.sourceNodeId
            ? "The video will land next to the selected generated image with its source lineage."
            : "The text-to-video result will land on this project canvas.",
          spendAsk ? `${spendAsk.credits} credits is the current exact quote; it is reserved when the request is accepted and refunded on terminal failure.` : "Nothing can submit without a quote.",
          "If the outcome is uncertain, retry keeps the same action ID instead of starting a second intent.",
        ]}
        confirmLabel={spendAsk ? `Confirm generate · ${spendAsk.credits} credits` : "Confirm generate"}
        onConfirm={() => {
          const ask = spendAsk;
          setSpendAsk(null);
          if (!ask) return;
          void runRuntimeRequest(ask.request);
        }}
      />
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

  const tool = (label: string, icon: React.ReactNode, onClick?: () => void, href?: string, danger?: boolean, disabled?: boolean) => {
    // [wave-c] §G1 pointer-down 手感:按下即缩(active scale),reduced-motion 由全局 clamp 压平。
    const cls = cn(
      "flex size-8 items-center justify-center rounded-[10px] transition-[transform,background-color,color] duration-[120ms] active:scale-[0.92]",
      danger
        ? "text-error-soft-foreground hover:bg-error-soft"
        : "text-muted-foreground hover:bg-accent hover:text-foreground",
      disabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground active:scale-100",
    );
    return (
      <Tooltip key={label}>
        <TooltipTrigger asChild>
          {href && !disabled ? (
            <Link href={href} aria-label={label} className={cls} onPointerDown={(e) => e.stopPropagation()}>
              {icon}
            </Link>
          ) : (
            <button type="button" aria-label={label} title={disabled ? label : undefined} disabled={disabled} onClick={onClick} onPointerDown={(e) => e.stopPropagation()} className={cls}>
              {icon}
            </button>
          )}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="absolute left-1/2 z-20 w-max max-w-[min(92vw,720px)] -translate-x-1/2 pt-2" style={{ top: "100%" }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="max-w-full overflow-x-auto rounded-[14px]">
      <div className="flex w-max items-center gap-0.5 rounded-[14px] border border-border bg-card p-1 shadow-[var(--shadow-md)]" style={LAND_STYLE}>
        {obj.kind === "image" ? (
          <>
            {tool("Make video", <Video className="size-4" strokeWidth={2} />, onMakeVideo)}
            {tool("Crop", <Crop className="size-4" strokeWidth={2} />, undefined, `/northstar-immersive/create/media-editor?asset=${encodeURIComponent(obj.id)}`)}
          </>
        ) : (
          <>
            {tool("Trim", <Scissors className="size-4" strokeWidth={2} />, undefined, `/northstar-immersive/create/media-editor?asset=${encodeURIComponent(obj.id)}`)}
            {tool("Extract frame", <ImageIcon className="size-4" strokeWidth={2} />, undefined, `/northstar-immersive/create/media-editor?asset=${encodeURIComponent(obj.id)}`)}
            {tool("Effects", <Wand2 className="size-4" strokeWidth={2} />, undefined, `/northstar-immersive/create/media-editor?asset=${encodeURIComponent(obj.id)}`)}
          </>
        )}
        {tool("Full screen", <Maximize2 className="size-4" strokeWidth={2} />, undefined, `/northstar-immersive/create/asset-viewer?asset=${encodeURIComponent(obj.id)}`)}
        {tool("Add to campaign · coming soon", <FolderPlus className="size-4" strokeWidth={2} />, undefined, undefined, false, true)}
        {tool("Prompt", <Menu className="size-4" strokeWidth={2} />, onPrompt)}
        <span className="mx-0.5 h-5 w-px bg-border" />
        <FeedbackControls value={feedback} onChange={onFeedback} />
        <span className="mx-0.5 h-5 w-px bg-border" />
        {tool("Delete", <Trash2 className="size-4" strokeWidth={2} />, onDelete, undefined, true)}
      </div>
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
          {obj.kind === "image" ? "price shown" : "asks first"}
        </span>
        <Button type="submit" size="icon" className="size-8 rounded-[10px]" aria-label="Imagine">
          <ArrowUp className="size-4" strokeWidth={2.2} />
        </Button>
      </form>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * LineageRow — 血缘树 mini 视图的一行(GOAL §5:点选即选中画布对象)
 * ──────────────────────────────────────────────────────────────────────── */
function LineageRow({ obj, selected, onSelect }: { obj: CvObject; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-8 w-full items-center gap-1.5 rounded-[8px] px-2 text-left text-[12px] transition-colors duration-[120ms]",
        selected ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {obj.parentId ? (
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
      ) : obj.kind === "image" ? (
        <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
      ) : (
        <Video className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
      )}
      <span className="shrink-0 font-mono text-[11px] tabular-nums">{obj.ref}</span>
      <span className="truncate">{obj.title}</span>
      {obj.fork && (
        <span className="ml-auto shrink-0 rounded-full bg-secondary px-1 font-mono text-[9px] leading-4 text-secondary-foreground">{obj.fork}</span>
      )}
    </button>
  );
}
