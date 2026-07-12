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
import { useSearchParams } from "next/navigation";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
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
  Pause,
  Play,
  Plus,
  Repeat,
  Scan,
  Scissors,
  Search,
  Sparkles,
  Square,
  Trash2,
  Video,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useInsideImmersive } from "../immersive/_context";
import { useQueryParam, useSweep } from "../immersive/_kit";
// [wave-c] §O7「Otto 帮我」共享原语 —— composer 挂一颗即得 dock 承接 + 意图 chip + Apply 回填。
import { OttoAssist } from "../immersive/otto-assist";
// [wave-c] 空态 hero 的 Otto 云(≥16px 用有眼 avatar,§O1;idle 心情)。
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import {
  balance as getBalance,
  castPersonas,
  ottoWorking as setOttoWorking,
  promoteToCampaign,
  promotedCampaignsOf,
  recentEvents,
  registerCanvasObject,
  spendCredits,
  useStore,
} from "../immersive/_store";
import { MockNote } from "../_shared";
import { NS_CAMPAIGNS } from "../_mock";
// [cx-canvas-runtime] 断层 3/5 ②:品牌记忆「Make for them」带 ?audience=,选角「Make with this face」
// 带 ?persona=;canvas 读它解析出上下文名,显示可关 context chip 并预填进 prompt 前缀。
import { AUDIENCE_PROFILES } from "../immersive/assets/data";
import { PERSONAS } from "../assets/_data";
import {
  CV_HISTORY,
  CV_PROJECTS,
  CV_SESSION_SEEDS,
  CV_SESSIONS,
  cvImage,
  resolveCanvasSeed,
  type CvChatTurn,
  type CvObject,
} from "./_fixtures";

/** [wave-b] Add to campaign — D1 升格目标:ACTIVE / DRAFT 的 campaign(DONE 已完结不可再挂)。 */
const PROMOTE_TARGETS = NS_CAMPAIGNS.filter((c) => c.status !== "DONE");
import {
  FeedbackControls,
  InkNarrationPill,
  LAND_STYLE,
  SpendConfirmDialog,
  SWEEP_STYLE,
  useCreateKeyframes,
  type FeedbackValue,
  type GenTier,
} from "./_create-ui";

type Mode = "image" | "video" | "agent";
type SideTab = "chat" | "projects" | "history" | "tree";

const VIDEO_COST = 40;
const IMAGE_COST = 12;
const STITCH_COST = 20;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

// [wave-c] Studio canvas · 无参进入 = 一张真正的空画布(STALL #1/#6:第一眼不再落进别人的
// 示例会话);种子会话(Merdeka / Croissant / Menu)降为侧栏「示例」。
const FRESH_SESSION_ID = "cv-fresh";

/** [wave-c] 空画布起步的零打字起手式(STALL #6/#7)。一份源同时喂空态 chip 与 §O7 意图。
 * 诚实:只是把示例文案填进 composer,店主再亲手发;冷启动无个人数据,用「行业默认」口吻,
 * 不假装懂这家店。`reply` 是 Otto 在 dock 里的回应(原型无真模型,写实、不夸口)。 */
const CANVAS_STARTERS: { id: string; label: string; mode: Mode; draft: string; prompt: string; reply: string }[] = [
  {
    id: "product",
    label: "A product photo of what I sell",
    mode: "image",
    draft: "A clean product photo of what I sell on a plain surface, soft morning light, simple background",
    prompt: "Help me describe a product photo of what I sell",
    reply: "Here's a prompt to start from — tweak anything before you send: a clean product photo of what you sell on a plain surface, soft morning light, simple background. You'll see the cost before it generates.",
  },
  {
    id: "reel",
    label: "A short reel of my shop",
    mode: "video",
    draft: "A 6-second reel of my shop counter in the morning, warm light, close on what I sell",
    prompt: "Help me describe a short reel of my shop",
    reply: "Try this one: a 6-second reel of your shop counter in the morning, warm light, close on what you sell. Video asks before it spends.",
  },
  {
    id: "ideas",
    label: "3 post ideas for this week",
    mode: "agent",
    draft: "Give me 3 post ideas for this week",
    prompt: "Give me 3 post ideas for this week",
    reply: "On it — I'll lay out three post ideas you can turn into images or a reel. Nothing's charged until you pick one and confirm.",
  },
];

/* ── Agent 澄清脑回路(GOAL H1a/H1b:确定性规则,不是真 LLM) ────────────────
 * runAgent 不再固定出 4 clip。先按用户输入粗分意图(H1a),再最多两轮结构化追问
 * (H1b),数量/预算随答案变化。 */
type AgentIntent = "image" | "edit" | "video";

interface ClarifyQ {
  key: string;
  prompt: string;
  options: { label: string; value: string }[];
}

/** H1a:意图粗分(关键词规则)。 */
function detectIntent(text: string): AgentIntent {
  const t = text.toLowerCase();
  if (/\b(edit|change|tweak|fix|retouch|adjust|remove|replace|recolor|recolour|crop|swap)\b/.test(t)) return "edit";
  if (/\b(video|reel|clip|animate|animation|motion|footage|tiktok|film|shoot)\b/.test(t)) return "video";
  return "image";
}

/** H1b:每种意图挑最相关的两维追问(卡片式确定性选项)。 */
const CLARIFY_QUESTIONS: Record<AgentIntent, ClarifyQ[]> = {
  video: [
    { key: "count", prompt: "How many clips?", options: [{ label: "1 clip", value: "1" }, { label: "2 clips", value: "2" }, { label: "4 clips", value: "4" }] },
    { key: "length", prompt: "How long each?", options: [{ label: "6s", value: "6" }, { label: "10s", value: "10" }] },
  ],
  image: [
    { key: "count", prompt: "How many to try?", options: [{ label: "1", value: "1" }, { label: "2 (A/B)", value: "2" }, { label: "4", value: "4" }] },
    { key: "ratio", prompt: "What shape?", options: [{ label: "1:1", value: "1:1" }, { label: "4:5", value: "4:5" }, { label: "9:16", value: "9:16" }] },
  ],
  edit: [
    { key: "target", prompt: "What should change?", options: [{ label: "Background", value: "background" }, { label: "Colours", value: "colours" }, { label: "Text", value: "text" }, { label: "Crop", value: "crop" }] },
    { key: "count", prompt: "How many options?", options: [{ label: "1", value: "1" }, { label: "2 (A/B)", value: "2" }] },
  ],
};

const INTENT_META: Record<AgentIntent, { unit: string; costEach: number; category: "Video" | "Image" }> = {
  video: { unit: "clip", costEach: VIDEO_COST, category: "Video" },
  image: { unit: "image", costEach: IMAGE_COST, category: "Image" },
  edit: { unit: "edit", costEach: IMAGE_COST, category: "Image" },
};

interface GenJob {
  objectId: string;
  pct: number;
}

/** 视觉 group frame(F1:Group)—— 记录成员 + 一个 label,画布画外框。 */
interface CvGroup {
  id: string;
  objectIds: string[];
  label: string;
}

/** 两对象是否同源可比(父子 / 同父兄弟)—— evolve 分叉并排对比闸(GOAL §6)。 */
function comparable(a: CvObject, b: CvObject): boolean {
  if (a.kind !== b.kind) return false;
  return a.parentId === b.id || b.parentId === a.id || (!!a.parentId && a.parentId === b.parentId);
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

export function CanvasPage() {
  useCreateKeyframes();
  useStore(); // 订阅共享 store(余额 / Otto 工作态 / 事件流 = 单一循环系统)

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
  const bootSessionId = "cv-boot";
  const bootObjects = React.useMemo(() => (bootSeed ? [bootSeed] : null), [bootSeed]);
  const bootTurns = React.useMemo<CvChatTurn[] | null>(
    () =>
      bootSeed
        ? [
            {
              id: "t-boot",
              from: "otto",
              text: `Brought “${bootSeed.title}” onto a fresh canvas. Evolve it, animate it, or tell me what to change.`,
              objectIds: [bootSeed.id],
            },
          ]
        : null,
    [bootSeed],
  );

  // [wave-c] 空画布起步的 Otto 开场白(STALL #6 + §8e 续播)。三态:①带受众/选角上下文
  // (品牌记忆 / 选角接力)②带 ?prompt 前台指示(从别处 escort 过来,如广告「换个素材」——
  // 把指示放进 composer,承接现场)③冷启动全空(引导零打字起手式)。不夸口、不假装有历史。
  const welcomeTurns = React.useMemo<CvChatTurn[]>(
    () => [
      {
        id: "t-welcome",
        from: "otto",
        text: canvasContext
          ? `Fresh canvas, set up for ${canvasContext.name}. Tell me what to make, or tap a starter below. Video and Otto's plans ask before spending; images show their cost before you send.`
          : promptParam
            ? `Picking up where you were — I dropped your note in the composer. Tweak it and send when you're ready. Nothing's charged yet.`
            : `Blank canvas, all yours. Tell me what to make on the left, or tap a starter below. Video and Otto's plans ask before spending; images show their cost before you send.`,
      },
    ],
    [canvasContext, promptParam],
  );

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
  const [playingVideo, setPlayingVideo] = React.useState<string | null>(null);
  const [undoChip, setUndoChip] = React.useState<CvObject[] | null>(null);
  const [groups, setGroups] = React.useState<CvGroup[]>([]);
  const [compareIds, setCompareIds] = React.useState<string[] | null>(null);
  const [batchPromoteOpen, setBatchPromoteOpen] = React.useState(false); // [wave-b] Add to campaign(多选批量升格)
  const [flash, setFlash] = React.useState<string | null>(null);
  const flashTimer = React.useRef<number | null>(null);

  // ── 会话 / chat 状态 ──
  // 会话列表用本地 state(种子 + boot 会话 + 「New agent」新建的会话),让切换器/侧栏读同一份可增长列表。
  const [sessions, setSessions] = React.useState<{ id: string; name: string }[]>(() => {
    const base = CV_SESSIONS.map((s) => ({ id: s.id, name: s.name }));
    // [wave-c] 侧栏第一条永远是本人的空「New canvas」;种子 ss-* 留作可点的示例。
    return [{ id: bootSeed ? bootSessionId : FRESH_SESSION_ID, name: "New canvas" }, ...base];
  });
  const [sessionId, setSessionId] = React.useState<string>(bootSeed ? bootSessionId : FRESH_SESSION_ID);
  const [sessionMenu, setSessionMenu] = React.useState(false);
  const [turns, setTurns] = React.useState<CvChatTurn[]>(bootTurns ?? welcomeTurns);
  const [mode, setMode] = React.useState<Mode>("agent");
  // context 前缀 + ?prompt 一起作为输入框初值(context chip 承诺的上下文一落地就预填)。
  const [draft, setDraft] = React.useState((canvasContext?.prefix ?? "") + (promptParam ?? ""));
  const [streaming, setStreaming] = React.useState(false);
  const [streamSteps, setStreamSteps] = React.useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [feedback, setFeedback] = React.useState<Record<string, FeedbackValue>>({});
  const [sideTab, setSideTab] = React.useState<SideTab>("chat");
  const [sideSearch, setSideSearch] = React.useState("");
  // 沉浸式外壳内:壳级 240 导航已提供 New 与 History,画布 A3 栏收敛为「工作区上下文」
  // (Search + Chat 会话 + Projects),不再并列成第二条全局导航(蓝图 canvas double-rail 修法)。
  const insideImmersive = useInsideImmersive();

  // ── 生成 / 花费状态 ──（余额是 store 的,不再本地 fork）
  const bal = getBalance();
  const [jobs, setJobs] = React.useState<GenJob[]>([]);
  const [narration, setNarration] = React.useState<string | null>(null);
  const [historyNew, setHistoryNew] = React.useState(0);
  const [spendAsk, setSpendAsk] = React.useState<
    | { kind: "make-video"; sourceId: string }
    | { kind: "evolve-video"; sourceId: string; prompt: string }
    // [wave-c] 空画布直接要视频(无源):STALL 空态起步接住 —— 仍走花费确认(钱法不变)。
    | { kind: "make-fresh-video"; prompt: string }
    // [wave-c-audit R1] 空画布/无源的头一张图也先问后花(安全 > 效率):图直出(余额即闸)
    // 只保留给「就地进化既有图」;冷启动店主的第一次花费必须被问,兑现宪法「花钱前先问」,
    // 别让刚被告知的店主在没被问的情况下被扣 2×IMAGE_COST。
    | { kind: "make-fresh-image"; prompt: string }
    | { kind: "agent-plan"; intent: AgentIntent; brief: string; count: number }
    | { kind: "stitch"; ids: string[] }
    | null
  >(null);
  // Agent 澄清脑回路状态(H1a/H1b):step -1 = 意图确认卡;0..n = 结构化追问
  const [clarify, setClarify] = React.useState<{
    intent: AgentIntent;
    brief: string;
    step: number;
    answers: Record<string, string>;
  } | null>(null);

  // 轻量 toast(诚实反馈:download / play both 等无真产物的动作)—— 复用底部居中 chip。
  const showFlash = React.useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2600);
  }, []);
  React.useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  const timersRef = React.useRef<number[]>([]);
  React.useEffect(() => () => timersRef.current.forEach((t) => window.clearInterval(t)), []);

  const canvasRef = React.useRef<HTMLDivElement>(null);
  const chatEndRef = React.useRef<HTMLDivElement>(null);
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  // [wave-c] §O7 Apply / 空态起手式回填 composer 时的一次性 coral sweep(§8a)。
  const composerSweep = useSweep();

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

  // Escape 剥一层(§N8):菜单 → prompt 卡 → 选区
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (sessionMenu) setSessionMenu(false);
      else if (mentionOpen) setMentionOpen(false);
      else if (batchPromoteOpen) setBatchPromoteOpen(false);
      else if (promptFor) setPromptFor(null);
      else setSelected([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionMenu, mentionOpen, batchPromoteOpen, promptFor]);

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [turns, streamSteps, clarify]);

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
      // [cx-canvas-runtime] 断层 3/5 ①:evolve / make-video / A-B / stitch / agent-plan 五处生成
      // 全部经此收口,统一登记进共享 store 运行时注册表,让贴附工具条深链到的 asset-viewer /
      // media-editor 能按同一 id 取回同一张(而不是打开 fallback 样例)。
      newObjects.forEach((o) =>
        registerCanvasObject({
          id: o.id,
          kind: o.kind,
          imageUrl: o.src,
          posterUrl: o.src,
          prompt: o.prompt,
          title: o.title,
          lineage: o.parentId,
          ref: o.ref,
          duration: o.duration,
          credits: o.credits,
        }),
      );
      setJobs((prev) => [...prev, ...newObjects.map((o) => ({ objectId: o.id, pct: 0 }))]);
      setNarration(narrationText);
      setOttoWorking(true, narrationText.replace(/…$/, "")); // 生成开始 → dock 徽点脉冲
      // 进度与完成判定放在 updater 之外(setJobs updater 必须纯):进度存闭包 progress,
      // remaining 收敛到 0 时收口一次。否则把 setObjects/setSweepId/setOttoWorking/onAllDone
      // 等副作用塞进 setJobs updater 会在 render 阶段写 ImmersiveNav 订阅的共享 store —— 触发
      // 「Cannot update ImmersiveNav while rendering CanvasPage」;且 StrictMode 双调 updater
      // 会把「All N are ready」气泡 / onAllDone 触发两次。
      const progress = new Map<string, number>(newObjects.map((o) => [o.id, 0]));
      let remaining = newObjects.length;
      newObjects.forEach((obj, i) => {
        const timer = window.setInterval(() => {
          const pct = Math.min(100, (progress.get(obj.id) ?? 0) + 6 + i * 2);
          progress.set(obj.id, pct);
          setJobs((prev) => prev.map((j) => (j.objectId === obj.id ? { ...j, pct } : j)));
          if (pct < 100) return;
          window.clearInterval(timer);
          setObjects((os) => os.map((o) => (o.id === obj.id ? { ...o, status: "ready" } : o)));
          setSweepId(obj.id);
          window.setTimeout(() => setSweepId((s) => (s === obj.id ? null : s)), 650);
          setHistoryNew((n) => n + 1);
          remaining -= 1;
          if (remaining === 0) {
            window.setTimeout(() => {
              setNarration(null);
              setJobs([]);
            }, 400);
            setOttoWorking(false); // 全部完成 → Otto idle
            onAllDone?.();
          }
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
    spendCredits(IMAGE_COST, prompt.slice(0, 40) || "New image", "Image"); // 图直出:余额即闸,store 立即入账
    startGeneration(
      [
        {
          id,
          ref: `Image ${n}`,
          kind: "image",
          title: prompt.slice(0, 40),
          prompt,
          src: cvImage("image", n),
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

  const makeVideo = (source: CvObject, prompt: string, credits: number = VIDEO_COST) => {
    refCounter.current.video += 1;
    const n = refCounter.current.video;
    const id = `cv-vid-${n}-${nextUid()}`;
    spendCredits(credits, prompt.slice(0, 40) || "New video", "Video"); // 边界 A:确认后立即入账,余额即时刷新
    startGeneration(
      [
        {
          id,
          ref: `Video ${n}`,
          kind: "video",
          title: prompt.slice(0, 40),
          prompt,
          src: cvImage("video", n),
          x: source.x + source.w + 56,
          y: source.y - 20,
          w: 168,
          h: 300,
          status: "generating",
          parentId: source.id,
          duration: 6,
          credits,
        },
      ],
      "Generating video…",
    );
  };

  // [wave-c] 空画布无源视频:落在画布左上默认位,无父;定位有别于 evolve(不需要 source)。
  const makeFreshVideo = (prompt: string, credits: number = VIDEO_COST) => {
    refCounter.current.video += 1;
    const n = refCounter.current.video;
    const id = `cv-vid-${n}-${nextUid()}`;
    spendCredits(credits, prompt.slice(0, 40) || "New video", "Video");
    startGeneration(
      [
        {
          id,
          ref: `Video ${n}`,
          kind: "video",
          title: prompt.slice(0, 40) || "New video",
          prompt,
          src: cvImage("video", n),
          x: 96,
          y: 120,
          w: 168,
          h: 300,
          status: "generating",
          duration: 6,
          credits,
        },
      ],
      "Generating video…",
    );
  };

  /* ── 图 A/B 分叉(GOAL §6 / N-Grok「A/B=要」):一次出两版并排,fork A/B,自动选中 → Compare 条即出 ── */
  const evolveImageAB = (source: CvObject | null, prompt: string) => {
    const baseX = source ? source.x + source.w + 56 : 96;
    const baseY = source ? source.y : 120;
    const w = source ? source.w : 200;
    const h = source ? source.h : 200;
    spendCredits(2 * IMAGE_COST, `A/B · ${prompt.slice(0, 32) || "New image"}`, "Image"); // 图直出:余额即闸
    const pair: CvObject[] = (["A", "B"] as const).map((fork, i) => {
      refCounter.current.image += 1;
      const n = refCounter.current.image;
      return {
        id: `cv-img-${n}-${nextUid()}`,
        ref: `Image ${n}`,
        kind: "image" as const,
        title: `${prompt.slice(0, 36) || "New image"} · ${fork}`,
        prompt,
        src: cvImage("image", n),
        x: baseX + i * (w + 32),
        y: baseY,
        w,
        h,
        status: "generating" as const,
        parentId: source?.id, // 同父 → comparable(GOAL §6 并排对比闸)
        fork,
        credits: IMAGE_COST,
      };
    });
    // 无源时让 B 挂到 A 上,两版仍可比(comparable:b.parentId === a.id)
    if (!source) pair[1] = { ...pair[1], parentId: pair[0].id };
    startGeneration(pair, "Generating A and B…", () => setSelected(pair.map((o) => o.id)));
  };

  /* ── Agent 澄清脑回路(H1a/H1b):粗分意图 → 结构化追问 → 计划随答案变 → 花费确认 ── */
  const runAgent = (text: string) => {
    // 先跑一小段「读你的话」的思考,再弹澄清卡(不是固定 4-clip)
    setStreaming(true);
    setStreamSteps([]);
    const steps = ["Reading your brief", "Working out what you need"];
    steps.forEach((s, i) => {
      const t = window.setTimeout(() => setStreamSteps((prev) => [...prev, s]), 500 * (i + 1));
      timersRef.current.push(t as unknown as number);
    });
    const done = window.setTimeout(() => {
      setStreaming(false);
      setClarify({ intent: detectIntent(text), brief: text, step: -1, answers: {} });
    }, 500 * (steps.length + 1));
    timersRef.current.push(done as unknown as number);
  };

  // 意图确认(H1a):用户可改 Otto 的粗分
  const pickIntent = (intent: AgentIntent) =>
    setClarify((c) => (c ? { ...c, intent, step: 0 } : c));

  // 回答一维追问(H1b);答完最后一维 → 出计划 + 花费确认
  const answerClarify = (key: string, value: string) => {
    setClarify((c) => {
      if (!c) return c;
      const answers = { ...c.answers, [key]: value };
      const qs = CLARIFY_QUESTIONS[c.intent];
      const nextStep = c.step + 1;
      if (nextStep >= qs.length) {
        finishClarify(c.intent, c.brief, answers);
        return null;
      }
      return { ...c, answers, step: nextStep };
    });
  };

  const cancelClarify = () => {
    setClarify(null);
    setTurns((prev) => [...prev, { id: `t-${prev.length + 1}`, from: "otto", text: "No problem — nothing was made or charged." }]);
  };

  // 计划:数量/预算随答案变化,不再固定
  const finishClarify = (intent: AgentIntent, brief: string, answers: Record<string, string>) => {
    const count = Math.max(1, Number(answers.count ?? "1") || 1);
    const total = count * INTENT_META[intent].costEach;
    const detail =
      intent === "video"
        ? `${count} ${count === 1 ? "clip" : "clips"}, ${answers.length ?? "6"}s each`
        : intent === "image"
          ? `${count} ${count === 1 ? "image" : "images"}${answers.ratio ? ` · ${answers.ratio}` : ""}`
          : `${count} edit ${count === 1 ? "option" : "options"}${answers.target ? ` · ${answers.target}` : ""}`;
    setTurns((prev) => [
      ...prev,
      { id: `t-${prev.length + 1}`, from: "otto", text: `Got it — ${detail}. That's ${total} credits. Confirm to start.` },
    ]);
    setSpendAsk({ kind: "agent-plan", intent, brief, count });
  };

  const confirmAgentPlan = (intent: AgentIntent, brief: string, count: number, credits: number) => {
    spendCredits(credits, `${count} ${INTENT_META[intent].unit}${count > 1 ? "s" : ""} · ${brief.slice(0, 24)}`, INTENT_META[intent].category);
    const isVid = intent === "video";
    const bandY = 540;
    const forks: (("A" | "B") | undefined)[] = count === 2 ? ["A", "B"] : Array(count).fill(undefined);
    const items: CvObject[] = Array.from({ length: count }, (_, i) => {
      if (isVid) refCounter.current.video += 1;
      else refCounter.current.image += 1;
      const n = isVid ? refCounter.current.video : refCounter.current.image;
      const tag = forks[i] ? ` · ${forks[i]}` : count > 1 ? ` · ${i + 1}` : "";
      return {
        id: `cv-${isVid ? "vid" : "img"}-${n}-${nextUid()}`,
        ref: `${isVid ? "Video" : "Image"} ${n}`,
        kind: isVid ? ("video" as const) : ("image" as const),
        title: `${brief.slice(0, 28)}${tag}`,
        prompt: brief,
        src: cvImage(isVid ? "video" : "image", n),
        x: 40 + i * (isVid ? 196 : 232),
        y: bandY,
        w: isVid ? 168 : 200,
        h: isVid ? 300 : 200,
        status: "generating" as const,
        fork: forks[i],
        duration: isVid ? 6 : undefined,
        credits: INTENT_META[intent].costEach,
      };
    });
    // A/B(count===2)让两版可比:B 挂到 A → Compare 条即出
    if (count === 2) items[1] = { ...items[1], parentId: items[0].id };
    startGeneration(items, `Generating ${count} ${INTENT_META[intent].unit}${count > 1 ? "s" : ""}…`, () => {
      setTurns((prev) => [
        ...prev,
        {
          id: `t-${prev.length + 1}`,
          from: "otto",
          text: `All ${count} ${count > 1 ? "are" : "is"} ready on the canvas. You approved this. It used ${credits} credits.`,
          objectIds: items.map((c) => c.id),
        },
      ]);
      if (count === 2) setSelected(items.map((c) => c.id)); // A/B → 自动选中,Compare 条即出
    });
    setTurns((prev) => [
      ...prev,
      { id: `t-${prev.length + 1}`, from: "otto", text: `Generating ${count} ${INTENT_META[intent].unit}${count > 1 ? "s" : ""} in parallel. Each shows its own progress on the canvas.`, objectIds: items.map((c) => c.id) },
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
      // 图模式 = 一次出 A/B 两版并排(N-Grok 判决头号差异化点),自动选中 → Compare 条即出。
      const source = singleSelected ?? objects.find((o) => o.kind === "image") ?? null;
      if (source) {
        // 就地进化既有图 = 图直出(既定边界 A:余额即闸)—— 店主正看着这张、亲手改,非埋伏。
        evolveImageAB(source, text);
        setTurns((prev) => [
          ...prev,
          { id: `t-${prev.length + 1}`, from: "otto", text: "Making an A and a B take side by side, so you can pick the winner.", steps: ["Generating A and B"] },
        ]);
      } else {
        // [wave-c-audit R1] 空画布/无源的头一张图:先问后花(安全 > 效率)。冷启动店主刚被
        // 告知「花钱前先问」,不能在没被问的情况下被扣 2×IMAGE_COST —— 走花费确认再出 A/B。
        setSpendAsk({ kind: "make-fresh-image", prompt: text });
      }
    } else {
      // 视频过花费确认;空画布(无源)走 make-fresh-video,别再 objects[0] 崩。
      const source = singleSelected ?? objects.find((o) => o.kind === "video") ?? objects.find((o) => o.kind === "image") ?? null;
      if (source) setSpendAsk({ kind: "evolve-video", sourceId: source.id, prompt: text });
      else setSpendAsk({ kind: "make-fresh-video", prompt: text });
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
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, objectIds: g.objectIds.filter((id) => !ids.includes(id)) }))
        .filter((g) => g.objectIds.length > 1),
    );
    setSelected([]);
    setUndoChip(removed);
    window.setTimeout(() => setUndoChip((u) => (u === removed ? null : u)), 8000);
  };

  /* ── 会话切换(GOAL §2:每 session 独立 objects/turns 池;切换即换内容) ──
   * 把当前会话内容 stash 进 poolRef,载入目标会话(首访用种子,回访保留本会话编辑)。 */
  const poolRef = React.useRef<Record<string, { objects: CvObject[]; turns: CvChatTurn[] }>>({});
  const switchSession = (id: string) => {
    if (id === sessionId) return;
    // 停掉本会话在跑的生成计时器,快照落地为 ready —— 不让跨会话的 setState 污染下一屏
    timersRef.current.forEach((t) => window.clearInterval(t));
    timersRef.current = [];
    const cleaned = objects.map((o) => (o.status === "generating" ? { ...o, status: "ready" as const } : o));
    poolRef.current[sessionId] = { objects: cleaned, turns };
    // [wave-c] 未知 id(如空「New canvas」)回落到空画布 + 欢迎语,永不 undefined 崩。
    const next = poolRef.current[id] ?? CV_SESSION_SEEDS[id] ?? { objects: [], turns: welcomeTurns };
    setObjects(next.objects);
    setTurns(next.turns);
    refCounter.current = deriveCounters(next.objects);
    setSessionId(id);
    setJobs([]);
    setNarration(null);
    setOttoWorking(false);
    setSelected([]);
    setGroups([]);
    setPromptFor(null);
    setPlayingVideo(null);
    setCompareIds(null);
  };

  // 「New agent」真建一个空会话(不是关菜单的死按钮):种子空 pool → 切过去 → 空白画布起新一轮。
  const newAgent = () => {
    // [wave-c-audit] 本店主新建的画布用 cv- 前缀,别撞侧栏 `startsWith("ss-")` 的示例判定
    // (ss-* 是种子示例;这张是店主自己刚建的活,绝不该挂「Example」灰签)。
    const id = `cv-new-${nextUid()}`;
    // 侧栏第一条已是一张「New canvas」,故新建从 2 起编号,避免同名重复。
    const n = sessions.filter((s) => s.name.startsWith("New canvas")).length;
    const name = n === 0 ? "New canvas" : `New canvas ${n + 1}`;
    poolRef.current[id] = { objects: [], turns: [] };
    setSessions((prev) => [...prev, { id, name }]);
    setSessionMenu(false);
    switchSession(id);
  };

  /* ── 多选批量条动作(F1:全部接线,零死按钮) ── */
  const duplicateSelected = () => {
    const clones = selectedObjects.map((o) => {
      const isImg = o.kind === "image";
      if (isImg) refCounter.current.image += 1;
      else refCounter.current.video += 1;
      const n = isImg ? refCounter.current.image : refCounter.current.video;
      return {
        ...o,
        id: `${o.kind === "image" ? "cv-img" : "cv-vid"}-${n}-${nextUid()}`,
        ref: `${isImg ? "Image" : "Video"} ${n}`,
        title: `${o.title} copy`,
        x: o.x + 32,
        y: o.y + 32,
        parentId: undefined,
        fork: undefined,
        status: "ready" as const,
      };
    });
    setObjects((prev) => [...prev, ...clones]);
    // [cx-canvas-runtime] ①:复制出的对象也可寻址、也会被工具条深链 —— 一并登记,免得深链回落 fallback。
    clones.forEach((o) =>
      registerCanvasObject({
        id: o.id,
        kind: o.kind,
        imageUrl: o.src,
        posterUrl: o.src,
        prompt: o.prompt,
        title: o.title,
        lineage: o.parentId,
        ref: o.ref,
        duration: o.duration,
        credits: o.credits,
      }),
    );
    setSelected(clones.map((c) => c.id));
    showFlash(`Duplicated ${clones.length} ${clones.length === 1 ? "object" : "objects"}`);
  };

  const groupSelected = () => {
    const ids = selected.slice();
    if (ids.length < 2) return;
    setGroups((prev) => [
      ...prev,
      { id: `grp-${nextUid()}`, objectIds: ids, label: `Group ${prev.length + 1}` },
    ]);
    showFlash(`Grouped ${ids.length} objects`);
  };

  const stitchVideos = (ids: string[]) => {
    const parts = objects.filter((o) => ids.includes(o.id));
    if (parts.length < 2) return;
    refCounter.current.video += 1;
    const n = refCounter.current.video;
    const anchor = parts[0];
    const totalDur = parts.reduce((s, p) => s + (p.duration ?? 6), 0);
    spendCredits(STITCH_COST, `Stitch ${parts.map((p) => p.ref).join(" + ")}`, "Video");
    startGeneration(
      [
        {
          id: `cv-vid-${n}-${nextUid()}`,
          ref: `Video ${n}`,
          kind: "video",
          title: `Stitched ${parts.map((p) => p.ref).join(" + ")}`,
          prompt: `Stitch of ${parts.map((p) => p.ref).join(" and ")} into one continuous clip`,
          src: cvImage("video", n),
          x: anchor.x,
          y: Math.max(...parts.map((p) => p.y + p.h)) + 48,
          w: 168,
          h: 300,
          status: "generating",
          parentId: anchor.id,
          duration: totalDur,
          credits: STITCH_COST,
        },
      ],
      "Stitching clips…",
    );
    setSelected([]);
  };

  /* ── [wave-b] Add to campaign(D1 升格):Studio 画布产物一键挂进 campaign。
   * 升格不是搬家 —— 产物仍在画布,只是也归到那件事名下。$0(余额不动),经共享 store
   * 落记录 + Otto 单流带 campaign context 的确认(dock/otto 立刻可见)。读面不死胡同:
   * 升格后对象上现「In <campaign>」chip,深链回那件事。 */
  const promoteObjects = (objs: CvObject[], campaignId: string, campaignName: string) => {
    objs.forEach((o) =>
      promoteToCampaign({
        assetId: o.id,
        title: o.title || o.ref,
        kind: o.kind,
        thumb: o.src,
        campaignId,
        campaignName,
      }),
    );
    showFlash(
      objs.length === 1
        ? `Added ${objs[0].ref} to ${campaignName}`
        : `Added ${objs.length} objects to ${campaignName}`,
    );
    setBatchPromoteOpen(false);
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

  const mentionables = objects.filter((o) => o.status === "ready");
  const historyItems = CV_HISTORY.filter((h) => h.title.toLowerCase().includes(sideSearch.toLowerCase()));
  const exactlyTwoVideos = selectedObjects.length === 2 && selectedObjects.every((o) => o.kind === "video");
  const canCompare = selectedObjects.length === 2 && comparable(selectedObjects[0], selectedObjects[1]);
  const compareObjects = compareIds
    ? (compareIds.map((id) => objects.find((o) => o.id === id)).filter(Boolean) as CvObject[])
    : [];
  const lastEvent = recentEvents(1)[0];

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
            // [wave-c] STALL #46:此前只做取消选中却叫「New generation」——名不副实。
            // 改为真起一张空画布(新会话)并把焦点落到 composer,承诺兑现。
            onClick={() => {
              newAgent();
              window.requestAnimationFrame(() => composerRef.current?.focus());
            }}
          >
            <Plus className="size-4" strokeWidth={2.2} />
            New canvas
          </Button>
        </div>
        <div className="flex gap-1 px-3">
          {/* 沉浸式外壳内隐藏 A3「History」页签 —— 壳级 HISTORY 已在;画布历史走 Library。 */}
          {((insideImmersive ? ["chat", "projects", "tree"] : ["chat", "projects", "history", "tree"]) as SideTab[]).map((t) => (
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
              {sessions.map((s) => {
                // [wave-c] 种子 ss-* 是示例(不是这位店主做的)——挂「Example」灰签,诚实标注。
                const isExample = s.id.startsWith("ss-");
                return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => switchSession(s.id)}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-[10px] px-3 text-left text-[13px] transition-colors duration-[120ms]",
                    sessionId === s.id
                      ? "bg-secondary font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="truncate">{s.name}</span>
                  {isExample && (
                    <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 font-mono text-[9px] leading-4 tracking-[0.06em] text-muted-foreground uppercase">
                      Example
                    </span>
                  )}
                </button>
                );
              })}
            </div>
          )}
          {sideTab === "projects" && (
            <div className="flex flex-col gap-3">
              {CV_PROJECTS.map((p) => {
                const active = p.sessionId === sessionId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      switchSession(p.sessionId);
                      setSideTab("chat");
                    }}
                    className={cn(
                      "group overflow-hidden rounded-[14px] border bg-card text-left shadow-[var(--shadow-xs)] transition-shadow duration-[150ms] hover:shadow-[var(--shadow-md)]",
                      active ? "border-brand border-2" : "border-border",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumb} alt="" className="aspect-[8/5] w-full object-cover" />
                    <div className="flex items-center justify-between p-2.5">
                      <span className="truncate text-[13px] font-semibold text-foreground">{p.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{p.count}</span>
                    </div>
                  </button>
                );
              })}
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
            <span className="truncate">{sessions.find((s) => s.id === sessionId)?.name ?? "New canvas"}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          </button>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={newAgent}>
            <Plus className="size-3.5" strokeWidth={2.2} />
            New canvas
          </Button>
          {sessionMenu && (
            <div className="absolute top-12 left-4 z-50 w-56 rounded-[14px] border border-border bg-popover p-1 shadow-[var(--shadow-lg)]">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    switchSession(s.id);
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
          {clarify && (
            <ClarifyCard
              clarify={clarify}
              onPickIntent={pickIntent}
              onAnswer={answerClarify}
              onCancel={cancelClarify}
            />
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Composer(A1 三模式 + J2 @mention + H0 ↑↔■) */}
        <div className="shrink-0 border-t border-border p-3">
          <div
            style={composerSweep.style}
            className="relative rounded-[14px] border border-input bg-card shadow-[var(--shadow-xs)] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40"
          >
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
              ref={composerRef}
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
              {/* [wave-c] §O7 一颗「Ask Otto」—— 点开带 {zone,选中对象,mode,draft} 上下文,
                 dock 浮出意图 chip;Apply 只回填 composer,发/花仍要店主亲手点。 */}
              <OttoAssist
                zone="Canvas"
                entityId={singleSelected?.id}
                entityLabel={singleSelected ? `${singleSelected.ref} · ${singleSelected.title}` : "your canvas"}
                formState={{ mode, draft, selected: singleSelected?.ref }}
                intents={CANVAS_STARTERS.map((s) => ({
                  id: s.id,
                  label: s.label,
                  prompt: s.prompt,
                  reply: s.reply,
                  apply: { summary: "Fill the composer", patch: { mode: s.mode, draft: s.draft } },
                }))}
                onApply={(a) => prefillComposer((a.patch.mode as Mode) ?? "image", String(a.patch.draft ?? ""))}
              />
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
              {/* 参数栏随模式重排(A1)· 人话,不用行话(STALL #47) */}
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {mode === "image" && `Two takes side by side · ${2 * IMAGE_COST} credits on send`}
                {mode === "video" && "6s clip · asks before spending"}
                {mode === "agent" && "Otto plans it first · asks before spending"}
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
          <span className="truncate text-sm font-semibold text-foreground">
            Untitled project · {sessions.find((s) => s.id === sessionId)?.name ?? "New canvas"}
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

                    {/* [wave-b] Add to campaign — D1 升格反射:挂进 campaign 后现「In …」chip */}
                    {promotedCampaignsOf(obj.id).length > 0 && (
                      <span className="absolute top-2 right-2 flex h-5 max-w-[70%] items-center gap-1 rounded-full bg-card/90 px-1.5 font-mono text-[10px] leading-none font-medium text-foreground shadow-[var(--shadow-xs)]">
                        <FolderPlus className="size-3 shrink-0" strokeWidth={2} />
                        <span className="truncate">In {promotedCampaignsOf(obj.id)[0]}</span>
                      </span>
                    )}

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
                      onDownload={() => showFlash(`Preparing download · ${obj.ref}`)}
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
                      promotedNames={promotedCampaignsOf(obj.id)}
                      onPromote={(campaignId, campaignName) => promoteObjects([obj], campaignId, campaignName)}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* [wave-c] 空画布起步态(STALL #6):不再只有一片灰点点。居中 Otto 云 + 一句人话
             + 零打字起手式(点一下填进 composer,店主再亲手发)。跟随视口居中(不进 pan/zoom
             变换),reduced-motion 无动画。pointer-events 只给卡片,画布其余处仍可 pan。 */}
          {objects.length === 0 && !streaming && (
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center p-6">
              <div className="pointer-events-auto flex w-full max-w-[420px] flex-col items-center text-center">
                <OttoAvatar size={48} mood="idle" />
                <h2 className="mt-4 text-[20px] leading-[26px] font-semibold tracking-[-0.017em] text-foreground">
                  A blank canvas, all yours
                </h2>
                <p className="mt-1.5 max-w-[340px] text-[13px] leading-[18px] text-muted-foreground">
                  Tell Otto what to make in the box on the left — or tap a starter to fill it in. Video and Otto&apos;s plans ask before spending; images show their cost before you send.
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
            <div className="absolute right-4 bottom-4 z-[10] flex items-center gap-1 rounded-[14px] border border-border bg-card p-1.5 shadow-[var(--shadow-md)]" style={LAND_STYLE}>
              {/* [wave-b] Add to campaign — 批量升格 popover */}
              {batchPromoteOpen && (
                <div className="absolute right-0 bottom-full mb-2 w-64 rounded-[14px] border border-border bg-popover p-1.5 shadow-[var(--shadow-lg)]" style={LAND_STYLE}>
                  <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Add {selectedObjects.length} objects to a campaign
                  </p>
                  {PROMOTE_TARGETS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => promoteObjects(selectedObjects, c.id, c.name)}
                      className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left hover:bg-accent"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.hero} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-foreground">{c.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{c.status === "ACTIVE" ? "In progress" : "Draft"}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
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
              <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" onClick={duplicateSelected}>
                <Copy className="size-3.5" strokeWidth={2} />
                Duplicate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs"
                aria-expanded={batchPromoteOpen}
                onClick={() => setBatchPromoteOpen((v) => !v)}
              >
                <FolderPlus className="size-3.5" strokeWidth={2} />
                Add to campaign
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={() => showFlash(`Preparing download · ${selectedObjects.length} objects`)}
              >
                <Download className="size-3.5" strokeWidth={2} />
                Download
              </Button>
              {exactlyTwoVideos && (
                <>
                  <Button variant="secondary" size="sm" className="h-8 px-2.5 text-xs" onClick={() => setSpendAsk({ kind: "stitch", ids: selected.slice() })}>
                    <Scissors className="size-3.5" strokeWidth={2} />
                    Stitch
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" aria-label="Play both" onClick={() => showFlash("Playing both clips in sequence")}>
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
            <div className="absolute inset-0 z-30 flex flex-col bg-background/80 p-6 backdrop-blur-sm" style={LAND_STYLE}>
              <div className="flex items-center justify-between pb-4">
                <span className="text-sm font-semibold text-foreground">
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
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
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
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={o.src} alt={o.title} className="max-h-full max-w-full rounded-[10px] object-contain" />
                    </div>
                    <p className="border-t border-border px-3 py-2 text-[12px] leading-[16px] text-muted-foreground">{o.prompt}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 花费确认(§FB6 money + §V5;video / agent = Speed/Quality 双档,stitch = 定价再渲染不双档) */}
      <SpendConfirmDialog
        open={spendAsk !== null}
        onOpenChange={(v) => !v && setSpendAsk(null)}
        title={
          spendAsk?.kind === "agent-plan"
            ? `Generate ${spendAsk.count} ${INTENT_META[spendAsk.intent].unit}${spendAsk.count > 1 ? "s" : ""}?`
            : spendAsk?.kind === "stitch"
              ? "Stitch these clips?"
              : spendAsk?.kind === "make-fresh-image"
                ? "Generate two images?"
                : "Generate this video?"
        }
        ask={
          spendAsk?.kind === "agent-plan"
            ? `Otto will generate ${spendAsk.count} ${INTENT_META[spendAsk.intent].unit}${spendAsk.count > 1 ? "s" : ""} in parallel. This will spend real credits.`
            : spendAsk?.kind === "stitch"
              ? "Stitching re-renders the clips into one. This will spend real credits."
              : spendAsk?.kind === "make-fresh-image"
                ? "You'll get an A and a B side by side to pick from. This will spend real credits."
                : "This will spend real credits."
        }
        impacts={
          spendAsk?.kind === "agent-plan"
            ? [
                `${spendAsk.count} ${INTENT_META[spendAsk.intent].unit}${spendAsk.count > 1 ? "s" : ""} × ${INTENT_META[spendAsk.intent].costEach} credits each. No charge until you confirm.`,
                spendAsk.count === 2 ? "A and B land side by side so you can compare." : "Each shows its own progress and can be deleted after.",
                "Anything that fails isn't charged.",
              ]
            : spendAsk?.kind === "stitch"
              ? [
                  `Cost: ${STITCH_COST} credits. No charge until you confirm.`,
                  "The stitched clip lands as a new object below the sources.",
                  "The source clips stay on the canvas.",
                ]
              : spendAsk?.kind === "make-fresh-image"
                ? [
                    `Two takes, A and B: ${IMAGE_COST} credits each, ${2 * IMAGE_COST} total. No charge until you confirm.`,
                    "They land side by side so you can pick the winner.",
                    "Evolving an image from there generates on send; anything that fails isn't charged.",
                  ]
                : [
                    spendAsk?.kind === "make-fresh-video"
                      ? "The video lands on your canvas — evolve it from there."
                      : "The video lands next to its source with a lineage line.",
                    "Speed is a quick draft; Quality is sharper but slower.",
                    "If it fails, you aren't charged.",
                  ]
        }
        confirmLabel={
          spendAsk?.kind === "stitch"
            ? `Confirm stitch · ${STITCH_COST} credits`
            : spendAsk?.kind === "make-fresh-image"
              ? `Confirm generate · ${2 * IMAGE_COST} credits`
              : `Confirm generate`
        }
        onConfirm={() => {
          const ask = spendAsk;
          setSpendAsk(null);
          if (ask?.kind === "stitch") stitchVideos(ask.ids);
          else if (ask?.kind === "make-fresh-image") {
            // 确认后才出 A/B 并扣费(evolveImageAB 内 spendCredits)——先问后花闭环。
            evolveImageAB(null, ask.prompt);
            setTurns((prev) => [
              ...prev,
              { id: `t-${prev.length + 1}`, from: "otto", text: "Making an A and a B take side by side, so you can pick the winner.", steps: ["Generating A and B"] },
            ]);
          }
        }}
        baseCredits={
          spendAsk?.kind === "agent-plan"
            ? spendAsk.count * INTENT_META[spendAsk.intent].costEach
            : spendAsk?.kind === "make-video" || spendAsk?.kind === "evolve-video" || spendAsk?.kind === "make-fresh-video"
              ? VIDEO_COST
              : undefined
        }
        onConfirmTier={(_tier: GenTier, credits: number) => {
          const ask = spendAsk;
          setSpendAsk(null);
          if (!ask) return;
          if (ask.kind === "agent-plan") confirmAgentPlan(ask.intent, ask.brief, ask.count, credits);
          else if (ask.kind === "make-fresh-video") makeFreshVideo(ask.prompt, credits);
          else if (ask.kind === "make-video" || ask.kind === "evolve-video") {
            const source = objects.find((o) => o.id === ask.sourceId);
            if (source) makeVideo(source, ask.kind === "evolve-video" ? ask.prompt : `Animate: ${source.prompt}`, credits);
          }
        }}
      />

      <MockNote path="/northstar/create/canvas" />
    </div>
    </TooltipProvider>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * ClarifyCard — Agent 澄清脑回路卡(H1a 意图确认 → H1b 结构化追问)
 * 确定性选项;答完最后一维由父级出计划 + 花费确认。
 * ──────────────────────────────────────────────────────────────────────── */
function ClarifyCard({
  clarify,
  onPickIntent,
  onAnswer,
  onCancel,
}: {
  clarify: { intent: AgentIntent; brief: string; step: number; answers: Record<string, string> };
  onPickIntent: (intent: AgentIntent) => void;
  onAnswer: (key: string, value: string) => void;
  onCancel: () => void;
}) {
  const qs = CLARIFY_QUESTIONS[clarify.intent];
  const q = clarify.step >= 0 ? qs[clarify.step] : null;
  const roundLabel = clarify.step >= 0 ? `Question ${clarify.step + 1} of ${qs.length}` : "Quick check";
  return (
    <div className="flex flex-col items-start">
      <div className="w-full max-w-[85%] rounded-[14px] border border-border bg-card p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Bot className="size-3.5" strokeWidth={2} />
          {roundLabel}
        </div>
        {clarify.step === -1 ? (
          <>
            <p className="mt-1.5 text-sm text-foreground">
              Sounds like{/^[aeiou]/i.test(clarify.intent) ? " an " : " a "}<span className="font-semibold capitalize">{clarify.intent}</span> job. Right, or something else?
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(["image", "edit", "video"] as AgentIntent[]).map((it) => (
                <button
                  key={it}
                  type="button"
                  onClick={() => onPickIntent(it)}
                  className={cn(
                    "h-8 rounded-full border px-3 text-xs font-semibold capitalize transition-colors duration-[120ms]",
                    it === clarify.intent
                      ? "border-foreground bg-secondary text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {it}
                </button>
              ))}
            </div>
          </>
        ) : q ? (
          <>
            <p className="mt-1.5 text-sm text-foreground">{q.prompt}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {q.options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onAnswer(q.key, opt.value)}
                  className="h-8 rounded-full border border-border px-3 text-xs font-semibold text-foreground transition-colors duration-[120ms] hover:border-foreground hover:bg-secondary"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          className="mt-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
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
  onDownload,
  onPrompt,
  promptOpen,
  copied,
  onCopy,
  onImagine,
  promotedNames,
  onPromote,
}: {
  obj: CvObject;
  feedback: FeedbackValue;
  onFeedback: (v: FeedbackValue) => void;
  onMakeVideo: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onPrompt: () => void;
  promptOpen: boolean;
  copied: boolean;
  onCopy: () => void;
  onImagine: (text: string) => void;
  /** [wave-b] Add to campaign — 已挂进的 campaign 名(现勾) */
  promotedNames: string[];
  onPromote: (campaignId: string, campaignName: string) => void;
}) {
  const [text, setText] = React.useState("");
  const [promoteOpen, setPromoteOpen] = React.useState(false);

  const tool = (label: string, icon: React.ReactNode, onClick?: () => void, href?: string, danger?: boolean) => {
    // [wave-c] §G1 pointer-down 手感:按下即缩(active scale),reduced-motion 由全局 clamp 压平。
    const cls = cn(
      "flex size-8 items-center justify-center rounded-[10px] transition-[transform,background-color,color] duration-[120ms] active:scale-[0.92]",
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
            {tool("Crop", <Crop className="size-4" strokeWidth={2} />, undefined, `/northstar/create/media-editor?asset=${obj.id}`)}
          </>
        ) : (
          <>
            {tool("Trim", <Scissors className="size-4" strokeWidth={2} />, undefined, `/northstar/create/media-editor?asset=${obj.id}`)}
            {tool("Extract frame", <ImageIcon className="size-4" strokeWidth={2} />, undefined, `/northstar/create/media-editor?asset=${obj.id}`)}
            {tool("Effects", <Wand2 className="size-4" strokeWidth={2} />, undefined, `/northstar/create/media-editor?asset=${obj.id}`)}
          </>
        )}
        {tool("Full screen", <Maximize2 className="size-4" strokeWidth={2} />, undefined, `/northstar/create/asset-viewer?asset=${obj.id}`)}
        {tool(
          promotedNames.length ? `In ${promotedNames.join(", ")} · add to another` : "Add to campaign",
          <FolderPlus className="size-4" strokeWidth={2} />,
          () => setPromoteOpen((v) => !v),
        )}
        {tool("Prompt", <Menu className="size-4" strokeWidth={2} />, onPrompt)}
        {tool("Download", <Download className="size-4" strokeWidth={2} />, onDownload)}
        <span className="mx-0.5 h-5 w-px bg-border" />
        <FeedbackControls value={feedback} onChange={onFeedback} />
        <span className="mx-0.5 h-5 w-px bg-border" />
        {tool("Delete", <Trash2 className="size-4" strokeWidth={2} />, onDelete, undefined, true)}
      </div>

      {/* [wave-b] Add to campaign — D1 升格 picker(升格不是搬家;$0,产物仍在画布) */}
      {promoteOpen && (
        <div className="mt-2 w-72 rounded-[14px] border border-border bg-popover p-1.5 shadow-[var(--shadow-lg)]" style={LAND_STYLE}>
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Add {obj.ref} to a campaign · it still lives in your Studio
          </p>
          {PROMOTE_TARGETS.map((c) => {
            const already = promotedNames.includes(c.name);
            return (
              <button
                key={c.id}
                type="button"
                disabled={already}
                onClick={() => {
                  onPromote(c.id, c.name);
                  setPromoteOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left hover:bg-accent disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.hero} alt="" className="size-9 shrink-0 rounded-md object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-foreground">{c.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{c.status === "ACTIVE" ? "In progress" : "Draft"}</span>
                </span>
                {already && <Check className="size-4 shrink-0 text-muted-foreground" strokeWidth={2.2} />}
              </button>
            );
          })}
        </div>
      )}

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
