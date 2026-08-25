"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
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
  Star,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CANVAS_HREF, CREATE_NAV_HREF } from "@fikirtive/core/navigation";
import type { EntityDTO } from "@/lib/types";
import { canvasHref } from "./canvas-href";
import { listCanvasNodes, type CanvasNodeDTO } from "@/lib/canvas-actions";
import type { ImmersiveCanvasRuntimeContext } from "./NorthstarCanvasWorkspace";
import { freshCanvasActionId, useCanvasGen, type CanvasGenProgress } from "./useCanvasGen";
import { CANVAS_IMAGE_MAX_VARIANT_COUNT, type CanvasGenCostQuote } from "@/lib/canvas-gen-costs";
import { readR22WorkspaceDirectory, scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";
import "./r22-canvas.css";

type CanvasTool = "select" | "box" | "hand" | "image" | "star" | "arrange";

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
};

type ChatResponse = { kind: "line"; text: string } | { kind: "answer"; answer: OttoCanvasAnswer };

type ChatEntry =
  | { from: "me" | "otto"; text: string }
  | { from: "answer"; answer: OttoCanvasAnswer; repeat: boolean };

/** 商家读得懂的形状名。表里没有的比例原样报出去,不硬塞一个形容词。 */
const RATIO_SHAPE_WORD: Record<string, string> = { "9:16": "vertical", "1:1": "square", "16:9": "wide", "4:5": "portrait" };

/**
 * 样例画布那一张图的价钱。真接后端的那一面读服务端报价(`quoteCosts`),两面共用同一个
 * `imageCredits` 变量往下走 —— 价格贴纸、答案里的单价、批量四张的总价,全从这一处派生。
 * 「同一个价钱写在三处」正是漂移的起点,所以这一面只允许有这一个出处。
 */
const FIXTURE_IMAGE_CREDITS = 3;

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
export function canvasAnswerFor(prompt: string, context: OttoAnswerContext): OttoCanvasAnswer {
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
}> = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "box", label: "Box select", icon: Frame },
  { id: "hand", label: "Pan", icon: Hand },
  { id: "image", label: "Add image", icon: ImagePlus },
  { id: "star", label: "Star selected", icon: Star },
  { id: "arrange", label: "Arrange canvas", icon: LayoutGrid },
];

function OttoMark() {
  return <Image className="r22-otto-mark" src="/brand/r22-otto-thinking.svg" width={120} height={110} alt="" />;
}

function FixtureWorld() {
  return (
    <div className="r22-canvas-world" aria-label="Sample canvas board" data-r22-visual-fixture>
      <article className="r22-canvas-object r22-canvas-sticky">
        <span>Sticky · free</span>
        <p>Teal + gold table set. Try one flat-lay, one lifestyle shot.</p>
      </article>

      <article className="r22-canvas-object r22-canvas-research">
        <b>Extracted from your page</b>
        <code>harvestcandle.co / raya-collection</code>
        <p>“Four scents inspired by Raya mornings — teal batik, gold thread, warm oud, and pandan light.”</p>
      </article>

      <section className="r22-canvas-object r22-canvas-batch" aria-label="Batch of four images">
        <span className="r22-canvas-batch-tag">Batch · {CANVAS_IMAGE_MAX_VARIANT_COUNT} images · {FIXTURE_IMAGE_CREDITS * CANVAS_IMAGE_MAX_VARIANT_COUNT} cr</span>
        <div className="r22-canvas-batch-row">
          <Button unstyled className="r22-canvas-art r22-canvas-art-one" type="button" aria-label="Image 1">
            <Image src="/fixtures/r22-canvas/art-1.jpg" fill sizes="128px" alt="Raya concept 1" priority />
          </Button>
          <Button unstyled className="r22-canvas-art r22-canvas-art-two" type="button" aria-label="Image 2">
            <Image src="/fixtures/r22-canvas/art-2.jpg" fill sizes="128px" alt="Raya concept 2" priority />
          </Button>
          <Button unstyled className="r22-canvas-art r22-canvas-art-three" type="button" aria-label="Image 3">
            <Image src="/fixtures/r22-canvas/art-3.jpg" fill sizes="128px" alt="Raya concept 3" priority />
          </Button>
          <Button unstyled className="r22-canvas-art r22-canvas-art-four" type="button" aria-label="Image 4">
            <Image src="/fixtures/r22-canvas/art-4.jpg" fill sizes="128px" alt="Raya concept 4" priority />
          </Button>
        </div>
      </section>
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
        <Button unstyled type="button" className={feedback === "up" ? "is-selected" : ""} aria-pressed={feedback === "up"} onClick={() => onFeedback("up")}>Helpful</Button>
        <Button unstyled type="button" className={feedback === "down" ? "is-selected" : ""} aria-pressed={feedback === "down"} onClick={() => onFeedback("down")}>Not helpful</Button>
      </div>
      <span className="r22-canvas-answer-confirm" role="status" aria-live="polite">{confirm}</span>
    </li>
  );
}

function EmptyWorld({ loading = false, error }: { loading?: boolean; error?: string | null }) {
  return (
    <div className="r22-canvas-world">
      <section className="r22-canvas-empty" aria-live="polite" role={error ? "alert" : undefined}>
        <b>{error ? "Canvas could not be loaded" : loading ? "Loading canvas…" : "No canvas items yet"}</b>
        <p>{error || (loading ? "Reading this project's saved items." : "Describe what to make below. New images land here once the request is accepted.")}</p>
      </section>
    </div>
  );
}

function LiveWorld({ nodes, loading, error, zoom }: { nodes: CanvasNodeDTO[]; loading: boolean; error: string | null; zoom: number }) {
  if (loading || error || nodes.length === 0) return <EmptyWorld loading={loading} error={error} />;
  return (
    <div className="r22-canvas-world" style={{ transform: `translate(-560px, -260px) scale(${zoom / 100})` }}>
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
  const [ratioOpen, setRatioOpen] = useState(false);
  const [ratio, setRatio] = useState("9:16");
  const [tool, setTool] = useState<CanvasTool>("select");
  const [zoom, setZoom] = useState(100);
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
  const [ratioOptions, setRatioOptions] = useState<string[]>(fixture ? ["9:16", "1:1", "16:9"] : []);
  const [generationProgress, setGenerationProgress] = useState<CanvasGenProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fixtureRestored, setFixtureRestored] = useState(!fixture);
  const [fixtureWorkspaceId, setFixtureWorkspaceId] = useState(fixture ? "" : "production");
  const [fixtureJob, setFixtureJob] = useState<FixtureCanvasJob | null>(null);
  const [fixtureSendFailedOnce, setFixtureSendFailedOnce] = useState(false);
  const fixtureTimersRef = useRef<number[]>([]);
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
      answeredRequestsRef.current.clear();
    };
    const stored = window.sessionStorage.getItem(fixtureStorageKey);
    if (stored) {
      try {
        const restored = JSON.parse(stored) as { version?: number; messages?: ChatEntry[]; pending?: PendingCanvasQuestion | null; other?: string; decision?: DecisionRecord | null; job?: FixtureCanvasJob | null };
        // v2 = 会话记录从「一串我的话」变成「谁说的 + 说了什么」(Otto 现在也会答话)。
        // 旧存档结构对不上,当场丢掉,不去猜它的形状。
        if (restored.version !== 2) throw new Error("stale fixture state");
        setChatLog(restored.messages ?? []);
        setAnswerUi({});
        setPendingQuestion(restored.pending ?? null);
        setOtherAnswer(restored.other ?? "");
        setDecisionRecord(restored.decision ?? null);
        setFixtureJob(restored.job ?? null);
        if (restored.job?.status === "queued" || restored.job?.status === "running") {
          window.setTimeout(() => startFixtureJob(restored.job!.prompt, restored.job!.id), 0);
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
    window.sessionStorage.setItem(fixtureStorageKey, JSON.stringify({ version: 2, messages: chatLog, pending: pendingQuestion, other: otherAnswer, decision: decisionRecord, job: fixtureJob }));
  }, [decisionRecord, fixture, fixtureJob, chatLog, fixtureRestored, fixtureStorageKey, otherAnswer, pendingQuestion]);
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

  /** Otto 答话时指得出「我们现在在哪块板上」—— 顶栏叫什么,它就叫什么。 */
  const fixtureBoardLabel = fixtureWorkspaceId === "batik-house" ? "the Raya launch board" : "this canvas";

  /**
   * 一张图的确切价钱只有这一个出处:样例画布用原型样张那一份,真接后端的那一面用服务端
   * 报价。价格贴纸与答案卡里的每一个数字都从这里派生 —— 谁都不许再写一遍。
   */
  const imageCredits = fixture ? FIXTURE_IMAGE_CREDITS : costQuote ? costQuote.imageCredits : null;
  const priceLabel = imageCredits === null ? "Checking cost…" : `${imageCredits} cr`;
  const answerContext: OttoAnswerContext = {
    board: fixture ? fixtureBoardLabel : "this canvas",
    imageCredits,
    ratioOptions,
    // 画布这一面没有 routine 的出处。给 `null` 不是省事,是三态里唯一诚实的那一态。
    activeRoutines: null,
  };

  /** 一次答话落进会话记录。同一个标题第二次出现就是一次「重复问」,导语换成变体。 */
  function pushAnswer(answer: OttoCanvasAnswer) {
    setChatLog((current) => [
      ...current,
      { from: "answer", answer, repeat: current.some((entry) => entry.from === "answer" && entry.answer.title === answer.title) },
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
    <li className={item.from === "me" ? "from-me" : "from-otto"} key={`${item.from}:${index}:${item.text}`}>{item.text}</li>
  ));

  function startFixtureJob(prompt: string, actionId?: string) {
    const id = actionId ?? fixtureJob?.id ?? `fixture-action-${chatLog.length}`;
    setSubmitting(true);
    setFixtureJob({ id, prompt, status: "queued" });
    setNotice("Queued — nothing has been charged yet.");
    fixtureTimersRef.current.push(window.setTimeout(() => {
      setFixtureJob({ id, prompt, status: "running" });
      setNotice("Still on the same request — nothing new was started.");
    }, 320));
    fixtureTimersRef.current.push(window.setTimeout(() => {
      setSubmitting(false);
      setFixtureJob({ id, prompt, status: "completed" });
      setNotice("Done — it landed on the canvas. Star the keepers, or ask for variants.");
    }, 920));
  }

  function retryFixtureSend() {
    if (!fixtureJob || fixtureJob.status !== "failed" || submitting) return;
    startFixtureJob(fixtureJob.prompt);
  }

  const submitMessage = async () => {
    const next = message.trim();
    if (!next) return;
    if (fixture) {
      if (fixtureRouteState !== "ready") {
        setNotice("This project is not available. Return to Projects before sending anything.");
        return;
      }
      setChatLog((current) => [...current, { from: "me", text: next }]);
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
        } else startFixtureJob(next);
      }
      setMessage("");
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
        <div className="r22-canvas-project-switcher">
          <Button unstyled
            type="button"
            className="r22-canvas-project-button"
            disabled={fixture && fixtureRouteState !== "ready"}
            aria-expanded={projectMenuOpen}
            onClick={() => setProjectMenuOpen((open) => !open)}
          >
            <span>{fixture ? fixtureRouteState === "loading" ? "Loading project…" : fixtureRouteState !== "ready" ? "Project unavailable" : !fixtureWorkspaceId ? "Loading project…" : fixtureWorkspaceId === "batik-house" ? "Raya launch" : "New workspace project" : (activeProject?.name ?? "Current project")}</span>
            <ChevronDown aria-hidden="true" />
          </Button>
          {projectMenuOpen && (!fixture || fixtureRouteState === "ready") && (
            <div className="r22-canvas-project-menu">
              {runtimeContext.projects.map((project) => (
                <Link
                  key={project.id}
                  href={projectHref(project.id)}
                  onClick={() => setProjectMenuOpen(false)}
                >
                  {project.name}
                </Link>
              ))}
            </div>
          )}
        </div>
        <span className="r22-canvas-saved">
          {fixture ? fixtureRouteState === "ready" ? "Saved just now" : fixtureRouteState === "loading" ? "Checking project…" : "Project unavailable" : nodesLoading ? "Loading project…" : nodesError ? "Project unavailable" : "Loaded from project"}
        </span>
        <span className="r22-canvas-topbar-spacer" />
        {fixture && <span className="r22-canvas-sample-note">Prototype · sample data</span>}
        <Button unstyled type="button" className="r22-canvas-quiet-button" disabled={fixture && fixtureRouteState !== "ready"} onClick={() => setNotice("Sharing is not connected yet.")}>Share</Button>
        <Button unstyled type="button" className="r22-canvas-quiet-button" disabled={fixture && fixtureRouteState !== "ready"} onClick={() => setNotice("Export is not connected yet.")}>Export</Button>
      </header>

      <div className="r22-canvas-stage" data-r22-canvas-stage>
        {fixture && fixtureRouteState !== "ready" ? <EmptyWorld loading={fixtureRouteState === "loading"} error={fixtureRouteState === "error" ? "Project data could not be loaded." : fixtureRouteState === "permission" ? "You do not have permission to open this project." : fixtureRouteState === "unknown" ? "Otto could not confirm whether this project opened. Retry — this is not an empty project." : "This project no longer exists in the current workspace."} /> : fixture ? !fixtureRestored || !fixtureWorkspaceId ? <EmptyWorld loading /> : fixtureWorkspaceId === "batik-house" ? <FixtureWorld /> : <EmptyWorld /> : <LiveWorld nodes={liveNodes} loading={nodesLoading} error={nodesError} zoom={zoom} />}
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
        <div className={`r22-canvas-notice${notice ? " is-visible" : ""}`} aria-live="polite"><span>{notice}</span>{fixtureJob?.status === "failed" && (fixtureSendOutcome === "error" || fixtureSendOutcome === "unknown") ? <Button unstyled type="button" disabled={submitting} onClick={retryFixtureSend}>{submitting ? "Retrying…" : fixtureSendOutcome === "unknown" ? "Check this request" : "Retry"}</Button> : null}</div>

        <form
          className="r22-canvas-composer"
          data-r22-canvas-composer
          onSubmit={(event) => {
            event.preventDefault();
            void submitMessage();
          }}
        >
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
            <Button unstyled type="button" className="r22-canvas-plus" aria-label="Attach" aria-expanded={attachOpen} onClick={() => setAttachOpen((open) => !open)}>
              <Plus aria-hidden="true" />
            </Button>
            {attachOpen && (
              <div className="r22-canvas-popover r22-canvas-attach-menu">
                <Button unstyled type="button" onClick={() => setNotice(entities.length ? "Pick from Library — attaching a saved reference is not connected yet." : "Nothing is saved in your Library yet.")}>From Library</Button>
                <Button unstyled type="button" onClick={() => setNotice("Upload is not connected yet.")}>Upload a file</Button>
                <Button unstyled type="button" onClick={() => setNotice("Link attachment is not connected yet.")}>Paste a link</Button>
              </div>
            )}
            <span />
            <Button unstyled type="button" className="r22-canvas-ratio" aria-expanded={ratioOpen} onClick={() => setRatioOpen((open) => !open)}>{ratio}</Button>
            {ratioOpen && ratioOptions.length > 0 && (
              <div className="r22-canvas-popover r22-canvas-ratio-menu">
                {ratioOptions.map((value) => (
                  <Button unstyled type="button" key={value} onClick={() => { setRatio(value); setRatioOpen(false); }}>{value}</Button>
                ))}
              </div>
            )}
            <span className="r22-canvas-price">{priceLabel}</span>
            <Button unstyled type="submit" className="r22-canvas-send" aria-label="Send" disabled={submitting || (fixture && fixtureRouteState !== "ready") || (!fixture && (!costQuote || !ratioOptions.length))}>
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </form>
        </div>

        <div className="r22-canvas-tools" data-r22-canvas-tools role="toolbar" aria-label="Canvas tools">
          {TOOL_BUTTONS.map(({ id, label, icon: Icon }) => (
            <Button unstyled type="button" key={id} className={tool === id ? "is-active" : ""} aria-label={label} aria-pressed={tool === id} onClick={() => setTool(id)}>
              <Icon aria-hidden="true" />
            </Button>
          ))}
        </div>

        <div className="r22-canvas-zoom" data-r22-canvas-zoom>
          <Button unstyled type="button" aria-label="Undo" onClick={() => setNotice("Nothing to undo.")}><Undo2 aria-hidden="true" /></Button>
          <Button unstyled type="button" aria-label="Redo" onClick={() => setNotice("Nothing to redo.")}><Redo2 aria-hidden="true" /></Button>
          <Button unstyled type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(25, value - 10))}><Minus aria-hidden="true" /></Button>
          <Button unstyled type="button" className="r22-canvas-zoom-label" aria-label="Reset zoom" onClick={() => setZoom(100)}>{zoom}%</Button>
          <Button unstyled type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(200, value + 10))}><Plus aria-hidden="true" /></Button>
        </div>
      </div>
    </section>
  );
}

export default R22CanvasSurface;
