"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  FolderPlus,
  Frame,
  Hand,
  ImagePlus,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Sparkles,
  Star,
  Undo2,
  Video,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CANVAS_HREF, CREATE_NAV_HREF } from "@fikirtive/core/navigation";
import type { EntityDTO } from "@/lib/types";
import { canvasHref } from "./canvas-href";
import { CreationTemplateRow } from "@/components/creation/CreationTemplateRow";
import { listCanvasNodes, type CanvasNodeDTO } from "@/lib/canvas-actions";
import type { ImmersiveCanvasRuntimeContext } from "./NorthstarCanvasWorkspace";
import { freshCanvasActionId, useCanvasGen, type CanvasGenProgress } from "./useCanvasGen";
import { CANVAS_IMAGE_MAX_VARIANT_COUNT, type CanvasGenCostQuote } from "@/lib/canvas-gen-costs";
import { readR22WorkspaceDirectory, scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";
import {
  FIXTURE_IMAGE_CREDITS,
  FIXTURE_RATIO_OPTIONS,
  FIXTURE_VIDEO_CONCEPT_SECONDS,
  fixtureBatchHome,
  fixtureQuoteCredits,
  NEW_PROJECT_FIXTURE_ID,
  readNewFixtureProjectName,
  type CanvasMakeKind,
  type CanvasPoint,
  type FixtureArt,
  type FixtureBatch,
} from "./r22-canvas-fixture";
import {
  addLibraryAssets,
  attachToPack,
  canvasLibraryAsset,
  editedLibraryAsset,
  editedVersionsOf,
  LIBRARY_FIXTURE_KEY,
  newPackId,
  readLibraryArchive,
  writeLibraryArchive,
  type LibraryArchive,
} from "@/components/library/library-fixture";
import { ImageEditLayer, IMAGE_EDIT_CREDITS, type ImageEditOutcome } from "@/components/library/ImageEditLayer";
import "./r22-canvas.css";

type CanvasTool = "select" | "box" | "hand" | "image" | "star" | "arrange";

/** 画布视角:世界的平移量 + 缩放百分比(原型 `view={x,y,s}`,L5985 —— 一件事一个出处)。 */
type CanvasView = { x: number; y: number; zoom: number };
/** 撤销栈上的一步 = 一个物件从哪儿挪到了哪儿(原型 L6024-6026 的 `pushMove`)。 */
type CanvasMoveStep = { id: string; from: CanvasPoint; to: CanvasPoint };

/**
 * 回家的那个视角。这三个数原来写死在 `.r22-canvas-world` 的 CSS `transform` 里,于是
 * 「板」根本推不动 —— 现在它是状态的初值,也是 zoom 标签那颗按钮按下去回到的地方
 * (原型 L6022:重置读的是整个视角,不只是倍率)。
 */
const CANVAS_HOME_VIEW: CanvasView = { x: -560, y: -260, zoom: 100 };

/** 倍率的两端与每一档(原型 L6010/L6020-6021:0.35–2.5,一档 ×1.2)。 */
const CANVAS_ZOOM_MIN = 35;
const CANVAS_ZOOM_MAX = 250;
const CANVAS_ZOOM_STEP = 1.2;

/**
 * 「按下」与「拖拽」之间的那 3 个世界像素(原型 L6089)。
 *
 * 这个阈值不是手感调校,它是卡内按钮还能不能按的**唯一**原因:一按下就抢指针捕获,
 * 随后的 click 会被重定向到 stage,卡上的星标、More like this、图片本身就再也点不动了
 * (原型 L6085-6086 把这件事写成了注释)。所以捕获、以及「这一次不是点击」这个判定,
 * 都只在越过阈值之后才发生 —— 两件事共用同一个开关,谁都不许单独提前。
 */
const CANVAS_DRAG_THRESHOLD = 3;

/** 样例画布两个固定物件的老家(原型 L5514/5520 的 inline `left/top`)。批次卡各有各的家,见 `FixtureBatch.home`。 */
const FIXTURE_OBJECT_HOME: Record<string, CanvasPoint> = {
  sticky: { x: 640, y: 560 },
  research: { x: 1730, y: 330 },
};

/**
 * 价目与可选形状搬去了 `r22-canvas-fixture.ts` —— Library 的 Quick create 报的必须是同一个
 * 价,常量留在这一面就意味着那一面要自己再写一遍,而两个字面量从此各涨各的。这一面照旧
 * 只从那一处派生:价格贴纸、答案卡的单价、批量四张的总价,一个数字都不再自己写。
 */

/** 参考图的诚实预算:样例存档存在浏览器里,太大的图放不进去,所以先说清楚再拒绝。 */
const FIXTURE_ATTACHMENT_MAX_BYTES = 1_500_000;

/**
 * 跟手改一版的那几句(Grok 与 Stitch 同证的形状)。chip 上是商家读的短句,发出去的是一整句
 * 请求 —— 短句本身不含创作动词,直接发会被判成一次提问,那就不是「再做一版」了。
 */
const FIXTURE_ITERATION_CHIPS: Array<{ chip: string; prompt: string }> = [
  { chip: "Warmer light", prompt: "Make this batch again with warmer light" },
  { chip: "More table setting", prompt: "Make this batch again with more of the table setting" },
  { chip: "Closer crop", prompt: "Make this batch again with a closer crop" },
];

const FIXTURE_SEED_ART: FixtureArt[] = [
  { id: "art-1", variant: "r22-canvas-art-one", label: "Image 1", src: "/fixtures/r22-canvas/art-1.jpg", alt: "Raya concept 1" },
  { id: "art-2", variant: "r22-canvas-art-two", label: "Image 2", src: "/fixtures/r22-canvas/art-2.jpg", alt: "Raya concept 2" },
  { id: "art-3", variant: "r22-canvas-art-three", label: "Image 3", src: "/fixtures/r22-canvas/art-3.jpg", alt: "Raya concept 3" },
  { id: "art-4", variant: "r22-canvas-art-four", label: "Image 4", src: "/fixtures/r22-canvas/art-4.jpg", alt: "Raya concept 4" },
];

/** 开局就在板上的那一批(原型 L5527 的位置)。 */
const FIXTURE_SEED_BATCH: FixtureBatch = {
  id: "batch",
  kind: "image",
  ratio: "9:16",
  credits: FIXTURE_IMAGE_CREDITS * CANVAS_IMAGE_MAX_VARIANT_COUNT,
  madeFrom: null,
  references: [],
  home: fixtureBatchHome(0),
  art: FIXTURE_SEED_ART,
};

/** 批次卡上那枚标签 —— 商家读到的就是这一句:做了几张、什么形状、多少 cr。 */
function batchTagLabel(batch: FixtureBatch): string {
  const count = batch.art.length;
  const noun = batch.kind === "video" ? (count === 1 ? "video concept" : "video concepts") : count === 1 ? "image" : "images";
  return `Batch · ${count} ${noun} · ${batch.ratio} · ${batch.credits} cr`;
}

/** 新的一批长什么样。编号接着板上已有的往下数,所以 chips 与卡上的名字永远对得上。 */
function buildFixtureBatch(spec: {
  index: number;
  imageCount: number;
  videoCount: number;
  kind: CanvasMakeKind;
  count: number;
  ratio: string;
  madeFrom: string | null;
  references: string[];
}): FixtureBatch {
  const id = `batch-${spec.index}`;
  const art = Array.from({ length: spec.count }, (_, offset): FixtureArt => {
    const seed = FIXTURE_SEED_ART[(spec.imageCount + offset) % FIXTURE_SEED_ART.length]!;
    return spec.kind === "video"
      ? { id: `${id}-${offset + 1}`, label: `Video ${spec.videoCount + offset + 1}`, src: "", alt: "" }
      : { id: `${id}-${offset + 1}`, label: `Image ${spec.imageCount + offset + 1}`, src: seed.src, alt: seed.alt };
  });
  return {
    id,
    kind: spec.kind,
    ratio: spec.ratio,
    credits: fixtureQuoteCredits(spec.kind, spec.count),
    madeFrom: spec.madeFrom,
    references: spec.references,
    // 一批一批往下摆,不叠在一起 —— 上一批还在原地,商家才比得出这一版。
    home: fixtureBatchHome(spec.index),
    art,
  };
}

/** 一次请求可以带在身上的参考图。它跟着 composer 走,发出去之后落在那条消息上。 */
type CanvasAttachment = { id: string; name: string; src: string; from: "upload" | "library" };

/** 「Image 1 和 Image 2」—— 商家读的是这种句子,不是一个数组。 */
function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function worldTransform(view: CanvasView): CSSProperties {
  return { transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom / 100})` };
}

/**
 * 指针捕获拿不到就算了 —— 拖拽真正靠的是 window 上那两个监听器,捕获只是让指针跑出
 * stage 之后浏览器仍然把事件送回来。jsdom 与老浏览器没有这个 API,不该因此拖不动。
 */
function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    /* 没有指针捕获照样拖得动。 */
  }
}

type CanvasQuestion = { header: string; question: string; help: string; multi: boolean; required: boolean; options: Array<{ label: string; description: string; recommended?: boolean }> };
type CanvasQuestionFlow = { title: string; reason: string; cost: number; questions: CanvasQuestion[] };
type PendingCanvasQuestion = { taskId: string; inputRequestId: string; taskVersion: number; flow: CanvasQuestionFlow; prompt: string; index: number; selected: string[]; answers: string[] };
type DecisionEvent = { kind: "input_requested" | "answer" | "resumed" | "cancelled"; label: string; detail: string };
type DecisionRecord = { taskId: string; inputRequestId: string; taskVersion: number; status: "waiting" | "answered" | "cancelled"; title: string; detail: string; events: DecisionEvent[] };
type FixtureCanvasJob = { id: string; prompt: string; status: "queued" | "running" | "completed" | "failed" };

/**
 * Otto 在画布上给出的一个**结构化真答案** —— 原型 `responseFor()` 的形状(标题 / 导语 /
 * 要点 / 一句诚实注脚)。这不是装饰:注脚那一句是这张卡唯一敢下的断言,它说的是「刚才
 * 这次答话没有动任何东西、没有花一分钱」。
 */
export type OttoCanvasAnswer = { title: string; lead: string; bullets: string[]; note: string };

export type OttoAnswerContext = {
  /** 商家读得到的板名 —— 顶栏叫什么,答案里就叫什么。 */
  board: string;
  /** 一张图的确切价钱。读不出来就是 `null`,那时答案说「还在核对」,不编一个数出来。 */
  imageCredits: number | null;
  /** 这块画布此刻真的可选的形状。空数组 = 还没读出来。 */
  ratioOptions: string[];
  /**
   * 此刻正在跑的 routine 条数。画布这一面没有 routine 的出处,所以它一律是 `null` ——
   * 三态里最诚实的那一态:不知道就说不知道,不假装「没有在跑」。
   */
  activeRoutines: number | null;
  /**
   * 商家此刻在板上选中的那几张的名字。有选中时,答案必须指名道姓地说它是在讲这几张 ——
   * 「For Image 1 and Image 2 — …」;读不到就是没选,那一路一个字都不加。
   */
  selection?: string[];
  /** 此刻挂在 composer 上的参考图名字。同理:有就承认,没有就不提。 */
  references?: string[];
};

type ChatResponse = { kind: "line"; text: string } | { kind: "answer"; answer: OttoCanvasAnswer };

type ChatEntry =
  /** `refs` = 这条消息发出去时挂在身上的参考图。发完之后它就归这条消息,不再跟着 composer 走。 */
  | { from: "me" | "otto"; text: string; refs?: CanvasAttachment[] }
  | { from: "answer"; answer: OttoCanvasAnswer; repeat: boolean };

/** 商家读得懂的形状名。表里没有的比例原样报出去,不硬塞一个形容词。 */
const RATIO_SHAPE_WORD: Record<string, string> = { "9:16": "vertical", "1:1": "square", "16:9": "wide", "4:5": "portrait" };

/**
 * 商家读到的阶段名。工程状态码(`queued` / `completed` …)只活在 `data-canvas-job-status`、
 * CSS 类名与测试断言里 —— 屏幕上一个都不出现。
 */
const JOB_STAGE_LABEL: Record<FixtureCanvasJob["status"], string> = {
  queued: "Queued",
  running: "Working",
  completed: "Done",
  failed: "Did not run",
};

const CANVAS_QUESTION_FLOWS: Record<"creative" | "scope", CanvasQuestionFlow> = {
  creative: {
    title: "Creative direction",
    reason: "Two valid creative directions would produce materially different work.",
    cost: 3,
    questions: [
      { header: "Lead product", question: "Which product should lead this Raya concept?", help: "Otto found two valid products in your references. Choose one so the hero stays specific.", multi: false, required: true, options: [{ label: "Teal batik candle", description: "Use the strongest Raya visual cue", recommended: true }, { label: "Pandan gift set", description: "Lead with gifting and product value" }, { label: "Use both", description: "Create a paired-product hero" }] },
      { header: "Deliverables", question: "Which formats should Otto prepare?", help: "Choose one or more. Each selected format stays in this project.", multi: true, required: true, options: [{ label: "Instagram Story", description: "9:16 vertical concept", recommended: true }, { label: "Feed post", description: "1:1 single-image concept" }, { label: "Carousel", description: "4:5 multi-slide concept" }] },
    ],
  },
  scope: {
    title: "Execution scope",
    reason: "The requested output can be delivered in several channels and sizes.",
    cost: 3,
    questions: [
      { header: "Channels", question: "Where will this version be used?", help: "Choose every destination Otto should prepare in this run.", multi: true, required: true, options: [{ label: "Instagram", description: "Story and feed-ready outputs", recommended: true }, { label: "Facebook", description: "Feed-safe copy and crop" }, { label: "Email", description: "Hero image and campaign copy" }] },
      { header: "Timing", question: "When should the campaign be ready for review?", help: "This sets the review target, not an automatic publish time.", multi: false, required: true, options: [{ label: "Tomorrow morning", description: "Prepare a complete review set", recommended: true }, { label: "Today", description: "Prioritise a fast first pass" }, { label: "This week", description: "Allow more exploration and variants" }] },
    ],
  },
};

/**
 * §9.5 的幂等身份是 taskId + inputRequestId + taskVersion **三件一起**。`inputRequestId`
 * 本身已经带了 taskId(它长成 `${taskId}:input:1`),漏掉的是版本 —— 少了它,同一请求的
 * 下一个版本会被当成「已经回答过」挡掉,拿不回自己的回执。
 */
function answeredRequestKey(inputRequestId: string, taskVersion: number): string {
  return `${inputRequestId}:v${taskVersion}`;
}

function fixtureQuestionFlow(prompt: string): CanvasQuestionFlow | null {
  if (!/premium|luxury|make it better|more polished|surprise me|audience|offer|goal|outcome|reference|source|conflict|channel|format|schedule|when|deliverable/i.test(prompt)) return null;
  return /channel|format|schedule|when|deliverable/i.test(prompt) ? CANVAS_QUESTION_FLOWS.scope : CANVAS_QUESTION_FLOWS.creative;
}

/**
 * 打招呼、道谢、随口一问**不是创作请求**:它们不该排一张任务卡,也不该花一分钱。
 *
 * 上一版只修了一半,病根边界还漏着:创作**动词**(make / create)和创作**名词**
 * (image / video / carousel / batch)混在一张表里,而这张表又排在寒暄前面 ——
 * 于是判官实测的这四条全被当成真创作请求排了任务卡:
 *   「Thanks for the images!」(`images` 压过道谢)
 *   「How much does a video cost?」「What is a carousel?」「Where did my last batch go?」
 *
 * 所以动词与名词拆开,而且先判**句式**再判词:
 *   ① 整句就是一句招呼 → 招呼
 *   ② 道谢,且句子里没有创作动词 → 道谢;「Thanks, now make a video」仍然是一次创作
 *   ③ 以 what / how / where / why / when / who / which 起头、以 `?` 收尾的疑问句 → 回答
 *   ④ 剩下的才看创作动词或创作名词;两个都没有,就当成一句可以直接答的话
 *
 * 提问流(`fixtureQuestionFlow`)仍然排在这一整条之前,那条路一个字都不动:
 * "Make the Raya hero more premium" 两边都命中,而它真正缺的是一次拍板,不是一句回话。
 * 返回 null 就代表「这是真的要做东西」。
 */
const CREATE_VERB = /\b(make|create|generate|design|draw|render|write|build|produce|remake|redo|mock up)\b/i;
const CREATE_NOUN = /\b(variant|variants|variation|image|images|photo|photos|video|videos|carousel|poster|banner|flyer|story|stories|post|posts|caption|headline|ad|ads|logo|sketch|shot|shots|batch|mockup)\b/i;
const GREETING = /^\s*(hi+|hey+|hello|helo|hai|yo|halo|hola|good (morning|afternoon|evening)|你好|哈啰|嗨)\b[\s!.,?~]*$/i;
const THANKS = /(\bthanks\b|\bthank you\b|\bthx\b|\bterima kasih\b|谢谢|多谢|感谢)/i;
const QUESTION = /^\s*(what|what's|whats|how|where|why|when|who|which)\b[\s\S]*\?\s*$/i;

/**
 * 一句提问换回一个**真答案** —— 原型 `responseFor(context,prompt)` 的五路,加上这块画布
 * 自己的三路(价钱 / 形状 / 去向)。
 *
 * 上一版这里是一句敷衍话:「I can answer right here, or make something on …」。它有两个病:
 * 一是它什么都没回答,二是同一个问题问两遍,它逐字重复同一句 —— 那不是回答,那是回声。
 *
 * 每一路都必须交出「答案 + 一句注脚」。注脚不是免责声明,它是这张卡唯一敢下的断言:
 * 答话本身没有动任何东西、没有排任何队、没有花一分钱。凡是这一面读不出来的事实
 * (routine 条数、渠道是否已连),一律走「不知道」那一支,不替商家猜。
 */
function baseCanvasAnswerFor(prompt: string, context: OttoAnswerContext): OttoCanvasAnswer {
  const low = prompt.toLowerCase();
  const credits = context.imageCredits;

  // ① 价钱 —— 数字全从 `imageCredits` 派生;读不出来就说读不出来。
  if (/\b(cost|costs|price|prices|pricing|credit|credits|how much|charge|charged|billing|budget)\b/.test(low)) {
    return {
      title: "What this costs",
      lead: `Every paid action on ${context.board} shows the exact price before it runs.`,
      bullets: credits === null
        ? [
            "The exact price is still being checked, so no number is shown yet.",
            "The send button stays off until that price is known.",
            "Cancelled or failed work is never charged.",
          ]
        : [
            `${credits} cr per image.`,
            `${credits * CANVAS_IMAGE_MAX_VARIANT_COUNT} cr for a batch of ${CANVAS_IMAGE_MAX_VARIANT_COUNT}.`,
            "The price sits next to the send button, so you read it before anything runs.",
            "Cancelled or failed work is never charged.",
          ],
      note: "This answer started nothing and spent nothing.",
    };
  }

  // ② 形状 —— 列出来的就是此刻真的可选的那几个,不是一张写死的表。
  if (/\b(format|formats|ratio|ratios|aspect|shape|shapes|size|sizes|vertical|square|portrait|landscape|crop|carousel)\b/.test(low) || /\b\d{1,2}:\d{1,2}\b/.test(low)) {
    const named = context.ratioOptions
      .map((option) => (RATIO_SHAPE_WORD[option] ? `${option} ${RATIO_SHAPE_WORD[option]}` : option))
      .join(" · ");
    return {
      title: "Shapes you can ask for",
      lead: "Pick the shape next to the send button before you send the request.",
      bullets: context.ratioOptions.length
        ? [
            `Available right now: ${named}.`,
            "The shape you pick applies to this request only.",
            "Changing the shape does not re-run work that already finished.",
          ]
        : [
            "The available shapes are still being read, so nothing is listed yet.",
            "The send button stays off until those shapes are known.",
            "Changing the shape later does not re-run work that already finished.",
          ],
      note: "This answer did not change the shape or spend credits.",
    };
  }

  // ③ 审核与排程 —— 原型 L6694 那一路,连措辞一起搬。
  if (/approval|approve|review|schedule|publish|go live/.test(low)) {
    return {
      title: "Why this needs review",
      lead: "This is an explanation only. The approval stays exactly where it is until someone uses its real action.",
      bullets: [
        "Approve means schedule, not publish.",
        "Auto-publish is off, so nothing publishes before approval.",
        "Whether a channel is connected is answered in Schedule, not on this canvas.",
      ],
      note: "This answer did not change the approval or spend credits.",
    };
  }

  // ④ Routine 边界 —— 三态各有整段(原型 L6695-6699)。画布读不到条数,走的是第一态。
  if (/routine|routines|prepare|prepares|automatic|automation|autonomous/.test(low)) {
    const active = context.activeRoutines;
    if (active === null) {
      return {
        title: "Routine boundary",
        lead: "I cannot confirm routine state from this canvas, so I will not claim autonomous work is running.",
        bullets: [
          "Autonomous preparation and spending both require an active routine.",
          "You can still ask for an explanation here.",
          "Any paid action still shows its cost first and settles only on completion.",
        ],
        note: "This answer did not start a routine or change a routine state.",
      };
    }
    if (active === 0) {
      return {
        title: "Routine boundary",
        lead: "No routine is active right now, so Otto cannot autonomously prepare work, spend credits, schedule, or publish.",
        bullets: [
          "You can still ask for an explanation here.",
          "Help you asked for stays clearly separate from routine work.",
          "Any paid action still shows its cost first and settles only on completion.",
        ],
        note: "This answer did not start a routine or change a routine state.",
      };
    }
    return {
      title: "Routine boundary",
      lead: `${active} routine${active === 1 ? " is" : "s are"} active right now. Autonomous preparation stays inside those routine boundaries.`,
      bullets: [
        "Approve still means schedule, not publish.",
        "Auto-publish is off, so scheduled work waits for approval.",
        "Help you asked for here does not execute a routine action.",
      ],
      note: "This answer did not change the running routine or spend credits.",
    };
  }

  // ⑤ Otto IQ 的来处(原型 L6700)。
  if (/otto iq|provenance|learn|learned|learns|source|sources|knowledge|memory|remember/.test(low)) {
    return {
      title: "Otto IQ provenance",
      lead: "Otto IQ is knowledge saved in this workspace, and every saved fact carries its source, so you can read what Otto is using.",
      bullets: [
        "Pending suggestions are not saved yet.",
        // 面板 `otto-answer.ts` 的 `responseFor()` 讲的是同一条规则,原话带连字符(理由见
        // 该文件同一处的注释)。两面措辞必须统一,商家不该在面板与画布读到两种版本。
        "Do-not-say rules remain under merchant control; Otto cannot remove them.",
        "Open Otto IQ to read the source before you accept a suggestion.",
      ],
      note: "This answer did not save, remove, or alter any Otto IQ record.",
    };
  }

  // ⑥ Analytics 语境(原型 L6701)。
  if (/analytics|metric|metrics|performance|results|last \d+ days/.test(low)) {
    return {
      title: "Analytics context",
      lead: "You asked this, so it is an explanation only — not an automatic action.",
      bullets: [
        "I keep uncertainty visible instead of inventing a number.",
        "Paid analysis shows its cost before it runs and settles only when it completes.",
        "Open Analytics for a priced insight; this answer has not run one.",
      ],
      note: "No analysis was started and no credits were spent.",
    };
  }

  // ⑦ 去向 —— 画布做东西,把东西送出去是另一件事,由另一处动作负责。
  if (/\b(channel|channels|instagram|facebook|email|destination|publish to|post to|send it to)\b/.test(low)) {
    return {
      title: "Where this can go",
      lead: `Work gets made on ${context.board}. Sending it somewhere is a separate step you take on purpose.`,
      bullets: [
        "Star the images worth keeping so they are easy to find later.",
        "Scheduling and publishing live in Schedule, not on this canvas.",
        "Approve means schedule, not publish.",
      ],
      note: "This answer did not schedule, publish, or spend credits.",
    };
  }

  // ⑧ 兜底(原型 L6702)。
  return {
    title: "Workspace help",
    lead: "I can explain this workspace and point you to the action that owns a change.",
    bullets: [
      "Work made here stays on this canvas, and anything you save is in Library.",
      "Describe what to make and the request starts right here.",
      "Costs are shown before paid actions, and cancelled or failed work is never charged.",
    ],
    note: "This answer did not change anything on this canvas or spend credits.",
  };
}

/**
 * 选中/参考图那一路(Stitch 的画布代理精髓)—— 板上选中了几张,答案就得指名道姓地讲这
 * 几张,不能给一段谁都适用的通话。
 *
 * 它**套在**八路之外,不是第九路:「这几张多少钱?」缺的仍然是价钱那一路的答案,只是
 * 那张卡得先认下「我说的是 Image 1 和 Image 2」。所以导语前面接一句指名,要点末尾补一句
 * 边界 —— 八路本身一个字不动。
 */
export function canvasAnswerFor(prompt: string, context: OttoAnswerContext): OttoCanvasAnswer {
  const answer = baseCanvasAnswerFor(prompt, context);
  const selection = context.selection ?? [];
  const references = context.references ?? [];
  if (!selection.length && !references.length) return answer;
  const bullets = [...answer.bullets];
  if (selection.length) {
    bullets.push(`Nothing was changed on ${listPhrase(selection)} — this answer only talks about ${selection.length === 1 ? "it" : "them"}.`);
  }
  if (references.length) {
    bullets.push(`${listPhrase(references)} ${references.length === 1 ? "stays" : "stay"} attached to your next request only.`);
  }
  return {
    ...answer,
    lead: selection.length ? `For ${listPhrase(selection)} — ${answer.lead}` : answer.lead,
    bullets,
  };
}

/** 复制出去的就是屏上那一整张卡 —— 标题、导语、每条要点、注脚,一行一条(原型 L6704)。 */
export function answerCopyText(answer: OttoCanvasAnswer): string {
  return [answer.title, answer.lead, ...answer.bullets, answer.note].join("\n");
}

/**
 * 一次输入落到哪条路上。次序即判词,先判**句式**再判词(这一条上一轮已经过验收,不动):
 *   ① 整句就是一句招呼 → 招呼
 *   ② 道谢,且句子里没有创作动词 → 道谢
 *   ③ 疑问句,且句子里没有创作动词 → **真答案**
 *   ④ 剩下的才看创作动词或创作名词;两个都没有 → 同样给一个真答案(兜底那一路)
 * 返回 `null` 就代表「这是真的要做东西」。
 */
function chatResponseFor(prompt: string, context: OttoAnswerContext): ChatResponse | null {
  if (GREETING.test(prompt)) return { kind: "line", text: `Hey — I'm on ${context.board} with you. Tell me what to make and I'll start.` };
  if (THANKS.test(prompt) && !CREATE_VERB.test(prompt)) return { kind: "line", text: "Anytime. Star the ones worth keeping, or tell me what to make next." };
  if (QUESTION.test(prompt) && !CREATE_VERB.test(prompt)) return { kind: "answer", answer: canvasAnswerFor(prompt, context) };
  if (CREATE_VERB.test(prompt) || CREATE_NOUN.test(prompt)) return null;
  return { kind: "answer", answer: canvasAnswerFor(prompt, context) };
}

const TOOL_BUTTONS: Array<{
  id: CanvasTool;
  label: string;
  icon: typeof MousePointer2;
  /** 单键快捷键。没有的那几颗就是 `null` —— tooltip 里也不假装有一个。 */
  key: string | null;
}> = [
  { id: "select", label: "Select", icon: MousePointer2, key: "V" },
  { id: "box", label: "Box select", icon: Frame, key: "B" },
  { id: "hand", label: "Pan", icon: Hand, key: "H" },
  { id: "image", label: "Add image", icon: ImagePlus, key: null },
  { id: "star", label: "Star selected", icon: Star, key: null },
  { id: "arrange", label: "Arrange canvas", icon: LayoutGrid, key: null },
];

/**
 * 单键换工具(V / H / B)—— 画布类产品的通用手势(Figma / Sketch / Framer 同一套字母)。
 * 这张表由 `TOOL_BUTTONS` 派生,不另写一遍:tooltip 上写着哪个键,按下去就一定是那一颗,
 * 两处对不上这件事从此不可能发生。
 */
const TOOL_SHORTCUTS: Record<string, CanvasTool> = Object.fromEntries(
  TOOL_BUTTONS.filter((button) => button.key).map((button) => [button.key!.toLowerCase(), button.id]),
);

function OttoMark() {
  return <Image className="r22-otto-mark" src="/brand/r22-otto-thinking.svg" width={120} height={110} alt="" />;
}

/**
 * 一张成品的动作排(Grok 的结果排形状):星标 / 下载 / 改这一张 / 再来一批。
 * 「收进素材包」不在这张表里 —— 它是一枚 popover 的触发器,开合走 `onPackOpenChange`。
 */
type ArtAction = "star" | "download" | "edit" | "variants";

function ArtCell({
  art,
  kind,
  selected,
  starred,
  packOpen,
  packMenu,
  onPackOpenChange,
  onSelect,
  onAction,
}: {
  art: FixtureArt;
  kind: CanvasMakeKind;
  selected: boolean;
  starred: boolean;
  /** 此刻这一格的选包弹层开着没有。开合由宿主的 `packMenuFor` 一处说了算。 */
  packOpen: boolean;
  /** 选包弹层的内容(一枚 `<PopoverContent>`)。挂不挂在 DOM 上由 Radix 按 `packOpen` 决定。 */
  packMenu: React.ReactNode;
  onPackOpenChange: (open: boolean, art: FixtureArt) => void;
  onSelect: (id: string) => void;
  onAction: (action: ArtAction, art: FixtureArt) => void;
}) {
  return (
    <div className="r22-canvas-art-cell" data-canvas-art-cell={art.id}>
      <Button
        unstyled
        className={`r22-canvas-art${art.variant ? ` ${art.variant}` : ""}${selected ? " is-selected" : ""}`}
        type="button"
        aria-label={art.label}
        aria-pressed={selected}
        data-canvas-select={art.id}
        onClick={() => onSelect(art.id)}
      >
        {kind === "video" ? (
          <span className="r22-canvas-art-concept">
            <Video aria-hidden="true" />
            <em>{FIXTURE_VIDEO_CONCEPT_SECONDS}s</em>
          </span>
        ) : (
          <Image src={art.src} fill sizes="128px" alt={art.alt} priority />
        )}
      </Button>
      {starred ? <span className="r22-canvas-art-star" aria-hidden="true"><Star /></span> : null}
      <div className="r22-canvas-art-actions" data-canvas-art-actions={art.id}>
        <Button unstyled type="button" aria-label={`Star ${art.label}`} aria-pressed={starred} data-canvas-art-action="star" onClick={() => onAction("star", art)}>
          <Star aria-hidden="true" />
        </Button>
        {/* 概念卡没有可以存下来的文件,所以它这一格就没有下载 —— 灰着放在那儿也是一句假话。 */}
        {kind === "video" ? null : (
          <Button unstyled type="button" aria-label={`Download ${art.label}`} data-canvas-art-action="download" onClick={() => onAction("download", art)}>
            <Download aria-hidden="true" />
          </Button>
        )}
        {/* 概念卡没有可改的那一帧,所以它这一格也没有这一颗 —— 灰着放在那儿同样是一句假话。 */}
        {kind === "video" ? null : (
          <Button unstyled type="button" aria-label={`Edit ${art.label}`} data-canvas-art-action="edit" onClick={() => onAction("edit", art)}>
            <Wand2 aria-hidden="true" />
          </Button>
        )}
        <Button unstyled type="button" aria-label={`Make more like ${art.label}`} data-canvas-art-action="variants" onClick={() => onAction("variants", art)}>
          <Sparkles aria-hidden="true" />
        </Button>
        {/*
          选包弹层归 Radix 的 popover:点外面关、Esc 关、焦点回到这颗按钮,三件都不再手写。
          `aria-expanded` 也由 `PopoverTrigger` 自己挂 —— 手写那一份迟早和真状态分家。
        */}
        <Popover open={packOpen} onOpenChange={(open) => onPackOpenChange(open, art)}>
          <PopoverTrigger asChild>
            <Button unstyled type="button" aria-label={`Add ${art.label} to a Library pack`} data-canvas-art-action="pack">
              <FolderPlus aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          {packMenu}
        </Popover>
      </div>
    </div>
  );
}

function FixtureWorld({
  style,
  positions,
  batches,
  selected,
  starred,
  packMenuFor,
  renderPackMenu,
  onPackOpenChange,
  onSelect,
  onArtAction,
  onIterate,
}: {
  style: CSSProperties;
  /** 商家自己拖到的位置。没拖过的物件读不到条目,就还在自己的老家。 */
  positions: Record<string, CanvasPoint>;
  /** 板上现在有哪几批。第一批是开局那一批,后面的是商家自己做出来的。 */
  batches: FixtureBatch[];
  selected: string[];
  starred: string[];
  /** 此刻在哪一张上选包。`null` = 没在选。 */
  packMenuFor: string | null;
  renderPackMenu: (art: FixtureArt) => React.ReactNode;
  onPackOpenChange: (open: boolean, art: FixtureArt) => void;
  onSelect: (id: string) => void;
  onArtAction: (action: ArtAction, art: FixtureArt) => void;
  onIterate: (prompt: string) => void;
}) {
  const homes: Record<string, CanvasPoint> = { ...FIXTURE_OBJECT_HOME };
  batches.forEach((batch) => { homes[batch.id] = batch.home; });
  const at = (id: string): CanvasPoint => positions[id] ?? homes[id];
  return (
    <div className="r22-canvas-world" style={style} aria-label="Sample canvas board" data-r22-visual-fixture>
      <article className="r22-canvas-object r22-canvas-sticky" data-canvas-object="sticky" style={{ left: at("sticky").x, top: at("sticky").y }}>
        <span>Sticky · free</span>
        <p>Teal + gold table set. Try one flat-lay, one lifestyle shot.</p>
      </article>

      <article className="r22-canvas-object r22-canvas-research" data-canvas-object="research" style={{ left: at("research").x, top: at("research").y }}>
        <b>Extracted from your page</b>
        <code>harvestcandle.co / raya-collection</code>
        <p>“Four scents inspired by Raya mornings — teal batik, gold thread, warm oud, and pandan light.”</p>
      </article>

      {batches.map((batch, index) => (
        <section
          className={`r22-canvas-object r22-canvas-batch${batch.kind === "video" ? " is-video" : ""}`}
          key={batch.id}
          data-canvas-object={batch.id}
          data-canvas-batch={batch.id}
          style={{ left: at(batch.id).x, top: at(batch.id).y }}
          aria-label={batchTagLabel(batch)}
        >
          <span className="r22-canvas-batch-tag">{batchTagLabel(batch)}</span>
          {batch.madeFrom ? <span className="r22-canvas-batch-origin" data-canvas-batch-origin>Variant of {batch.madeFrom}</span> : null}
          {batch.references.length ? (
            <span className="r22-canvas-batch-origin">
              Made with your reference {batch.references.length === 1 ? "image" : "images"}: {listPhrase(batch.references)}
            </span>
          ) : null}
          <div className="r22-canvas-batch-row">
            {batch.art.map((art) => (
              <ArtCell
                key={art.id}
                art={art}
                kind={batch.kind}
                selected={selected.includes(art.id)}
                starred={starred.includes(art.id)}
                packOpen={packMenuFor === art.id}
                packMenu={renderPackMenu(art)}
                onPackOpenChange={onPackOpenChange}
                onSelect={onSelect}
                onAction={onArtAction}
              />
            ))}
          </div>
          {/* 概念卡自己说清楚自己是什么 —— 一帧占位加一个时长标签,不是一段能播的视频。 */}
          {batch.kind === "video" ? <p className="r22-canvas-batch-honest">Concept only — a still stand-in, not a playable video.</p> : null}
          {index === batches.length - 1 ? (
            <div className="r22-canvas-batch-next" data-canvas-batch-next>
              {FIXTURE_ITERATION_CHIPS.map((suggestion) => (
                <Button unstyled type="button" key={suggestion.chip} data-canvas-iterate={suggestion.chip} onClick={() => onIterate(suggestion.prompt)}>
                  {suggestion.chip}
                </Button>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/**
 * 会话里的一张答案卡(原型 `answerHTML`,L6704-6706)。画布侧的会话面板只有 272px 宽,
 * 所以按 Founder 的裁量省掉 `Get support` 那一颗 —— 剩下的 Copy / Helpful / Not helpful
 * 与那条 `aria-live` 确认位一个不少。
 *
 * 重复问同一件事时 `repeat` 为真:导语换成一句「上面说过」的变体,要点照旧摆出来 ——
 * 逐字重复一整张卡不是回答,是回声。
 */
function OttoAnswerCard({
  answer,
  repeat,
  feedback,
  confirm,
  onCopy,
  onFeedback,
}: {
  answer: OttoCanvasAnswer;
  repeat: boolean;
  feedback: "up" | "down" | null;
  confirm: string;
  onCopy: () => void;
  onFeedback: (vote: "up" | "down") => void;
}) {
  return (
    <li className="r22-canvas-answer" data-otto-answer data-otto-answer-repeat={repeat ? "true" : undefined}>
      <h4>{answer.title}</h4>
      <p>{repeat ? "Same answer as above — nothing about this has changed since you asked. The points again:" : answer.lead}</p>
      <ul>{answer.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
      <p className="r22-canvas-answer-note">{answer.note}</p>
      <div className="r22-canvas-answer-actions">
        <Button unstyled type="button" data-otto-copy onClick={onCopy}>Copy</Button>
        {/*
          Helpful / Not helpful 是**一组互斥的选择**,不是两颗各自开关的按钮 —— 手搓两个
          `aria-pressed` 说不出这件事(读屏会念成两个独立开关),而方向键循环、焦点只占一站
          那一整套也得跟着自己再写一遍。归位到 shadcn 的 ToggleGroup,那一套由 Radix 出。
        */}
        <ToggleGroup
          unstyled
          className="r22-canvas-answer-votes"
          type="single"
          value={feedback ?? ""}
          aria-label="Was this answer helpful?"
          onValueChange={(value) => { if (value === "up" || value === "down") onFeedback(value); }}
        >
          <ToggleGroupItem unstyled value="up" data-otto-vote="up">Helpful</ToggleGroupItem>
          <ToggleGroupItem unstyled value="down" data-otto-vote="down">Not helpful</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <span className="r22-canvas-answer-confirm" role="status" aria-live="polite">{confirm}</span>
    </li>
  );
}

function EmptyWorld({ loading = false, error, style }: { loading?: boolean; error?: string | null; style?: CSSProperties }) {
  return (
    <div className="r22-canvas-world" style={style}>
      <section className="r22-canvas-empty" aria-live="polite" role={error ? "alert" : undefined}>
        <b>{error ? "Canvas could not be loaded" : loading ? "Loading canvas…" : "No canvas items yet"}</b>
        <p>{error || (loading ? "Reading this project's saved items." : "Describe what to make below. New images land here once the request is accepted.")}</p>
      </section>
    </div>
  );
}

function LiveWorld({ nodes, loading, error, style }: { nodes: CanvasNodeDTO[]; loading: boolean; error: string | null; style: CSSProperties }) {
  if (loading || error || nodes.length === 0) return <EmptyWorld loading={loading} error={error} style={style} />;
  return (
    <div className="r22-canvas-world" style={style}>
      {nodes.map((node) => (
        <article
          className={`r22-canvas-live-node is-${node.type} is-${node.status}`}
          key={node.id}
          style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
          tabIndex={0}
          aria-label={`${node.type} canvas item${node.prompt ? `: ${node.prompt}` : ""}`}
        >
          {node.url ? <img src={node.url} alt={node.prompt || "Generated canvas media"} /> : null}
          {node.type === "text" ? <p>{node.text || "Empty note"}</p> : null}
          {!node.url && node.type !== "text" ? (
            <div className="r22-canvas-live-state">
              {node.status === "queued" || node.status === "generating" ? <span className="r22-canvas-mini-spinner" aria-hidden="true" /> : null}
              <b>{node.status === "failed" ? "Generation failed" : node.status === "cancelled" ? "Generation canceled" : node.status === "timeout" ? "Still working" : "Generating"}</b>
              <p>{node.prompt || "Canvas generation"}</p>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function R22CanvasSurface({
  runtimeContext,
  entities,
}: {
  runtimeContext: ImmersiveCanvasRuntimeContext;
  entities: EntityDTO[];
}) {
  const fixture = runtimeContext.visualFixture === "r22";
  const fixtureRouteState = runtimeContext.fixtureRouteState ?? "ready";
  const fixtureSendOutcome = runtimeContext.fixtureSendOutcome ?? "success";
  const searchParams = useSearchParams();
  const activeProject = useMemo(
    () => runtimeContext.projects.find((project) => project.id === runtimeContext.activeProjectId),
    [runtimeContext.activeProjectId, runtimeContext.projects],
  );
  const [ottoOpen, setOttoOpen] = useState(true);
  const [conversationOpen, setConversationOpen] = useState(true);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  /** 「From Library」那个小弹层。它是附件菜单的下一层,所以 Esc 也要认得它。 */
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [ratio, setRatio] = useState("9:16");
  /** 这一次要做图还是做视频概念 —— 参数弹层上那个分段控件。 */
  const [makeKind, setMakeKind] = useState<CanvasMakeKind>("image");
  /** 这一次要做几张(1–4)。价钱跟着它走。 */
  const [makeCount, setMakeCount] = useState(1);
  /**
   * 商家自己在参数弹层里拨过张数没有。
   *
   * 「Warmer light」说的是「**这一批**再来一版更暖的」—— 源批次有四张,那一版就该是四张,
   * 不是悄悄缩成一张。但商家真的自己拨成 2 之后,那句话就该听商家的。所以要记一面旗:
   * 没拨过 = 跟着源批次走,拨过 = 跟着商家走。
   */
  const [countTouched, setCountTouched] = useState(false);
  /** 商家自己做出来的那几批(开局那一批是常量,不进存档)。 */
  const [extraBatches, setExtraBatches] = useState<FixtureBatch[]>([]);
  /** 被星标的成品。星标是「留着」的意思,所以它进存档。 */
  const [starredArt, setStarredArt] = useState<string[]>([]);
  /** 此刻挂在 composer 上的参考图。 */
  const [attachments, setAttachments] = useState<CanvasAttachment[]>([]);
  /**
   * 商家的素材库 —— **和 Library 那一面是同一份存档**(`fikirtive.r22.library.state.v2`)。
   *
   * 上一版这一面自己另开了一个素材包专用的存档键,于是同一件东西在浏览器里有两份账:
   * 画布加进包里的图在 Library 的素材包页里根本看不见,而且两边谁都不会报错。对账裁决
   * 是「Library 的 v2 存档是唯一权威」,所以这里读它、写它,不再有第二份。
   */
  const [library, setLibrary] = useState<LibraryArchive>({ assets: [], packs: [] });
  /** 此刻在哪一张成品上选素材包。`null` = 没在选。 */
  const [packMenuFor, setPackMenuFor] = useState<string | null>(null);
  /** 正在改板上的哪一张。`null` = 没在改。开的是 Library 那一层同一个组件,不是第二份。 */
  const [editArt, setEditArt] = useState<FixtureArt | null>(null);
  const [newPackName, setNewPackName] = useState("");
  const [tool, setTool] = useState<CanvasTool>("select");
  /** 平移与倍率是同一件事的两半(原型 L5985 的 `view`),所以它们是同一个状态。 */
  const [view, setView] = useState<CanvasView>(CANVAS_HOME_VIEW);
  /** 商家自己把物件拖到了哪儿。只记「动过的」,没动过的仍然读老家。 */
  const [objectPos, setObjectPos] = useState<Record<string, CanvasPoint>>({});
  const [selectedArt, setSelectedArt] = useState<string[]>([]);
  /** 框选那个矩形。stage 坐标系,`null` = 此刻没在框。 */
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  /**
   * 手正在板上走(框选 / 拖物件 / 平移)。它比 `dragging` 早一步、也宽一格 —— 拖物件要
   * 越过 3px 阈值才算 `dragging`,而**文字选区从按下的那一刻就开始刷**,所以抑制文本选择
   * 只能挂在这一面旗上。松手就摘:一刀切的 `user-select: none` 会把正常复制一起杀掉。
   */
  const [gesturing, setGesturing] = useState(false);
  const [message, setMessage] = useState(runtimeContext.initialPrompt ?? "");
  const [notice, setNotice] = useState("");
  /**
   * 会话记录。两面共用一份 —— 一句提问在哪一面问都该换回同一张答案卡;只有存档那一步
   * 是样例画布独有的(下面那个 effect 自己带 `fixture` 闸)。
   */
  const [chatLog, setChatLog] = useState<ChatEntry[]>([]);
  /** 答案卡上的复制/评价是**这一次会话里的动作**,不进存档:刷新之后它们不该假装还在。 */
  const [answerUi, setAnswerUi] = useState<Record<number, { feedback?: "up" | "down"; confirm?: string }>>({});
  const [pendingQuestion, setPendingQuestion] = useState<PendingCanvasQuestion | null>(null);
  const [otherAnswer, setOtherAnswer] = useState("");
  const [decisionRecord, setDecisionRecord] = useState<DecisionRecord | null>(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [liveNodes, setLiveNodes] = useState<CanvasNodeDTO[]>([]);
  const [nodesLoading, setNodesLoading] = useState(!fixture);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [costQuote, setCostQuote] = useState<CanvasGenCostQuote | null>(null);
  const [ratioOptions, setRatioOptions] = useState<string[]>(fixture ? FIXTURE_RATIO_OPTIONS : []);
  const [generationProgress, setGenerationProgress] = useState<CanvasGenProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fixtureRestored, setFixtureRestored] = useState(!fixture);
  const [fixtureWorkspaceId, setFixtureWorkspaceId] = useState(fixture ? "" : "production");
  /** 刚在 Create 对话框里建出来的那个项目的名字 —— 名录里只有一个兜底名,真名从那句话来。 */
  const [fixtureNewProjectName, setFixtureNewProjectName] = useState("");
  const [fixtureJob, setFixtureJob] = useState<FixtureCanvasJob | null>(null);
  /** 顶栏该写哪个名字:这一格是刚建出来的那个项目时,写他那句话派生出来的短名。 */
  const fixtureProjectName = runtimeContext.activeProjectId === NEW_PROJECT_FIXTURE_ID && fixtureNewProjectName
    ? fixtureNewProjectName
    : null;
  const [fixtureSendFailedOnce, setFixtureSendFailedOnce] = useState(false);
  const fixtureTimersRef = useRef<number[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  /** 真的那个文件选择器。+ 菜单里那一项按下去,按的就是它。 */
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** + 那颗按钮外面那层锚点。素材库弹层认它当锚,也认它是「不算外面」的那一块。 */
  const attachAnchorRef = useRef<HTMLSpanElement>(null);
  /** 正在走的那一根手指。已经有一根在走时,第二根一律忽略(原型只认 `e.button===0` 的那一根)。 */
  const gesturePointerRef = useRef<number | null>(null);
  /**
   * 「刚刚那一下是拖拽,不是点击」。只在越过阈值时才置真 —— 与抢指针捕获是**同一个开关**,
   * 谁都不许单独提前:提前一步,卡内按钮就再也点不动了(原型 L6085-6086、L6098)。
   */
  const dragEndClickRef = useRef(false);
  /**
   * 挪过的那几步。它**不进存档**:撤销是这一次会话里的动作,刷新之后不该假装还能往回走
   * (与答案卡上的复制/评价同一条纪律)。位置本身是存下来的,撤销栈不是。
   */
  const moveHistoryRef = useRef<{ undo: CanvasMoveStep[]; redo: CanvasMoveStep[] }>({ undo: [], redo: [] });
  const conversationListRef = useRef<HTMLUListElement>(null);
  const actionRef = useRef<{ material: string; actionId: string } | null>(null);
  const answeredRequestsRef = useRef(new Set<string>());
  const fixtureStorageKey = fixture ? scopedR22FixtureKey(`r22:canvas:${runtimeContext.activeProjectId}:${runtimeContext.activeThreadId ?? "new"}`) : "";

  const refreshNodes = useCallback(async () => {
    if (fixture) return;
    const rows = await listCanvasNodes(runtimeContext.activeProjectId).catch(() => ({ error: "load-failed" } as const));
    if ("error" in rows) {
      setNodesError("Canvas items could not be loaded.");
      // 诚实的那半句不能靠「empty state」「inferred」这种 UI 工程师词汇说 —— 商家读不懂。
      setNotice("Canvas items could not be loaded. Retry — this is not an empty canvas.");
    } else {
      setNodesError(null);
      setLiveNodes(rows);
    }
    setNodesLoading(false);
  }, [fixture, runtimeContext.activeProjectId]);

  // `useSearchParams()` 在没有 Suspense 边界的渲染里给得出 null(Next 的类型没说,运行时
  // 会)。两处都拿它拼地址,少一处护栏就是少一处 TypeError,所以两处写法一致。
  const projectHref = useCallback((projectId: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("project", projectId);
    next.delete("thread");
    return `${CANVAS_HREF}?${next.toString()}`;
  }, [searchParams]);

  const threadHref = useCallback((threadId: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("project", runtimeContext.activeProjectId);
    next.set("thread", threadId);
    return `${CANVAS_HREF}?${next.toString()}`;
  }, [runtimeContext.activeProjectId, searchParams]);

  const onNewNode = useCallback((node: { id: string; type: "image" | "video"; pos: { x: number; y: number; w: number; h: number }; status: string; url?: string; prompt: string; generationId?: string; genJobId?: string }) => {
    setLiveNodes((current) => [...current, {
      id: node.id, type: node.type, x: node.pos.x, y: node.pos.y, w: node.pos.w, h: node.pos.h,
      text: null, prompt: node.prompt, generationId: node.generationId ?? null, genJobId: node.genJobId ?? null,
      status: node.status as CanvasNodeDTO["status"], failureReason: "unexplained", batchIndex: null,
      batchSize: null, layoutAnchorNodeId: null, madeFromNodeId: null, threadId: runtimeContext.activeThreadId,
      url: node.url ?? null, mediaWidth: null, mediaHeight: null, origin: null, lineage: null,
    }]);
  }, [runtimeContext.activeThreadId]);

  const onResolve = useCallback((nodeId: string, url: string | null, status: string, generationId?: string) => {
    setLiveNodes((current) => current.map((node) => node.id === nodeId ? { ...node, url, status: status as CanvasNodeDTO["status"], generationId: generationId ?? node.generationId } : node));
    setGenerationProgress(null);
  }, []);

  const onProgress = useCallback((progress: CanvasGenProgress) => setGenerationProgress(progress), []);
  const { generateImage, quoteCosts, imageShapes } = useCanvasGen(
    runtimeContext.activeProjectId,
    onNewNode,
    onResolve,
    runtimeContext.activeThreadId,
    setNotice,
    undefined,
    onProgress,
    refreshNodes,
    (nodeId) => setLiveNodes((current) => current.filter((node) => node.id !== nodeId)),
  );

  useEffect(() => {
    queueMicrotask(() => void refreshNodes());
  }, [refreshNodes]);
  useEffect(() => {
    if (!fixture) return;
    setFixtureWorkspaceId(readR22WorkspaceDirectory().activeId);
    setFixtureNewProjectName(readNewFixtureProjectName());
    setLibrary(readLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY)));
    // 这个 key 会在**同一个组件实例**上随项目/会话切换而改变:顶栏项目菜单走 `<Link>`,
    // 路由只换 query 参数,组件不卸载,内存态一个字都不会自己消失。所以「这个项目没有
    // 存档」必须显式清空,不能什么都不做 —— 否则上一个项目的会话残留在内存里,再被下面
    // 那个写入 effect 原样存进新项目的 key。
    const resetFixtureState = () => {
      setChatLog([]);
      setAnswerUi({});
      setPendingQuestion(null);
      setOtherAnswer("");
      setDecisionRecord(null);
      setFixtureJob(null);
      // 物件被拖到哪儿也是这个项目的东西:切到没有存档的项目,板必须回到老家,
      // 否则上一个项目的摆法会被下面那个写入 effect 原样存进新项目的 key。
      setObjectPos({});
      setSelectedArt([]);
      // 做出来的批次、星标、挂着的参考图、这一次的参数 —— 全是这个项目的东西,一起清。
      setExtraBatches([]);
      setStarredArt([]);
      setAttachments([]);
      setMakeKind("image");
      setMakeCount(1);
      setCountTouched(false);
      moveHistoryRef.current = { undo: [], redo: [] };
      answeredRequestsRef.current.clear();
    };
    const stored = window.sessionStorage.getItem(fixtureStorageKey);
    if (stored) {
      try {
        const restored = JSON.parse(stored) as { version?: number; messages?: ChatEntry[]; pending?: PendingCanvasQuestion | null; other?: string; decision?: DecisionRecord | null; job?: FixtureCanvasJob | null; objects?: Record<string, CanvasPoint>; batches?: FixtureBatch[]; starred?: string[]; attachments?: CanvasAttachment[]; kind?: CanvasMakeKind; count?: number; countTouched?: boolean };
        // v2 = 会话记录从「一串我的话」变成「谁说的 + 说了什么」(Otto 现在也会答话)。
        // 旧存档结构对不上,当场丢掉,不去猜它的形状。
        if (restored.version !== 2) throw new Error("stale fixture state");
        setChatLog(restored.messages ?? []);
        setAnswerUi({});
        setPendingQuestion(restored.pending ?? null);
        setOtherAnswer(restored.other ?? "");
        setDecisionRecord(restored.decision ?? null);
        setFixtureJob(restored.job ?? null);
        // 这一条是 v2 存档后加的字段:老存档读不到就是「一个都没拖过」,不当成坏存档丢掉。
        setObjectPos(restored.objects ?? {});
        // 同一条纪律:这几个字段都是 v2 存档之后加的,老存档读不到就是「还没做过这件事」。
        setExtraBatches(restored.batches ?? []);
        setStarredArt(restored.starred ?? []);
        setAttachments(restored.attachments ?? []);
        setMakeKind(restored.kind ?? "image");
        setMakeCount(restored.count ?? 1);
        setCountTouched(restored.countTouched ?? false);
        setSelectedArt([]);
        // 读回来的位置是**别人那一次**挪出来的:这一次会话没有那几步可以往回走。
        moveHistoryRef.current = { undo: [], redo: [] };
        if (restored.job?.status === "queued" || restored.job?.status === "running") {
          window.setTimeout(() => startFixtureJob(restored.job!.prompt, { actionId: restored.job!.id }), 0);
        }
        if (restored.decision?.status === "answered") answeredRequestsRef.current.add(answeredRequestKey(restored.decision.inputRequestId, restored.decision.taskVersion));
      } catch {
        window.sessionStorage.removeItem(fixtureStorageKey);
        resetFixtureState();
      }
    } else {
      resetFixtureState();
    }
    setFixtureRestored(true);
  }, [fixture, fixtureStorageKey]);
  useEffect(() => {
    if (!fixture || !fixtureRestored) return;
    window.sessionStorage.setItem(fixtureStorageKey, JSON.stringify({ version: 2, messages: chatLog, pending: pendingQuestion, other: otherAnswer, decision: decisionRecord, job: fixtureJob, objects: objectPos, batches: extraBatches, starred: starredArt, attachments, kind: makeKind, count: makeCount, countTouched }));
  }, [attachments, countTouched, decisionRecord, extraBatches, fixture, fixtureJob, chatLog, fixtureRestored, fixtureStorageKey, makeCount, makeKind, objectPos, otherAnswer, pendingQuestion, starredArt]);
  useEffect(() => () => { fixtureTimersRef.current.forEach((timer) => window.clearTimeout(timer)); }, []);
  /**
   * 刚答出来的那张卡必须看得见。会话面板只有 40vh 高,一张答案卡就比一条消息高好几倍 ——
   * 不跟着滚,商家问完一句得自己往下拖才读得到答案(原型 `scrollChat()` 干的就是这件事)。
   * 直接跳到底,不做平滑滚动:这是键盘敲下回车之后的动作,不该带动画。
   */
  useEffect(() => {
    const list = conversationListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chatLog, conversationOpen]);
  useEffect(() => {
    if (fixture) return;
    void quoteCosts(1).then(setCostQuote).catch(() => setCostQuote(null));
    void imageShapes().then((shapes) => {
      setRatioOptions(shapes.options);
      setRatio((current) => shapes.options.includes(current) ? current : shapes.defaultAspect);
    }).catch(() => setRatioOptions([]));
  }, [fixture, imageShapes, quoteCosts]);

  /**
   * 板上现在有哪几批 —— 开局那一批永远在最前面,后面是商家自己做出来的,并存不替换。
   */
  const batches = useMemo(() => [FIXTURE_SEED_BATCH, ...extraBatches], [extraBatches]);
  /** 上面那份的一面镜子 —— 延时回调里读它,免得读到闭包里那份早就旧了的。 */
  const extraBatchesRef = useRef<FixtureBatch[]>([]);
  useEffect(() => { extraBatchesRef.current = extraBatches; }, [extraBatches]);
  /** 每个物件的老家(便签/摘录是常量,批次卡各自带着自己的)。拖过之后读 `objectPos`。 */
  const objectHomes = useMemo(() => {
    const homes: Record<string, CanvasPoint> = { ...FIXTURE_OBJECT_HOME };
    batches.forEach((batch) => { homes[batch.id] = batch.home; });
    return homes;
  }, [batches]);
  /* ————— 板本身:平移 / 缩放 / 拖拽 / 框选(原型 L5983-6189) ————— */

  /** 以 stage 上的某一点为定点缩放(原型 L6009-6013)。不这么做,倍率一动内容就飘走。 */
  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setView((current) => {
      const next = Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, current.zoom * factor));
      const k = next / current.zoom;
      return { x: cx - (cx - current.x) * k, y: cy - (cy - current.y) * k, zoom: next };
    });
  }, []);

  const zoomAtStageCenter = useCallback((factor: number) => {
    const stage = stageRef.current;
    zoomAt((stage?.clientWidth ?? 0) / 2, (stage?.clientHeight ?? 0) / 2, factor);
  }, [zoomAt]);

  /**
   * 滚轮:两指推是平移,按住 ⌘/Ctrl 是缩放(原型 L6014-6019)。
   * 必须走原生监听器 —— React 的 `onWheel` 挂在 root 上是被动的,`preventDefault()` 在那里
   * 只会换来一条警告,页面照样跟着滚。
   */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.pow(1.0015, -event.deltaY));
      else setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /**
   * 往回走一步 / 再走回来一步(原型 L6033-6040)。栈空了就照实说,不假装做了什么。
   *
   * 它们是 `useCallback` 而不是普通函数声明,因为下面那条键盘 effect 把它们放进了依赖表:
   * 每渲染一次就换一个新身份的话,拖一次卡片(每记 pointermove 都重渲染)就会把 window
   * 上那个监听器摘下来再挂回去几十次。
   */
  const undoMove = useCallback(() => {
    const step = moveHistoryRef.current.undo.pop();
    if (!step) {
      setNotice("Nothing to undo.");
      return;
    }
    moveHistoryRef.current.redo.push(step);
    setObjectPos((current) => ({ ...current, [step.id]: step.from }));
    setNotice("");
  }, []);

  const redoMove = useCallback(() => {
    const step = moveHistoryRef.current.redo.pop();
    if (!step) {
      setNotice("Nothing to redo.");
      return;
    }
    moveHistoryRef.current.undo.push(step);
    setObjectPos((current) => ({ ...current, [step.id]: step.to }));
    setNotice("");
  }, []);

  /**
   * Esc 一层一层往下剥(原型 L5915-5930)。这一版**只剩最后一层**:清掉板上的选中。
   *
   * 上一版这里还手写着「先关五个浮层」那一段。五个浮层现在是 Radix 的 popover/menu,
   * 它们的 Esc 走 dismissable layer:监听挂在 `document` 上、**capture 阶段**,而且吃掉
   * 之前先 `event.preventDefault()`(`@radix-ui/react-dismissable-layer` 的
   * `useEscapeKeydown(…, { capture: true })` + `if (!event.defaultPrevented && onDismiss)
   * { event.preventDefault(); onDismiss(); }`)。这个处理器挂在 `window` 的冒泡阶段,
   * 排在它后面,所以浮层开着的时候第一行 `defaultPrevented` 就把这一记挡下了 ——
   * 一记 Esc 关一层,选中不会被顺手清掉。手写那一段留着只会变成第二份判词。
   *
   * 两头仍然都得守,少一头就会一记 Esc 撕两层(壳层 `R22DashboardShell` 的同一道守卫,
   * commit 67de2bd5):
   *   ① **进来先看** `defaultPrevented` —— 更上面那一层已经吃掉这一记了,画布不许再吃第二口;
   *   ② **自己吃掉就喊一声** `preventDefault()` —— 否则后注册的处理器会跟着再剥一层。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      // 编辑层是 Radix 自己的地盘,那一记归它 —— 板不许跟着剥掉自己的一层。
      if (editArt) return;
      if (!selectedArt.length) return;
      event.preventDefault();
      setSelectedArt([]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editArt, selectedArt.length]);

  /**
   * 键盘上的板:⌘Z / ⇧⌘Z 往回走一步、再走回来一步,V / H / B 换工具。
   *
   * 三道守卫,少一道就会咬人:
   *   ① `defaultPrevented` —— 上面那一层已经吃掉这一记了(编辑层里的输入、浮层自己的
   *      键盘模型),画布不许再吃第二口;
   *   ② **焦点在能打字的地方就一个字都不吃** —— 在 composer 里写「video」会当场把工具
   *      换成别的,那是最会咬人的一种「快捷键」;`contenteditable` 同理;
   *   ③ 编辑层开着的时候整条不生效 —— 那一层是另一件事的现场。
   *
   * `preventDefault()` 是为了挡浏览器自己的撤销(输入框之外 ⌘Z 会撤销上一次页面级编辑)。
   * Windows/Linux 的 Ctrl+Z / Ctrl+⇧+Z 一起收:同一个动作,不该只有一半的人按得动。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (editArt) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target && /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey) {
        if (event.altKey || event.key.toLowerCase() !== "z") return;
        event.preventDefault();
        if (event.shiftKey) redoMove();
        else undoMove();
        return;
      }
      if (event.altKey || event.shiftKey) return;
      const nextTool = TOOL_SHORTCUTS[event.key.toLowerCase()];
      if (!nextTool) return;
      event.preventDefault();
      setTool(nextTool);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editArt, redoMove, undoMove]);

  /** 一次拖拽/框选/平移走完之后的收尾:解掉监听、放开手指、退出「拖拽中」与「手势中」。 */
  const endGesture = useCallback((move: (event: PointerEvent) => void, up: (event: PointerEvent) => void) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    gesturePointerRef.current = null;
    setDragging(false);
    setGesturing(false);
  }, []);

  /**
   * stage 上的指针一元分发(原型 L6046-6114)。三条路,次序即判词:
   *   ① box 工具 —— 框选压过底下的物件;
   *   ② 按在物件上且不是 hand 工具 —— 拖物件;
   *   ③ 其余(空地,或 hand 工具按在任何地方)—— 平移整块板。
   */
  const onStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (gesturePointerRef.current !== null) return;
    const stage = stageRef.current;
    if (!stage) return;
    const target = event.target as HTMLElement;
    if (target.isContentEditable) return;
    // 板上现在也有真的输入框(选包弹层里那个「New pack name」)。按在它上面是要打字,
    // 不是要拖那张卡 —— 抢过来当拖拽,光标就会在按下的那一刻跳走。
    if (target.closest("input, textarea")) return;
    // 会话栏、Otto、composer、工具条这些都是**画布上的界面**,不是板。它们一律不在
    // `.r22-canvas-world` 里,所以「按在世界里或按在空地上」这一句就把它们全挡在外面了 ——
    // 比逐个点名一串选择器耐用:以后新加一块浮层,不用回来补名单。
    const insideWorld = target.closest(".r22-canvas-world");
    if (!insideWorld && target !== stage) return;

    const pointerId = event.pointerId ?? 0;
    // 新的一次按下,上一次那面「刚才是拖拽」的旗子作废。
    dragEndClickRef.current = false;
    const rect = stage.getBoundingClientRect();

    if (tool === "box") {
      const startX = event.clientX - rect.left;
      const startY = event.clientY - rect.top;
      gesturePointerRef.current = pointerId;
      // 框选画的是一个选框,不是选字 —— 手一按下就得把文本选择摁住,不然框扫过便签与
      // 卡片时,整片文字会被浏览器刷成蓝色,松手了还留在那儿。
      setGesturing(true);
      setMarquee({ left: startX, top: startY, width: 0, height: 0 });
      // 空地上没有点击要保护,所以框选照原型按下即捕获(L6057)。
      capturePointer(stage, pointerId);
      let lastX = startX;
      let lastY = startY;
      const move = (moveEvent: PointerEvent) => {
        lastX = moveEvent.clientX - rect.left;
        lastY = moveEvent.clientY - rect.top;
        setMarquee({ left: Math.min(startX, lastX), top: Math.min(startY, lastY), width: Math.abs(lastX - startX), height: Math.abs(lastY - startY) });
      };
      const up = () => {
        endGesture(move, up);
        // 命中判定读的是**画出这个框的那两个点**,不是回头去 DOM 里量那个框:框是 React
        // 渲染出来的,松手这一刻它渲染到哪一帧无人担保,量到的可能是上一帧的尺寸。
        const box = {
          left: rect.left + Math.min(startX, lastX),
          top: rect.top + Math.min(startY, lastY),
          right: rect.left + Math.max(startX, lastX),
          bottom: rect.top + Math.max(startY, lastY),
        };
        setSelectedArt([...stage.querySelectorAll<HTMLElement>("[data-canvas-select]")]
          .filter((node) => {
            const item = node.getBoundingClientRect();
            return !(item.right < box.left || item.left > box.right || item.bottom < box.top || item.top > box.bottom);
          })
          .map((node) => node.dataset.canvasSelect!));
        setMarquee(null);
        setTool("select");
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return;
    }

    const objectEl = insideWorld ? target.closest<HTMLElement>("[data-canvas-object]") : null;
    const objectId = objectEl?.dataset.canvasObject;
    if (objectId && tool !== "hand") {
      const from = objectPos[objectId] ?? objectHomes[objectId];
      if (!from) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const scale = view.zoom / 100;
      gesturePointerRef.current = pointerId;
      // 同一条:拖卡片时也别顺手把卡上的字刷成蓝色。它挂在按下这一刻,不等 3px 阈值 ——
      // 文字选区从按下就开始刷,等阈值就已经晚了一截。
      setGesturing(true);
      let moved = false;
      let to = from;
      const move = (moveEvent: PointerEvent) => {
        const dx = (moveEvent.clientX - startX) / scale;
        const dy = (moveEvent.clientY - startY) / scale;
        if (!moved && Math.hypot(dx, dy) > CANVAS_DRAG_THRESHOLD) {
          moved = true;
          // 捕获与「这一次不是点击」同时发生,一步都不许提前。
          dragEndClickRef.current = true;
          capturePointer(stage, moveEvent.pointerId ?? pointerId);
          setDragging(true);
        }
        if (!moved) return;
        to = { x: from.x + dx, y: from.y + dy };
        setObjectPos((current) => ({ ...current, [objectId]: to }));
      };
      const up = () => {
        endGesture(move, up);
        // 一次拖拽 = 撤销栈上的一步(原型 L6025 `pushMove`)。没越过阈值的那一下不是一步。
        if (!moved) return;
        moveHistoryRef.current.undo.push({ id: objectId, from, to });
        moveHistoryRef.current.redo = [];
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const from = { x: view.x, y: view.y };
    gesturePointerRef.current = pointerId;
    capturePointer(stage, pointerId);
    setDragging(true);
    setGesturing(true);
    const move = (moveEvent: PointerEvent) => {
      setView((current) => ({ ...current, x: from.x + (moveEvent.clientX - startX), y: from.y + (moveEvent.clientY - startY) }));
    };
    const up = () => endGesture(move, up);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /**
   * 刚拖完手一松,浏览器还会补一记 click。那一记不是商家的一次点击(原型 L6098/L6155)——
   * 板上每一颗按得动的东西都得先问它一句,否则拖一下批次卡就会顺手触发一次动作。
   */
  function consumedByDrag(): boolean {
    if (!dragEndClickRef.current) return false;
    dragEndClickRef.current = false;
    return true;
  }

  /** 单选(原型 `toggleSel`,L6117-6122):选中的永远只有刚点的这一张,再点一下取消。 */
  function selectArt(id: string) {
    if (consumedByDrag()) return;
    setSelectedArt((current) => (current.length === 1 && current[0] === id ? [] : [id]));
  }

  const worldStyle = worldTransform(view);

  /** Otto 答话时指得出「我们现在在哪块板上」—— 顶栏叫什么,它就叫什么。 */
  const fixtureBoardLabel = fixtureWorkspaceId === "batik-house" ? "the Raya launch board" : "this canvas";

  /**
   * 一张图的确切价钱只有这一个出处:样例画布用原型样张那一份,真接后端的那一面用服务端
   * 报价。价格贴纸与答案卡里的每一个数字都从这里派生 —— 谁都不许再写一遍。
   */
  const imageCredits = fixture ? FIXTURE_IMAGE_CREDITS : costQuote ? costQuote.imageCredits : null;
  /**
   * 送出去之前商家读到的那个数。样例画布这一面它随「几张 / 图还是视频」联动 —— 参数改了
   * 价钱不动,才是真正会咬人的那种谎。真接后端那一面照旧读服务端报价,一次一张。
   */
  const priceLabel = fixture
    ? `${fixtureQuoteCredits(makeKind, makeCount)} cr`
    : imageCredits === null ? "Checking cost…" : `${imageCredits} cr`;
  /** 此刻选中的那几张(按板上的顺序,不按点的顺序 —— 商家读的是板)。 */
  const selectionChips = batches.flatMap((batch) => batch.art.filter((art) => selectedArt.includes(art.id)));
  const selectedLabels = selectionChips.map((art) => art.label);
  const answerContext: OttoAnswerContext = {
    board: fixture ? fixtureBoardLabel : "this canvas",
    imageCredits,
    ratioOptions,
    // 画布这一面没有 routine 的出处。给 `null` 不是省事,是三态里唯一诚实的那一态。
    activeRoutines: null,
    selection: fixture ? selectedLabels : [],
    references: attachments.map((attachment) => attachment.name),
  };

  /**
   * 一次答话落进会话记录。同一张卡第二次出现才是一次「重复问」—— 比的是标题**和**导语:
   * 同一个问题在选中不同图时问出来,答的不是同一件事,那不叫重复。
   */
  function pushAnswer(answer: OttoCanvasAnswer) {
    setChatLog((current) => [
      ...current,
      { from: "answer", answer, repeat: current.some((entry) => entry.from === "answer" && entry.answer.title === answer.title && entry.answer.lead === answer.lead) },
    ]);
  }

  function copyAnswer(index: number, answer: OttoCanvasAnswer) {
    const clipboard = navigator.clipboard;
    if (clipboard?.writeText) void clipboard.writeText(answerCopyText(answer)).catch(() => {});
    setAnswerUi((current) => ({ ...current, [index]: { ...current[index], confirm: "Copied" } }));
  }

  function voteAnswer(index: number, vote: "up" | "down") {
    setAnswerUi((current) => ({
      ...current,
      [index]: { feedback: vote, confirm: vote === "up" ? "Thanks — marked helpful" : "Thanks — feedback recorded" },
    }));
  }

  /** 会话面板里的那几张答案卡与消息行 —— 两面共用一份渲染。 */
  const chatNodes = chatLog.map((item, index) => item.from === "answer" ? (
    <OttoAnswerCard
      key={`answer:${index}:${item.answer.title}`}
      answer={item.answer}
      repeat={item.repeat}
      feedback={answerUi[index]?.feedback ?? null}
      confirm={answerUi[index]?.confirm ?? ""}
      onCopy={() => copyAnswer(index, item.answer)}
      onFeedback={(vote) => voteAnswer(index, vote)}
    />
  ) : (
    <li className={item.from === "me" ? "from-me" : "from-otto"} key={`${item.from}:${index}:${item.text}`}>
      {item.text}
      {item.refs?.length ? (
        // 发出去时挂在这条消息上的参考图。它留在记录里,商家回头读得出「那一次我给了什么」。
        <span className="r22-canvas-message-refs" data-canvas-message-refs>
          {item.refs.map((reference) => (
            // eslint-disable-next-line @next/next/no-img-element -- 参考图是商家自己挑的一张图,连尺寸都不知道,没有可优化的远端资源。
            <img key={reference.id} src={reference.src} alt={reference.name} title={reference.name} />
          ))}
        </span>
      ) : null}
    </li>
  ));

  /**
   * 一次请求从排队走到落板。跑完之后板上**多出一批**,上一批原样留在原地 —— 这一条是
   * 「跟手改一版」整件事成立的前提:旧的没了就没得比,那不叫改一版,叫覆盖。
   */
  function startFixtureJob(prompt: string, options: { actionId?: string; kind?: CanvasMakeKind; count?: number; ratio?: string; references?: string[]; madeFrom?: string | null } = {}) {
    const id = options.actionId ?? fixtureJob?.id ?? `fixture-action-${chatLog.length}`;
    const kind = options.kind ?? makeKind;
    const count = options.count ?? makeCount;
    const shape = options.ratio ?? ratio;
    const references = options.references ?? [];
    const madeFrom = options.madeFrom ?? null;
    setSubmitting(true);
    setFixtureJob({ id, prompt, status: "queued" });
    setNotice(references.length
      ? `Queued with your ${references.length === 1 ? "reference image" : `${references.length} reference images`} — nothing has been charged yet.`
      : "Queued — nothing has been charged yet.");
    fixtureTimersRef.current.push(window.setTimeout(() => {
      setFixtureJob({ id, prompt, status: "running" });
      setNotice("Still on the same request — nothing new was started.");
    }, 320));
    fixtureTimersRef.current.push(window.setTimeout(() => {
      setSubmitting(false);
      setFixtureJob({ id, prompt, status: "completed" });
      // 板上已有几批要读 ref 而不是闭包里那个 state:这一段跑在 920ms 之后,闭包里那份
      // 早就可能是旧的,而编号错一位,进库那条身份就跟着错。
      const board = [FIXTURE_SEED_BATCH, ...extraBatchesRef.current];
      const imageCount = board.reduce((total, batch) => total + (batch.kind === "image" ? batch.art.length : 0), 0);
      const videoCount = board.reduce((total, batch) => total + (batch.kind === "video" ? batch.art.length : 0), 0);
      const made = buildFixtureBatch({ index: board.length, imageCount, videoCount, kind, count, ratio: shape, madeFrom, references });
      setExtraBatches((current) => [...current, made]);
      // 做完就进库,商家一个动作都不用做 —— 但进不去的时候不许照样报「Done」:
      // 板上有、仓库里没有,而回执说全好了,商家下次去 Library 找就是找不到。
      const filed = fileBatchIntoLibrary(made);
      setNotice(!filed
        ? "It landed on the canvas, but there was no room left to keep a copy in your Library."
        : kind === "video"
          ? "Done — the video concept landed on the canvas. It is a still stand-in, not a playable video."
          : "Done — it landed on the canvas. Star the keepers, or ask for variants.");
    }, 920));
  }

  function retryFixtureSend() {
    if (!fixtureJob || fixtureJob.status !== "failed" || submitting) return;
    startFixtureJob(fixtureJob.prompt);
  }

  /* ————— 素材库:两面同一份存档 ————— */

  /** 商家读得到的项目名 —— 东西进库之后卡上那一行来源写的就是它。 */
  const libraryProjectName = activeProject?.name ?? "Canvas";

  /** 一次写入 = 一次落盘 + 内存跟上。落不进去也不把改动留在屏幕上骗人。 */
  function commitLibrary(next: LibraryArchive): boolean {
    if (!writeLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY), next)) return false;
    setLibrary(next);
    return true;
  }

  /**
   * 做出来的东西**自动进库**,商家一个动作都不用做。
   *
   * 这是「总管道」这件事的下半截:板上做完了,东西就该在仓库里找得到 —— 逼商家再按一次
   * 「保存到素材库」,等于把我们的数据结构当成了他的流程。幂等由 `id` 保证(id 带着项目,
   * 两块板上的「Image 1」不是同一张图),所以重渲染、刷新回放都不会在库里多出一份。
   *
   * 视频这一面今天只做得出概念卡 —— 没有可以存进库的那一帧,所以它不进库,也不假装进了。
   *
   * 返回值 = 「回执可以说东西进库了吗」。写不进去(存档满了)必须返回 false,让上面那句
   * 回执改口 —— 悄悄吞掉写入失败再报一句 Done,就是屏幕上写着做到了、仓库里没有。
   * 视频与非 fixture 这两支本来就不该进库,不是失败,所以返回 true。
   */
  function fileBatchIntoLibrary(batch: FixtureBatch): boolean {
    if (!fixture || batch.kind !== "image") return true;
    const stored = readLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY));
    const next = addLibraryAssets(stored, batch.art.map((art) => canvasLibraryAsset({
      projectId: runtimeContext.activeProjectId,
      projectName: libraryProjectName,
      artId: art.id,
      name: art.label,
      src: art.src,
    })));
    if (next === stored) {
      setLibrary(stored);
      return true;
    }
    return commitLibrary(next);
  }

  /** 把一张成品收进一个素材包。已经在包里的原样不动,回执如实说这一次有没有真的加进去。 */
  function saveArtToPack(art: FixtureArt, packId: string, packName: string) {
    const stored = readLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY));
    const asset = canvasLibraryAsset({
      projectId: runtimeContext.activeProjectId,
      projectName: libraryProjectName,
      artId: art.id,
      name: art.label,
      src: art.src,
    });
    const already = stored.assets.find((row) => row.id === asset.id)?.packIds.includes(packId) ?? false;
    if (!commitLibrary(attachToPack(addLibraryAssets(stored, [asset]), [asset.id], packId))) {
      setNotice("There is no room left in this preview, so nothing was kept.");
      return;
    }
    setPackMenuFor(null);
    setNewPackName("");
    setNotice(already ? `${art.label} is already in ${packName}.` : `${art.label} is in ${packName}.`);
  }

  function createPackForArt(art: FixtureArt, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const stored = readLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY));
    const id = newPackId(trimmed, stored.packs);
    if (!commitLibrary({ ...stored, packs: [...stored.packs, { id, name: trimmed }] })) {
      setNotice("There is no room left in this preview, so nothing was kept.");
      return;
    }
    saveArtToPack(art, id, trimmed);
  }

  /**
   * 「收进素材包」那颗按钮的开合。
   *
   * 它长在 `onOpenChange` 上而不是按钮的 `onClick` 上,因为开合现在有三个来源:按钮、
   * 点外面、Esc —— 只认按钮那一个,后两条路关掉弹层时这一面的状态就跟屏幕分家了。
   *
   * 拖拽那道闸留在最前面:刚拖完手一松浏览器还会补一记 click(原型 L6098),那一记不是
   * 商家的一次点击,不许拿它开一个弹层。受控的 `open` 读的是这一面的状态,所以这里直接
   * 返回就等于「这一下没发生过」。
   */
  function onPackOpenChange(open: boolean, art: FixtureArt) {
    if (!open) {
      setPackMenuFor(null);
      return;
    }
    if (consumedByDrag()) return;
    setNewPackName("");
    // 包的名单要读**此刻**库里的实况(商家可能刚在 Library 那一面新建过一个包)。
    setLibrary(readLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY)));
    setNotice("");
    setPackMenuFor(art.id);
  }

  /**
   * 选包那个小弹层。它长在触发它的那一格上,`transform-origin` 也对着那颗按钮 ——
   * 弹层从按下的地方长出来,商家才不用回头找「刚才那一下开出了什么」。
   *
   * ⚠️ 它是 portal 出去的:整层活在 `document.body` 底下,`.r22-canvas-surface` 上那批
   * `--r22-canvas-*` 局部别名在这里一个也解析不出来。所以这一层的 css 只许用央册的
   * `--r22-*` 全局 token(样板与那次 P1 的现场见 `components/library/r22-library.css`
   * 单图详情层那段注释)。
   */
  function renderPackMenu(art: FixtureArt) {
    return (
      <PopoverContent
        className="r22-canvas-popover r22-canvas-pack-menu"
        align="end"
        side="bottom"
        sideOffset={6}
        data-canvas-pack-menu={art.id}
      >
        <p>Save {art.label} to</p>
        {library.packs.length ? (
          <div className="r22-canvas-pack-list">
            {library.packs.map((pack) => (
              <Button unstyled type="button" key={pack.id} data-canvas-pack-pick={pack.id} onClick={() => saveArtToPack(art, pack.id, pack.name)}>{pack.name}</Button>
            ))}
          </div>
        ) : null}
        <div className="r22-canvas-pack-new">
          <Input
            unstyled
            aria-label="New pack name"
            placeholder="New pack name"
            value={newPackName}
            onChange={(event) => setNewPackName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); createPackForArt(art, newPackName); } }}
          />
          <Button unstyled type="button" disabled={!newPackName.trim()} data-canvas-pack-create onClick={() => createPackForArt(art, newPackName)}>New pack</Button>
        </div>
      </PopoverContent>
    );
  }

  /** 板上这一张在库里长什么样。改图那一层拿它当原图,回链与版本条读的也是它。 */
  function artAsLibraryAsset(art: FixtureArt) {
    return canvasLibraryAsset({
      projectId: runtimeContext.activeProjectId,
      projectName: libraryProjectName,
      artId: art.id,
      name: art.label,
      src: art.src,
    });
  }

  /**
   * 板上改出来的一版:库里多出**新的一条**,板上那一张一个字节都不动。
   *
   * 原图与改出来的那一条一起写进去 —— 板上这一张可能还没进过库(商家没做过任何一批,
   * 屏幕上就是开局那一批),而一条「Edited from …」指着一个库里没有的东西,回链就是死的。
   */
  function makeArtEdit(art: FixtureArt, change: string): ImageEditOutcome {
    const source = artAsLibraryAsset(art);
    const created = editedLibraryAsset({ source, change });
    const stored = readLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY));
    if (stored.assets.some((row) => row.id === created.id)) {
      setLibrary(stored);
      return "existing";
    }
    if (!commitLibrary(addLibraryAssets(stored, [source, created]))) {
      setNotice("There is no room left in this preview, so nothing was kept.");
      return "no-room";
    }
    setNotice(`${created.name} is in your Library — ${IMAGE_EDIT_CREDITS} cr.`);
    return "added";
  }

  /** 挂一张参考图上去。同一张挂两次只留一条 —— 多按一下不该变成两张一样的参考。 */
  function attachReference(attachment: CanvasAttachment) {
    setAttachOpen(false);
    setLibraryOpen(false);
    setAttachments((current) => (current.some((item) => item.id === attachment.id) ? current : [...current, attachment]));
    setNotice(`${attachment.name} is attached to your next request. It costs nothing to attach.`);
  }

  function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 同一个文件选两次也要能触发一次 change,所以先把它清空。
    event.target.value = "";
    if (!file) return;
    if (file.size > FIXTURE_ATTACHMENT_MAX_BYTES) {
      setNotice("That image is larger than 1.5 MB, so this canvas cannot keep it. Pick a smaller one.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src) {
        setNotice("That image could not be read. Try another one.");
        return;
      }
      attachReference({ id: `upload:${file.name}:${file.size}`, name: file.name, src, from: "upload" });
    };
    reader.onerror = () => setNotice("That image could not be read. Try another one.");
    reader.readAsDataURL(file);
  }

  /** 成品自己的下载 —— 存下去的就是屏上那一张,不是一个「即将支持」的提示。 */
  function downloadArt(art: FixtureArt) {
    const link = document.createElement("a");
    link.href = art.src;
    link.download = `${art.label.toLowerCase().replace(/\s+/g, "-")}.jpg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setNotice(`${art.label} is saved to your device.`);
  }

  /** 逐图动作排上那四颗(Grok 的结果排形状)。 */
  function onArtAction(action: ArtAction, art: FixtureArt) {
    if (consumedByDrag()) return;
    if (action === "star") {
      setStarredArt((current) => (current.includes(art.id) ? current.filter((id) => id !== art.id) : [...current, art.id]));
      setNotice("");
      return;
    }
    if (action === "download") {
      downloadArt(art);
      return;
    }
    if (action === "edit") {
      // 版本条要读的是**此刻**库里的实况(商家可能刚在 Library 那一面改过一版)。
      setLibrary(readLibraryArchive(scopedR22FixtureKey(LIBRARY_FIXTURE_KEY)));
      setPackMenuFor(null);
      setEditArt(art);
      setNotice("");
      return;
    }
    const prompt = `Make more like ${art.label}`;
    setChatLog((current) => [...current, { from: "me", text: prompt }]);
    startFixtureJob(prompt, { kind: "image", madeFrom: art.label });
  }

  /**
   * 跟手改一版:那句话先落进输入框,再照常送出去 —— 走的是同一条生成路。
   *
   * 张数**默认沿用源批次**:「Warmer light」说的是「这一批再来一版更暖的」,源批次四张,
   * 那一版就该是四张。上一版拿的是 composer 当前那个数,于是四张的批次改一版只出一张 ——
   * 商家读到的语义与屏上出来的东西对不上。商家自己在参数弹层拨过张数就听商家的。
   *
   * 拨定的那个数同时落回 composer:价格贴纸与真正做出来的东西永远是同一个数,不许有一处
   * 写着 3 cr、另一处做出 12 cr 的东西。
   */
  function iterateBatch(prompt: string) {
    if (consumedByDrag()) return;
    const source = batches[batches.length - 1];
    const count = countTouched ? makeCount : source?.art.length ?? makeCount;
    setMakeCount(count);
    setMessage(prompt);
    void submitMessage(prompt, { count });
  }

  /**
   * `raw` 是「不经过输入框直接送出去的那一句」(跟手改一版的 chip 走的就是这条);
   * `override` 是那一次自己拨定的参数 —— `setMakeCount` 要下一帧才生效,读状态就读成了旧的。
   */
  const submitMessage = async (raw?: string, override?: { count?: number }) => {
    const next = (raw ?? message).trim();
    if (!next) return;
    if (fixture) {
      if (fixtureRouteState !== "ready") {
        setNotice("This project is not available. Return to Projects before sending anything.");
        return;
      }
      // 挂着的参考图跟这一条消息一起走:发出去之后它归这条消息,不再跟着输入框。
      const sentRefs = attachments;
      setChatLog((current) => [...current, sentRefs.length ? { from: "me", text: next, refs: sentRefs } : { from: "me", text: next }]);
      const chatReply = chatResponseFor(next, answerContext);
      // 一句真的疑问句先于提问流:它缺的是一个答案,不是一次拍板。「Make the Raya hero
      // more premium」不是疑问句,那条路照旧走 `fixtureQuestionFlow`,一个字没变。
      const flow = chatReply?.kind === "answer" ? null : fixtureQuestionFlow(next);
      if (flow) {
        const taskId = `fixture-task-${chatLog.length + 1}`;
        const inputRequestId = `${taskId}:input:1`;
        const taskVersion = 1;
        setPendingQuestion({ taskId, inputRequestId, taskVersion, flow, prompt: next, index: 0, selected: [], answers: [] });
        setDecisionRecord({
          taskId,
          inputRequestId,
          taskVersion,
          status: "waiting",
          title: `${flow.title} · ${flow.questions.length} questions`,
          detail: `Why Otto paused: ${flow.reason}`,
          events: [{ kind: "input_requested", label: "Input requested", detail: `${flow.questions.length} required decisions · 0 cr while waiting` }],
        });
        setOttoOpen(true);
        setConversationOpen(true);
        setNotice("Otto paused — no credits used while waiting for your answer.");
      } else if (chatReply) {
        // 一句寒暄或一次提问都不是一次生成:不排任务卡、不动 `fixtureJob`、不报价。
        // 也不弹回执条 —— 答案本身就是回执,再飘一条黑条只会挡住输入框。
        if (chatReply.kind === "line") setChatLog((current) => [...current, { from: "otto", text: chatReply.text }]);
        else pushAnswer(chatReply.answer);
        setConversationOpen(true);
      } else {
        if (fixtureSendOutcome === "permission") {
          setFixtureJob({ id: `fixture-action-${chatLog.length + 1}`, prompt: next, status: "failed" });
          setNotice("Your workspace permission does not allow this generation. Nothing ran and no credits were used.");
        } else if (fixtureSendOutcome === "credits") {
          setFixtureJob({ id: `fixture-action-${chatLog.length + 1}`, prompt: next, status: "failed" });
          setNotice("Insufficient credits. Nothing ran; add credits before retrying this exact request.");
        } else if ((fixtureSendOutcome === "error" || fixtureSendOutcome === "unknown") && !fixtureSendFailedOnce) {
          const id = `fixture-action-${chatLog.length + 1}`;
          setSubmitting(true);
          window.setTimeout(() => {
            setSubmitting(false);
            setFixtureSendFailedOnce(true);
            setFixtureJob({ id, prompt: next, status: "failed" });
            setNotice(fixtureSendOutcome === "unknown" ? "Otto could not confirm what happened. Check this same request before sending another — nothing counts as done, and nothing was charged." : "That request was not confirmed. Nothing was charged, and sending again picks up the same request instead of a new one.");
          }, 360);
        } else startFixtureJob(next, { references: sentRefs.map((reference) => reference.name), count: override?.count });
      }
      setMessage("");
      // 参考图已经跟着那条消息走了,输入框上不该再挂着同一批 —— 否则下一句会悄悄再带一遍。
      setAttachments([]);
      return;
    }
    // 同一道闸装在真接后端这一面 —— 在这里一句 "hi" 会真的排一次生成、真的花商家的钱。
    // 答话落在 Conversation 里(会话列表下面),与样例画布同一张卡、同一套判词。
    const liveChat = chatResponseFor(next, answerContext);
    if (liveChat) {
      setChatLog((current) => [...current, { from: "me", text: next }]);
      if (liveChat.kind === "line") setChatLog((current) => [...current, { from: "otto", text: liveChat.text }]);
      else pushAnswer(liveChat.answer);
      setConversationOpen(true);
      setMessage("");
      return;
    }
    if (!costQuote || !ratioOptions.length) {
      setNotice("Wait for the exact generation cost and available ratio before sending.");
      return;
    }
    if (submitting) return;
    const material = JSON.stringify({ projectId: runtimeContext.activeProjectId, threadId: runtimeContext.activeThreadId, prompt: next, ratio });
    if (actionRef.current?.material !== material) actionRef.current = { material, actionId: freshCanvasActionId() };
    setSubmitting(true);
    setNotice("");
    const accepted = await generateImage(next, { x: 1020, y: 520, w: 320, h: 320 }, [], {}, 1, { actionId: actionRef.current.actionId, aspectRatio: ratio });
    setSubmitting(false);
    if (!accepted) return;
    actionRef.current = null;
    setMessage("");
    setNotice("Generation accepted. The card on the canvas fills in as the job runs.");
  };

  const currentQuestion = pendingQuestion?.flow.questions[pendingQuestion.index];
  const currentAnswer = pendingQuestion ? [...pendingQuestion.selected, ...(otherAnswer.trim() ? [otherAnswer.trim()] : [])].join(", ") : "";

  function toggleQuestionOption(label: string) {
    if (!pendingQuestion || !currentQuestion) return;
    setOtherAnswer("");
    setPendingQuestion((current) => current ? { ...current, selected: currentQuestion.multi ? (current.selected.includes(label) ? current.selected.filter((item) => item !== label) : [...current.selected, label]) : [label] } : current);
  }

  function continueQuestion() {
    if (!pendingQuestion || !currentQuestion || !currentAnswer) return;
    const answers = [...pendingQuestion.answers, currentAnswer];
    if (pendingQuestion.index < pendingQuestion.flow.questions.length - 1) {
      setPendingQuestion({ ...pendingQuestion, index: pendingQuestion.index + 1, selected: [], answers });
      setOtherAnswer("");
      setDecisionRecord((current) => current ? { ...current, title: `${pendingQuestion.flow.title} · ${pendingQuestion.index + 2} of ${pendingQuestion.flow.questions.length}`, events: [...current.events, { kind: "answer", label: currentQuestion.header, detail: currentAnswer }] } : current);
      return;
    }
    const requestKey = answeredRequestKey(pendingQuestion.inputRequestId, pendingQuestion.taskVersion);
    if (answeredRequestsRef.current.has(requestKey)) {
      setNotice("This answer was already accepted. Otto picked up the one you saved — no second task and no extra credits.");
      return;
    }
    answeredRequestsRef.current.add(requestKey);
    const detail = pendingQuestion.flow.questions.map((question, index) => `${question.question} ${answers[index]}`).join(" · ");
    setDecisionRecord((current) => current ? { ...current, status: "answered", title: `${pendingQuestion.flow.title} · ${answers.length} answers saved`, detail: `Why Otto paused: ${pendingQuestion.flow.reason} · ${detail}`, events: [...current.events, { kind: "answer", label: currentQuestion.header, detail: currentAnswer }, { kind: "resumed", label: "Task resumed", detail: `Continued from your saved answers · version ${pendingQuestion.taskVersion} · 0 cr` }] } : current);
    setPendingQuestion(null);
    setOtherAnswer("");
    setNotice("Decision saved in Conversation. Otto picked the task back up, and waiting cost 0 cr.");
  }

  function cancelQuestion() {
    if (!pendingQuestion) return;
    setDecisionRecord((current) => current ? { ...current, status: "cancelled", title: `${pendingQuestion.flow.title} · task cancelled`, detail: "No answer was used. No credits were spent.", events: [...current.events, { kind: "cancelled", label: "Task cancelled", detail: "This decision is closed. Answering it again does not restart the task." }] } : current);
    setPendingQuestion(null);
    setOtherAnswer("");
    setNotice("Task cancelled — no credits were used.");
  }

  /**
   * 板上此刻一批东西都没有 —— 起手模板那一排只在这时出现。
   *
   * 判词与板本身画的是**同一条**:样例板恢复完了、项目开得起来、而这个工作区没有开局那一批
   * (`EmptyWorld` 那一支)。板上已经有东西的时候不出这一排 —— 那时商家要的是「再改一版」,
   * 不是「从头起手」,跟手改一版的 chips 就长在最后那一批下面。
   */
  const boardEmpty = fixture
    && fixtureRouteState === "ready"
    && fixtureRestored
    && Boolean(fixtureWorkspaceId)
    && fixtureWorkspaceId !== "batik-house";

  return (
    <section
      className="r22-canvas-surface"
      data-r22-canvas-surface
      data-fixture={fixture ? "r22" : "live"}
      aria-label="Canvas workspace"
    >
      <header className="r22-canvas-topbar" data-r22-canvas-topbar>
        <Link className="r22-canvas-icon-button" href={fixture ? `${CREATE_NAV_HREF}?fixture=r22` : CREATE_NAV_HREF} aria-label="Back to Canvas projects">
          <ArrowLeft aria-hidden="true" />
        </Link>
        {/*
          切项目那一层是**一串动作**(每一项都把商家带到另一块板),所以它是 menu 不是
          popover:上下键走、首字母跳、Escape 关、焦点回到触发器 —— 这一整套键盘模型由
          shadcn 的 DropdownMenu(Radix)出,手写的 `div` 一样都没有。
        */}
        <div className="r22-canvas-project-switcher">
          <DropdownMenu
            open={projectMenuOpen && (!fixture || fixtureRouteState === "ready")}
            onOpenChange={setProjectMenuOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button unstyled
                type="button"
                className="r22-canvas-project-button"
                disabled={fixture && fixtureRouteState !== "ready"}
              >
                {/* fixture 也有不止一块板(Quick create 就是第二块)—— 顶栏写死一个名字,
                    商家从 Library 点进来看到的就是别人的板名。名字一律读当前项目。 */}
                <span>{fixture ? fixtureRouteState === "loading" ? "Loading project…" : fixtureRouteState !== "ready" ? "Project unavailable" : !fixtureWorkspaceId ? "Loading project…" : fixtureWorkspaceId === "batik-house" ? (fixtureProjectName ?? activeProject?.name ?? "Raya launch") : "New workspace project" : (activeProject?.name ?? "Current project")}</span>
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="r22-canvas-popover r22-canvas-project-menu" align="start" sideOffset={8}>
              <DropdownMenuGroup>
                {runtimeContext.projects.map((project) => (
                  <DropdownMenuItem key={project.id} asChild>
                    <Link href={projectHref(project.id)}>{project.name}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <span className="r22-canvas-saved">
          {fixture ? fixtureRouteState === "ready" ? "Saved just now" : fixtureRouteState === "loading" ? "Checking project…" : "Project unavailable" : nodesLoading ? "Loading project…" : nodesError ? "Project unavailable" : "Loaded from project"}
        </span>
        <span className="r22-canvas-topbar-spacer" />
        {fixture && <span className="r22-canvas-sample-note">Prototype · sample data</span>}
        <Button unstyled type="button" className="r22-canvas-quiet-button" disabled={fixture && fixtureRouteState !== "ready"} onClick={() => setNotice("Sharing is not connected yet.")}>Share</Button>
        <Button unstyled type="button" className="r22-canvas-quiet-button" disabled={fixture && fixtureRouteState !== "ready"} onClick={() => setNotice("Export is not connected yet.")}>Export</Button>
      </header>

      <div
        className={`r22-canvas-stage${tool === "hand" ? " is-panning" : ""}${dragging ? " is-dragging" : ""}${gesturing ? " is-gesturing" : ""}`}
        data-r22-canvas-stage
        ref={stageRef}
        onPointerDown={onStagePointerDown}
      >
        {fixture && fixtureRouteState !== "ready" ? <EmptyWorld style={worldStyle} loading={fixtureRouteState === "loading"} error={fixtureRouteState === "error" ? "Project data could not be loaded." : fixtureRouteState === "permission" ? "You do not have permission to open this project." : fixtureRouteState === "unknown" ? "Otto could not confirm whether this project opened. Retry — this is not an empty project." : "This project no longer exists in the current workspace."} /> : fixture ? !fixtureRestored || !fixtureWorkspaceId ? <EmptyWorld style={worldStyle} loading /> : fixtureWorkspaceId === "batik-house" ? <FixtureWorld style={worldStyle} positions={objectPos} batches={batches} selected={selectedArt} starred={starredArt} packMenuFor={packMenuFor} renderPackMenu={renderPackMenu} onPackOpenChange={onPackOpenChange} onSelect={selectArt} onArtAction={onArtAction} onIterate={iterateBatch} /> : <EmptyWorld style={worldStyle} /> : <LiveWorld nodes={liveNodes} loading={nodesLoading} error={nodesError} style={worldStyle} />}
        {marquee ? <div className="r22-canvas-marquee" data-r22-canvas-marquee style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }} /> : null}
        {fixture && fixtureRouteState !== "ready" && fixtureRouteState !== "loading" ? <div className="r22-canvas-route-actions"><Link href={`${CREATE_NAV_HREF}?fixture=r22`}>Back to projects</Link>{fixtureRouteState === "error" || fixtureRouteState === "unknown" ? <Link href={`${canvasHref("fixture-raya")}&fixture=r22`}>Retry</Link> : null}</div> : null}
        {!fixture && nodesError ? <Button unstyled type="button" className="r22-canvas-live-retry" onClick={() => { setNodesLoading(true); void refreshNodes(); }}>Retry canvas</Button> : null}
        {fixtureJob ? <div className={`r22-canvas-job is-${fixtureJob.status}`} role="status" data-canvas-job-status={fixtureJob.status} data-canvas-action-id={fixtureJob.id}><span>{JOB_STAGE_LABEL[fixtureJob.status]}</span><b>{fixtureJob.prompt}</b><small>{fixtureJob.status === "completed" ? "Saved to this canvas" : fixtureJob.status === "failed" ? "0 cr · nothing ran" : "Still the same request"}</small></div> : null}

        <aside
          className={`r22-canvas-otto${ottoOpen ? "" : " is-collapsed"}`}
          data-r22-canvas-otto
        >
          <Button unstyled type="button" className="r22-canvas-otto-head" aria-expanded={ottoOpen} onClick={() => setOttoOpen((open) => !open)}>
            <OttoMark />
            <b>Otto</b>
            <span>{fixture && fixtureRouteState !== "ready" ? "unavailable" : pendingQuestion ? "needs input" : fixtureJob?.status === "queued" || fixtureJob?.status === "running" ? "working" : fixtureJob?.status === "failed" ? "needs attention" : fixture ? "idle" : submitting || generationProgress ? "working" : costQuote && ratioOptions.length && !nodesError ? "ready" : "checking"}</span>
            <ChevronDown aria-hidden="true" />
          </Button>
          {ottoOpen && (
            <div className="r22-canvas-otto-body">
              {fixture && fixtureRouteState !== "ready" ? <p>Project access must be restored before Otto can read or run anything.</p> : pendingQuestion ? <><p>Paused — I need {pendingQuestion.flow.questions.length} decisions before I continue.</p><ul><li><span className="is-done"><Check aria-hidden="true" /></span>Checked the project brief and Otto IQ</li><li><span>?</span>Waiting for your answer</li></ul></> : fixtureJob ? <><p>{fixtureJob.status === "completed" ? "Done — that one landed on the canvas." : fixtureJob.status === "failed" ? "That request did not run. Nothing was charged." : "Working on it — still the same request, no second one started."}</p><ul><li><span className={fixtureJob.status !== "failed" ? "is-done" : ""}>{fixtureJob.status !== "failed" ? <Check aria-hidden="true" /> : "!"}</span>{fixtureJob.status === "failed" ? "No credits used, and nothing was completed" : "Queued once, not twice"}</li></ul></> : fixture ? (
                <>
                  <p>All 4 images are done. Star the keepers, or ask for variants.</p>
                  <ul>
                    <li><span className="is-done"><Check aria-hidden="true" /></span>Reading your brand memory</li>
                    <li><span className="is-done"><Check aria-hidden="true" /></span>Image 1 &amp; 2 ready</li>
                    <li><span className="is-done"><Check aria-hidden="true" /></span>Image 3 &amp; 4 ready</li>
                  </ul>
                </>
              ) : (
                <p>{submitting || generationProgress
                  ? "Working on it — the card on the canvas fills in as the job runs."
                  : costQuote && ratioOptions.length && !nodesError
                    ? "Otto is ready. The exact price and what is available were both checked before anything can run."
                    : "Checking this canvas, what is available, and the exact price. Nothing can run until that is done."}</p>
              )}
            </div>
          )}
        </aside>

        {pendingQuestion && currentQuestion ? <Card className="r22-canvas-input-card" role="region" aria-labelledby="r22CanvasInputTitle">
          <div className="r22-canvas-input-kicker"><i /><span>{currentQuestion.header} · {currentQuestion.required ? "Required" : "Optional"}</span><em>{pendingQuestion.index + 1} of {pendingQuestion.flow.questions.length}</em></div>
          <h3 id="r22CanvasInputTitle">{currentQuestion.question}</h3>
          <p>{currentQuestion.help}</p>
          {currentQuestion.multi ? <div className="r22-canvas-input-options" role="group" aria-label={currentQuestion.question}>{currentQuestion.options.map((option) => { const selected = pendingQuestion.selected.includes(option.label); return <label className={selected ? "is-selected" : ""} key={option.label}><Checkbox unstyled checked={selected} onCheckedChange={() => toggleQuestionOption(option.label)} /><span><b>{option.label}{option.recommended ? <em>Recommended</em> : null}</b><small>{option.description}</small></span></label>; })}</div> : <RadioGroup unstyled className="r22-canvas-input-options" aria-label={currentQuestion.question} value={pendingQuestion.selected[0] ?? ""} onValueChange={toggleQuestionOption}>{currentQuestion.options.map((option) => { const selected = pendingQuestion.selected.includes(option.label); return <label className={selected ? "is-selected" : ""} key={option.label}><RadioGroupItem unstyled value={option.label} /><span><b>{option.label}{option.recommended ? <em>Recommended</em> : null}</b><small>{option.description}</small></span></label>; })}</RadioGroup>}
          <Input unstyled className="r22-canvas-input-other" value={otherAnswer} onChange={(event) => { setOtherAnswer(event.target.value); if (!currentQuestion.multi) setPendingQuestion((current) => current ? { ...current, selected: [] } : current); }} placeholder="Something else…" aria-label="Other answer" />
          <footer><span>Paused · 0 cr now · up to {pendingQuestion.flow.cost} cr after review</span><Button unstyled type="button" onClick={cancelQuestion}>Cancel task</Button><Button unstyled type="button" className="is-primary" disabled={!currentAnswer} onClick={continueQuestion}>{pendingQuestion.index < pendingQuestion.flow.questions.length - 1 ? "Next" : "Continue task"}</Button></footer>
        </Card> : null}

        <aside
          className={`r22-canvas-conversation${conversationOpen ? "" : " is-collapsed"}${historyExpanded ? " is-expanded" : ""}`}
          data-r22-canvas-conversation
        >
          <div className="r22-canvas-conversation-head"><Button unstyled type="button" aria-expanded={conversationOpen} onClick={() => setConversationOpen((open) => !open)}>Conversation <span>· {fixture ? fixtureRouteState === "ready" ? 1 + chatLog.length + (decisionRecord ? 1 : 0) + (fixtureJob ? 1 : 0) : 0 : runtimeContext.threads.length}</span>{pendingQuestion ? <em>Waiting</em> : null}<ChevronDown aria-hidden="true" /></Button>{conversationOpen ? <Button unstyled type="button" aria-label={historyExpanded ? "Close full conversation" : "Expand conversation"} onClick={() => setHistoryExpanded((open) => !open)}>{historyExpanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</Button> : null}</div>
          {conversationOpen && (
            <ul className="r22-canvas-conversation-list" ref={conversationListRef}>
              {fixture && fixtureRouteState !== "ready" ? <li className="from-otto">Project conversation is unavailable until access is restored.</li> : fixture ? (
                <>
                  <li className="from-otto">Project brief loaded. Ask me what to create.</li>
                  {chatNodes}
                  {fixtureJob ? <li className="from-otto">{fixtureJob.status === "failed" ? "That request did not run — no credits used." : fixtureJob.status === "completed" ? "Done — that one landed on the canvas." : "Working on it — I'll post here when it lands."}</li> : null}
                  {decisionRecord ? <li key="fixture-decision" data-input-request-id={decisionRecord.inputRequestId} data-task-version={decisionRecord.taskVersion} className={`r22-canvas-decision is-${decisionRecord.status}${decisionOpen ? " is-open" : ""}`}><Button unstyled type="button" onClick={() => setDecisionOpen((open) => !open)}><span>Decision</span><em>{decisionRecord.status === "waiting" ? "Waiting" : decisionRecord.status === "answered" ? "Answered" : "Cancelled"}</em></Button><b>{decisionRecord.title}</b>{decisionOpen ? <div className="r22-canvas-decision-detail"><p><strong>Why Otto paused</strong><br />{decisionRecord.detail}</p><ol>{decisionRecord.events.map((event, index) => <li key={`${event.kind}:${index}`}><span>{event.label}</span><small>{event.detail}</small></li>)}</ol></div> : null}</li> : null}
                </>
              ) : (
                // 真接后端那一面:上半截是已存下的会话入口,下半截是这一次问出来的答案。
                <>
                  {runtimeContext.threads.length
                    ? runtimeContext.threads.map((thread) => <li className={thread.id === runtimeContext.activeThreadId ? "from-otto is-active" : "from-otto"} key={thread.id}><Link href={threadHref(thread.id)}>{thread.title}</Link></li>)
                    : chatLog.length ? null : <li className="from-otto">No conversation yet. Describe what to make below and Otto starts the first one.</li>}
                  {chatNodes}
                </>
              )}
            </ul>
          )}
        </aside>

        {/*
          回执条与输入框住在同一格里。它靠 `bottom: calc(100% + 16px)` 贴在输入框**上方**,
          所以输入框长几行都遮不到 —— 上一版给的是一个固定的 `bottom: 86px`,输入框一长
          就被黑条压住。原型那一条也压着输入框(`.toasts` bottom:84px vs `.omnibox`
          bottom:20px + ~91px 高),这是原型自己的坑,照抄坑不叫忠实。
        */}
        <div className="r22-canvas-dock" data-r22-canvas-dock>
        {/* 空板上的起手模板 —— 与 Library 快产车间是同一个组件、同一批句子。点一下只把句子
            填进下面那个输入框,发送仍然是商家自己按的那一下;问题卡在的时候整排锁住,与
            参数弹层那几个控件同一条纪律。 */}
        {boardEmpty ? <CreationTemplateRow locked={Boolean(pendingQuestion)} onPick={(template) => setMessage(template.prompt)} /> : null}
        <div className={`r22-canvas-notice${notice ? " is-visible" : ""}`} aria-live="polite"><span>{notice}</span>{fixtureJob?.status === "failed" && (fixtureSendOutcome === "error" || fixtureSendOutcome === "unknown") ? <Button unstyled type="button" disabled={submitting} onClick={retryFixtureSend}>{submitting ? "Retrying…" : fixtureSendOutcome === "unknown" ? "Check this request" : "Retry"}</Button> : null}</div>

        <form
          className="r22-canvas-composer"
          data-r22-canvas-composer
          onSubmit={(event) => {
            event.preventDefault();
            void submitMessage();
          }}
        >
          {/*
            上下文条 —— 板上选中的那几张、以及挂着的参考图。它是 composer 的第一行,因为
            它回答的是「我这句话在说谁」:选中两张再问一句,答的就该是那两张的事。
          */}
          {fixture && (selectionChips.length > 0 || attachments.length > 0) ? (
            <div className="r22-canvas-composer-chips" data-r22-canvas-chips>
              {selectionChips.map((art) => (
                <span className="r22-canvas-chip" key={art.id} data-canvas-context-chip={art.id}>
                  <b>{art.label}</b>
                  <Button unstyled type="button" aria-label={`Remove ${art.label} from this request`} data-canvas-chip-remove={art.id} onClick={() => setSelectedArt((current) => current.filter((id) => id !== art.id))}>
                    <X aria-hidden="true" />
                  </Button>
                </span>
              ))}
              {attachments.map((reference) => (
                <span className="r22-canvas-chip is-reference" key={reference.id} data-canvas-reference-chip={reference.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- 商家刚挑的一张图,连尺寸都不知道,没有可优化的远端资源。 */}
                  <img src={reference.src} alt="" />
                  <b>{reference.name}</b>
                  <Button unstyled type="button" aria-label={`Remove ${reference.name} from this request`} data-canvas-reference-remove={reference.id} onClick={() => setAttachments((current) => current.filter((item) => item.id !== reference.id))}>
                    <X aria-hidden="true" />
                  </Button>
                </span>
              ))}
            </div>
          ) : null}
          <Textarea unstyled
            rows={1}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitMessage();
              }
            }}
            placeholder="Ask Otto, or describe what to make…"
            aria-label="Describe what to make"
          />
          <div className="r22-canvas-composer-row">
            {/*
              + 那颗按钮身上挂着两层:附件**菜单**(两三个动作 → DropdownMenu),以及它
              第二层开出来的素材库**弹层**(一格一格的缩略图,是内容不是动作 → Popover)。
              两层长在同一个位置上,所以素材库那一层用 `PopoverAnchor` 认这颗按钮当锚点 ——
              锚点包在外面而不是让两个 Radix 触发器互相套,链路少一节就少一处会断的地方。
            */}
            <Popover open={libraryOpen && fixture} onOpenChange={setLibraryOpen}>
              <PopoverAnchor asChild>
                <span className="r22-canvas-attach-anchor" ref={attachAnchorRef}>
                  <DropdownMenu open={attachOpen} onOpenChange={setAttachOpen}>
                    <DropdownMenuTrigger asChild>
                      <Button unstyled type="button" className="r22-canvas-plus" aria-label="Attach">
                        <Plus aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="r22-canvas-popover r22-canvas-attach-menu" align="start" side="top" sideOffset={8}>
                      <DropdownMenuGroup>
                        {fixture ? (
                          // 样例画布这一面两项都是真的:一颗开真的文件选择器,一颗开素材库小弹层。
                          <>
                            <DropdownMenuItem asChild>
                              <Button unstyled type="button" onClick={() => setLibraryOpen(true)}>From Library</Button>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Button unstyled type="button" onClick={() => fileInputRef.current?.click()}>Upload an image</Button>
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            <DropdownMenuItem asChild>
                              <Button unstyled type="button" onClick={() => setNotice(entities.length ? "Pick from Library — attaching a saved reference is not connected yet." : "Nothing is saved in your Library yet.")}>From Library</Button>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Button unstyled type="button" onClick={() => setNotice("Upload is not connected yet.")}>Upload a file</Button>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Button unstyled type="button" onClick={() => setNotice("Link attachment is not connected yet.")}>Paste a link</Button>
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </PopoverAnchor>
              <PopoverContent
                className="r22-canvas-popover r22-canvas-library-picker"
                align="start"
                side="top"
                sideOffset={8}
                data-r22-canvas-library-picker
                onFocusOutside={(event) => {
                  /*
                   * 附件菜单关掉的时候,Radix 会把焦点还给开它的那颗 + 按钮 —— 而那颗按钮
                   * 正是这一层自己的锚点。焦点落回自己的锚点不是「点到了外面」,顺手把刚
                   * 开出来的这一层关掉,商家按下「From Library」就会看见弹层一闪就没了。
                   */
                  if (attachAnchorRef.current?.contains(event.target as Node)) event.preventDefault();
                }}
              >
                <p>Saved in your Library</p>
                {/*
                  挑的是商家**真的**存着的东西 —— 读的就是 Library 那一面的存档,所以他刚
                  上传的照片、刚在别的板上做出来的图,在这里立刻挑得到。上一版这里是四张
                  写死的私种子:商家看着自己库里有十几张,弹层里却永远只有那四张。
                */}
                <div className="r22-canvas-library-grid">
                  {library.assets.filter((asset) => !asset.hidden).map((asset) => (
                    <Button unstyled type="button" key={asset.id} data-canvas-library-pick={asset.id} onClick={() => attachReference({ id: `library:${asset.id}`, name: asset.name, src: asset.poster, from: "library" })}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- 小弹层里的缩略图,与 chip 用同一张图,不值得再走一轮远端优化。 */}
                      <img src={asset.poster} alt="" />
                      <span>{asset.name}</span>
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {/* 真的文件选择器。它不占位置,+ 菜单那一项按下去按的就是它。 */}
            <Input unstyled ref={fileInputRef} className="r22-canvas-file-input" type="file" accept="image/*" tabIndex={-1} aria-label="Upload an image" onChange={onPickFile} />
            <span />
            {/*
              参数收在一个弹层里,不铺在输入框上:商家一次只在这里改「做什么、什么形状、
              几张」。三排都是**一组里挑一个**,所以三排都是 ToggleGroup `type="single"` ——
              手搓的 `role="group"` + 一排 `aria-pressed` 说的是「三个各自开关的按钮」,
              而且方向键循环、焦点只占一站那一整套得自己再写一遍(写第二遍就是第二份)。
            */}
            <Popover open={ratioOpen && ratioOptions.length > 0} onOpenChange={setRatioOpen}>
              <PopoverTrigger asChild>
                <Button unstyled type="button" className="r22-canvas-ratio">{fixture && makeCount > 1 ? `${ratio} · ${makeCount}` : ratio}</Button>
              </PopoverTrigger>
              <PopoverContent className="r22-canvas-popover r22-canvas-ratio-menu" align="end" side="top" sideOffset={8} data-r22-canvas-params>
                {fixture ? (
                  <ToggleGroup
                    unstyled
                    className="r22-canvas-param-row"
                    type="single"
                    value={makeKind}
                    aria-label="What to make"
                    onValueChange={(value) => { if (value) setMakeKind(value as CanvasMakeKind); }}
                  >
                    <ToggleGroupItem unstyled value="image" data-canvas-kind="image">Image</ToggleGroupItem>
                    <ToggleGroupItem unstyled value="video" data-canvas-kind="video">Video</ToggleGroupItem>
                  </ToggleGroup>
                ) : null}
                <ToggleGroup
                  unstyled
                  className="r22-canvas-shape-grid"
                  type="single"
                  value={ratio}
                  aria-label="Shape"
                  onValueChange={(value) => { if (!value) return; setRatio(value); if (!fixture) setRatioOpen(false); }}
                >
                  {ratioOptions.map((value) => (
                    <ToggleGroupItem unstyled key={value} value={value} data-canvas-ratio={value}>
                      <i style={{ aspectRatio: value.replace(":", " / ") }} aria-hidden="true" />
                      <span>{value}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {fixture ? (
                  <ToggleGroup
                    unstyled
                    className="r22-canvas-param-row"
                    type="single"
                    value={String(makeCount)}
                    aria-label="How many"
                    onValueChange={(value) => { if (!value) return; setMakeCount(Number(value)); setCountTouched(true); }}
                  >
                    {Array.from({ length: CANVAS_IMAGE_MAX_VARIANT_COUNT }, (_, index) => index + 1).map((value) => (
                      <ToggleGroupItem unstyled key={value} value={String(value)} data-canvas-count={value}>{value}</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                ) : null}
              </PopoverContent>
            </Popover>
            <span className="r22-canvas-price">{priceLabel}</span>
            <Button unstyled type="submit" className="r22-canvas-send" aria-label="Send" disabled={submitting || (fixture && fixtureRouteState !== "ready") || (!fixture && (!costQuote || !ratioOptions.length))}>
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </form>
        </div>

        {/*
          工具条 —— 手上只可能有一件工具,所以它是一组单选,不是一排各自开关的按钮:
          `ToggleGroup type="single"` 出方向键循环、Tab 只占一站、选中态由 `data-state` 说。
          快捷键写在 tooltip 里(`<Kbd>` 是 shadcn 官方给 tooltip 内按键的那一件),字母
          与真正生效的映射同出 `TOOL_BUTTONS`,不会有一处写着 V、另一处按出别的工具。
        */}
        <TooltipProvider>
          <ToggleGroup
            unstyled
            className="r22-canvas-tools"
            data-r22-canvas-tools
            type="single"
            value={tool}
            aria-label="Canvas tools"
            onValueChange={(value) => { if (value) setTool(value as CanvasTool); }}
          >
            {TOOL_BUTTONS.map(({ id, label, icon: Icon, key }) => (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <ToggleGroupItem unstyled value={id} aria-label={label}>
                    <Icon aria-hidden="true" />
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {label}
                  {key ? <Kbd className="ml-1.5">{key}</Kbd> : null}
                </TooltipContent>
              </Tooltip>
            ))}
          </ToggleGroup>
        </TooltipProvider>

        {/* 改这一张 —— 与 Library 单图详情开的是**同一个**组件、同一份存档、同一个价钱。 */}
        {editArt ? (() => {
          const source = artAsLibraryAsset(editArt);
          return (
            <ImageEditLayer
              asset={source}
              versions={editedVersionsOf(library.assets, source.id)}
              onClose={() => setEditArt(null)}
              onMakeEdit={(change) => makeArtEdit(editArt, change)}
            />
          );
        })() : null}

        {/*
          缩放条那五颗是**一件东西的五个按钮**,不是五颗各自飘着的键 —— 归位到 shadcn 的
          ButtonGroup:它出 `role="group"` 与相邻按钮的 focus 环 z-index(挨着的两颗谁被
          键盘选中,谁的环就压在上面,不会被邻居切掉半圈)。
        */}
        <ButtonGroup className="r22-canvas-zoom" data-r22-canvas-zoom aria-label="Canvas view">
          <Button unstyled type="button" aria-label="Undo" onClick={undoMove}><Undo2 aria-hidden="true" /></Button>
          <Button unstyled type="button" aria-label="Redo" onClick={redoMove}><Redo2 aria-hidden="true" /></Button>
          <Button unstyled type="button" aria-label="Zoom out" onClick={() => zoomAtStageCenter(1 / CANVAS_ZOOM_STEP)}><Minus aria-hidden="true" /></Button>
          {/* 按一下回到出发时那个视角 —— 重置的是整个视角,不只是倍率(原型 L6022)。 */}
          <Button unstyled type="button" className="r22-canvas-zoom-label" aria-label="Reset zoom" onClick={() => setView(CANVAS_HOME_VIEW)}>{Math.round(view.zoom)}%</Button>
          <Button unstyled type="button" aria-label="Zoom in" onClick={() => zoomAtStageCenter(CANVAS_ZOOM_STEP)}><Plus aria-hidden="true" /></Button>
        </ButtonGroup>
      </div>
    </section>
  );
}

export default R22CanvasSurface;
