"use client";

/**
 * CreationConversation.tsx —— 按下 Create 之后那一整块地方:**左产物,右线程**。
 *
 * Founder 2026-08-26 深夜第 1 件。为什么它不是一条更好看的浮条:创作不是「说一句、拿一张、
 * 走人」。商家说一句、看一批、改一句、再看一批 —— 这中间他要同时看得见**做出来的东西**
 * 与**说过的话**,而一条浮在网格上的输入条只给得起后半件,产物一落地就被打回 Library 的
 * 网格里,和三个月前那些图混在一起。
 *
 * 取形:Cloudflare 面板骨架(底册 §1:头部会话切换、composer 永远钉在底部)+ Cofounder 的
 * 全屏工作区(§7 语法⑨:左产物右线程)。对话里的每一件事都用全站那一批共用零件
 * (`ConversationParts`)—— 问卷卡、动作卡、闸卡、@ 引用在这里与在画布、在面板是同一份。
 *
 * 三条纪律,都不是这一面自己发明的:
 *   ① **报价从画布那一份派生**(`fixtureQuoteCredits`),这个文件里一个价格字面量都没有;
 *   ② **落地 = 进库 + 进板 + 进线程表**,三件一起发生,少一件商家就会觉得东西丢了
 *      (Quick create 那条路已经付过这笔学费);
 *   ③ **做不到的事一句话说清**(`honestDeviationLine`)——贴在产物旁边,不写免责段。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUp, ImageIcon, Star, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ActionCards,
  AssistantProse,
  GateCard,
  MessageBubble,
  QuestionnaireCard,
  WorkedLine,
  type ConversationAction,
} from "@/components/otto/conversation/ConversationParts";
import {
  MentionChips,
  MentionPicker,
  useMentionField,
} from "@/components/otto/conversation/MentionField";
import { honestDeviationLine } from "@/components/otto/conversation/honest-deviation";
import { upsertOttoFixtureThread } from "@/components/otto/conversation/otto-thread-archive";
import { CANVAS_IMAGE_MAX_VARIANT_COUNT } from "@/lib/canvas-gen-costs";
import type { ChatThreadDTO } from "@/lib/types";
import {
  FIXTURE_RATIO_OPTIONS,
  FIXTURE_VIDEO_CONCEPT_CREDITS,
  FIXTURE_VIDEO_CONCEPT_SECONDS,
  appendCanvasFixtureHandoff,
  fixtureBatchHome,
  fixtureQuoteCredits,
  type CanvasMakeKind,
} from "@/components/canvas/r22-canvas-fixture";
import {
  QUICK_CREATE_PROJECT_ID,
  isVagueCreationRequest,
  libraryCanvasHref,
  quickCreateAsset,
  type LibraryArchive,
  type LibraryAsset,
} from "@/components/library/library-fixture";
import { CreationTemplateRow } from "./CreationTemplateRow";
import {
  CREATION_FIXTURE_START_CREDITS,
  CREATION_FIXTURE_TOPUP_CREDITS,
  CREATION_QUESTIONS,
  CREATION_TOPUP_NOTICE,
  creationBalanceLine,
  creationCanAfford,
  creationMentionCandidates,
} from "./creation-fixture";
import "./r22-creation.css";

/** 线程里的一条。产物不进这里 —— 它们住在左边那一栏。 */
type CreationEntry =
  | { kind: "said"; id: string; text: string; refs: string[] }
  | { kind: "prose"; id: string; text: string }
  | { kind: "landed"; id: string; text: string; deviation?: string; assetIds: string[]; credits: number }
  | { kind: "gate"; id: string; needed: number };

/** 还没落号的那一条(`id` 由 `push` 按落进去时排第几来给)。分配律走一遍,联合才不会被压平。 */
type Draft<T> = T extends unknown ? Omit<T, "id"> & { id?: string } : never;
type CreationDraft = Draft<CreationEntry>;

/** 这一场创作在存档里的线程身份 —— 一场一条,不是每答一句新开一条。 */
const CREATION_THREAD_ID = "fixture-creation-1";
/** 样张一律用这一刻,不读时钟(与全站 fixture 同一个口径)。 */
const CREATION_FIXTURE_NOW = "2026-08-25T08:42:00.000Z";
/** 一次生成从排上到落地的样张节拍。 */
const CREATION_RUN_MS = 720;
/** 完成那一行读到的工时 —— 预置值,不是读时钟算的。 */
const CREATION_WORKED_SECONDS = 26;

const CREATION_GREETING = "What are we making today?";

export function CreationConversation({
  open,
  onOpenChange,
  archive,
  fixture,
  workspaceId,
  onFile,
  onStar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  archive: LibraryArchive;
  fixture: boolean;
  /** 线程要进哪个工作区的那张表。 */
  workspaceId: string;
  /** 落地:把这一批写进 Library 存档。返回 false = 真的没写进去,回执必须改口。 */
  onFile: (assets: LibraryAsset[]) => boolean;
  /** 把这几张标成 Starred(动作卡「Keep these in Starred」按下去真的动的就是它)。 */
  onStar: (ids: string[]) => boolean;
}) {
  const [entries, setEntries] = React.useState<CreationEntry[]>([]);
  const [made, setMade] = React.useState<LibraryAsset[]>([]);
  const [balance, setBalance] = React.useState(CREATION_FIXTURE_START_CREDITS);
  const [prompt, setPrompt] = React.useState("");
  const [kind, setKind] = React.useState<CanvasMakeKind>("image");
  const [count, setCount] = React.useState(1);
  const [ratio, setRatio] = React.useState(FIXTURE_RATIO_OPTIONS[0]!);
  const [paramsOpen, setParamsOpen] = React.useState(false);
  /** 问卷在的时候:题到第几道、每道的答案、这一道选了什么、以及它挡着的那句话。 */
  const [quiz, setQuiz] = React.useState<{ index: number; answers: string[][]; selected: string[]; said: string } | null>(null);
  const promptRef = React.useRef<HTMLTextAreaElement>(null);

  const candidates = React.useMemo(() => creationMentionCandidates(archive), [archive]);
  const mentions = useMentionField({ candidates, text: prompt, setText: setPrompt, inputRef: promptRef });

  /** 报价与「做不做得起」只有这一处 —— 发送键、闸卡与真正扣的那个数读的是同一组参数。 */
  const quote = fixtureQuoteCredits(kind, count);
  /** 问卷在的时候参数一起锁住:卡上承诺的那个数,就是答完之后真的扣的那个数。 */
  const locked = quiz !== null;

  /**
   * 往线程里加一条。
   *
   * id 由**它落进去时排第几**决定,不读时钟:`Date.now()` 在渲染路径上是一个不纯的调用
   * (同一次渲染两次读到两个值),而这一串本来就只需要「彼此不同」。序号在函数式更新里
   * 取,所以同一拍里连推两条也不会撞号。
   */
  const push = React.useCallback((entry: CreationDraft) => {
    setEntries((current) => [...current, { ...entry, id: entry.id ?? `${entry.kind}-${current.length}` } as CreationEntry]);
  }, []);

  /**
   * 这一场创作在面板那张会话表里的样子。
   *
   * 归属写在消息的 payload 上(`ottoCanvas`),判断仍然只有 `otto-thread-state.ts` 一处 ——
   * 于是列表那一行行尾自己就长出「Open canvas」,这一面不必再去教它一遍。
   */
  const syncThread = React.useCallback((rows: CreationEntry[]) => {
    const said = rows.find((row) => row.kind === "said");
    if (!said || said.kind !== "said") return;
    const messages: ChatThreadDTO["messages"] = rows.map((row, index) => ({
      id: `${CREATION_THREAD_ID}-${index + 1}`,
      role: row.kind === "said" ? "USER" : "AGENT",
      kind: "TEXT",
      seq: index + 1,
      text: row.kind === "gate" ? "This one needs more credits than the balance has." : row.text,
      payload: index === 0 ? { ottoCanvas: { projectId: QUICK_CREATE_PROJECT_ID, projectName: "Quick create" } } : null,
      genJobId: null,
      createdAt: CREATION_FIXTURE_NOW,
    }));
    upsertOttoFixtureThread(workspaceId, {
      id: CREATION_THREAD_ID,
      projectId: QUICK_CREATE_PROJECT_ID,
      title: said.text.length > 42 ? `${said.text.slice(0, 39)}…` : said.text,
      updatedAt: CREATION_FIXTURE_NOW,
      pinnedAt: null,
      status: rows.some((row) => row.kind === "landed") ? "done" : "working",
      messages,
    });
  }, [workspaceId]);

  React.useEffect(() => {
    if (entries.length) syncThread(entries);
  }, [entries, syncThread]);

  /* ── 一次生成 ─────────────────────────────────────────────────────────────── */

  /**
   * 排上了的那一次。它是**状态**,不是一个挂在 ref 上的定时器 —— 于是「这一次跑到哪了」
   * 与「屏幕上画什么」读的是同一份事实,组件被关掉时那一拍也跟着 effect 一起收走,
   * 不会落在一个已经不在的组件上。
   */
  const [pending, setPending] = React.useState<
    | { runId: string; text: string; kind: CanvasMakeKind; count: number; credits: number }
    | null
  >(null);
  const running = pending !== null;

  /**
   * `options.balance` = 「按这个余额算,不按 state 里那个」。
   *
   * 闸卡主键那一下必须给:`setBalance` 要下一帧才生效,而充值与接着跑发生在同一拍里 ——
   * 读 state 就读成了充值**之前**那个数,于是刚充完值立刻又撞一次闸。商家看到的是按了
   * 「Top up and continue」之后又冒出一张一模一样的闸卡。
   */
  function run(text: string, options: { kind?: CanvasMakeKind; count?: number; balance?: number } = {}) {
    if (running) return;
    const runKind = options.kind ?? kind;
    const runCount = options.count ?? count;
    const credits = fixtureQuoteCredits(runKind, runCount);
    if (!creationCanAfford(options.balance ?? balance, credits)) {
      // 闸长在线程里,不弹一层全局窗:商家此刻的上下文就是他刚说的那句话。
      push({ kind: "gate", needed: credits });
      return;
    }
    setBalance((current) => current - credits);
    push({ kind: "prose", text: "On it. Nothing is charged until it lands." });
    setPending({ runId: String(entries.length), text, kind: runKind, count: runCount, credits });
  }

  React.useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      const assets = Array.from({ length: pending.count }, (_, index) => quickCreateAsset({
        runId: `full-${pending.runId}`,
        index,
        prompt: pending.text,
        kind: pending.kind,
        duration: `${FIXTURE_VIDEO_CONCEPT_SECONDS}s`,
        createdAt: CREATION_FIXTURE_NOW,
      }));
      const filed = onFile(assets);
      setMade((current) => [...current, ...assets]);
      // 同一批也送进那块画布的会话里 —— 于是「Open in Canvas」点过去看到的是一块**有东西**
      // 的板,不是一块空板。
      appendCanvasFixtureHandoff({
        projectId: QUICK_CREATE_PROJECT_ID,
        prompt: pending.text,
        batch: {
          id: `creation-${pending.runId}`,
          kind: pending.kind,
          ratio,
          credits: pending.credits,
          madeFrom: null,
          references: [],
          home: fixtureBatchHome(1),
          art: assets.map((asset) => ({ id: asset.id, label: asset.name, src: asset.poster, alt: asset.name })),
        },
      });
      push({
        kind: "landed",
        text: filed
          ? `${assets.length === 1 ? "One" : assets.length} on the left, and in your Library.`
          : `${assets.length === 1 ? "One" : assets.length} on the left. There was no room left to keep a copy in your Library.`,
        // 诚实偏离:视频这一支今天做得出的只有一帧静止的概念图。说清哪件事没做成、
        // 以及改做了什么 —— 一句,贴在产物旁边。
        deviation: pending.kind === "video"
          ? honestDeviationLine("A video you can play", "made a still frame from it")
          : undefined,
        assetIds: assets.map((asset) => asset.id),
        credits: pending.credits,
      });
      setPending(null);
    }, CREATION_RUN_MS);
    return () => window.clearTimeout(timer);
  }, [onFile, pending, push, ratio]);

  /* ── 发送 ─────────────────────────────────────────────────────────────────── */

  function send() {
    const text = prompt.trim();
    if (!text || running || quiz) return;
    const refs = mentions.sent(text).map((row) => row.name);
    push({ kind: "said", text, refs });
    setPrompt("");
    mentions.reset();
    // 太含糊就先问两句 —— 问的时候一分钱不动,而且参数一起锁住(所见即所付)。
    if (isVagueCreationRequest(text) || text.split(/\s+/).filter(Boolean).length < 4) {
      setParamsOpen(false);
      setQuiz({ index: 0, answers: [], selected: [], said: text });
      return;
    }
    run(text);
  }

  function nextQuestion() {
    if (!quiz || !quiz.selected.length) return;
    const answers = [...quiz.answers, quiz.selected];
    if (quiz.index < CREATION_QUESTIONS.length - 1) {
      setQuiz({ ...quiz, index: quiz.index + 1, selected: [], answers });
      return;
    }
    finishQuiz(answers);
  }

  function skipQuestion() {
    if (!quiz) return;
    const answers = [...quiz.answers, []];
    if (quiz.index < CREATION_QUESTIONS.length - 1) {
      setQuiz({ ...quiz, index: quiz.index + 1, selected: [], answers });
      return;
    }
    finishQuiz(answers);
  }

  function previousQuestion() {
    if (!quiz || quiz.index === 0) return;
    const answers = quiz.answers.slice(0, -1);
    setQuiz({ ...quiz, index: quiz.index - 1, selected: quiz.answers[quiz.index - 1] ?? [], answers });
  }

  function finishQuiz(answers: string[][]) {
    if (!quiz) return;
    const picked = answers.flat();
    const said = picked.length ? `${quiz.said} — ${picked.join(", ")}` : quiz.said;
    setQuiz(null);
    run(said);
  }

  /* ── 答尾动作卡:每一张点了都真做 ─────────────────────────────────────────── */

  function actionsFor(entry: Extract<CreationEntry, { kind: "landed" }>): ConversationAction[] {
    const out: ConversationAction[] = [];
    if (!entry.assetIds.some((id) => made.find((asset) => asset.id === id)?.kind === "video")) {
      out.push({
        id: "matching-video",
        label: "Make a matching video",
        note: `${FIXTURE_VIDEO_CONCEPT_CREDITS} cr`,
        icon: Video,
        onRun: () => {
          const said = entries.find((row) => row.kind === "said");
          run(said && said.kind === "said" ? said.text : CREATION_GREETING, { kind: "video", count: 1 });
        },
      });
    }
    out.push({
      id: "star-these",
      label: "Keep these in Starred",
      note: "They stay one click away in your Library",
      icon: Star,
      onRun: () => {
        const landed = onStar(entry.assetIds);
        push({
          kind: "prose",
          id: `starred-${entry.id}`,
          text: landed
            ? "Starred. They are at the top of your Library now."
            : "There was no room left in this preview, so nothing changed.",
        });
      },
    });
    return out;
  }

  /* ── 画 ───────────────────────────────────────────────────────────────────── */

  const canvasPath = libraryCanvasHref(QUICK_CREATE_PROJECT_ID, fixture);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        unstyled
        className="r22-creation-full"
        data-r22-creation-full
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          promptRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Make something with Otto</DialogTitle>

        {/* 左:这一场做出来的东西。它同时已经在 Library 里 —— 这一栏不是一个待保存的暂存区。 */}
        <section className="r22-creation-art" data-r22-creation-art aria-label="What you made here">
          {made.length ? (
            <div className="r22-creation-art-grid">
              {made.map((asset) => (
                <figure key={asset.id} data-r22-creation-asset={asset.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- 样张缩略图,与 Library 卡用同一张本地文件。 */}
                  <img src={asset.poster} alt="" />
                  <figcaption>{asset.name}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="r22-creation-art-empty">Everything you make here shows up on this side.</p>
          )}
          {made.length ? (
            <Link className="r22-creation-open-canvas" data-r22-creation-open-canvas href={canvasPath} onClick={() => onOpenChange(false)}>
              Open in Canvas
            </Link>
          ) : null}
        </section>

        {/* 右:线程。composer 永远钉在这一栏的底部(底册 §1)。 */}
        <section className="r22-creation-thread" data-r22-creation-thread aria-label="Conversation">
          <div className="r22-creation-log">
            <h2 className="r22-creation-greeting">{CREATION_GREETING}</h2>
            {entries.map((entry) => {
              if (entry.kind === "said") {
                return (
                  <MessageBubble from="me" key={entry.id} data-r22-creation-said={entry.id}>
                    {entry.text}
                    {entry.refs.length ? <small className="r22-creation-refs" data-r22-creation-refs={entry.refs.join(", ")}>{entry.refs.join(" · ")}</small> : null}
                  </MessageBubble>
                );
              }
              if (entry.kind === "prose") {
                return <AssistantProse key={entry.id}>{entry.text}</AssistantProse>;
              }
              if (entry.kind === "gate") {
                return (
                  <GateCard
                    key={entry.id}
                    title="This one needs more credits"
                    detail="Add credits and I will pick up exactly where we stopped. Nothing has been charged."
                    balanceLabel={creationBalanceLine(balance, entry.needed)}
                    primaryLabel="Top up and continue"
                    onPrimary={() => {
                      setBalance((current) => current + CREATION_FIXTURE_TOPUP_CREDITS);
                      setEntries((current) => current.filter((row) => row.id !== entry.id));
                      push({ kind: "prose", id: `topup-${entry.id}`, text: CREATION_TOPUP_NOTICE });
                      const said = [...entries].reverse().find((row) => row.kind === "said");
                      if (said && said.kind === "said") run(said.text, { balance: balance + CREATION_FIXTURE_TOPUP_CREDITS });
                    }}
                    secondaryLabel="Not now"
                    onSecondary={() => setEntries((current) => current.filter((row) => row.id !== entry.id))}
                  />
                );
              }
              return (
                <div key={entry.id} className="r22-creation-landed" data-r22-creation-landed={entry.id}>
                  <AssistantProse>{entry.text}</AssistantProse>
                  {entry.deviation ? <AssistantProse className="r22-creation-deviation" data-r22-creation-deviation="">{entry.deviation}</AssistantProse> : null}
                  <WorkedLine seconds={CREATION_WORKED_SECONDS} steps={["Read your brief", "Made this batch", "Filed it in your Library"]} />
                  <ActionCards actions={actionsFor(entry)} />
                </div>
              );
            })}
            {quiz ? (
              <QuestionnaireCard
                idPrefix="r22-creation-quiz"
                questions={CREATION_QUESTIONS}
                index={quiz.index}
                selected={quiz.selected}
                onSelectedChange={(next) => setQuiz((current) => (current ? { ...current, selected: next } : current))}
                onPrevious={previousQuestion}
                onSkip={skipQuestion}
                onNext={nextQuestion}
                footNote={`Answering costs nothing · ${quote} cr when it runs`}
              />
            ) : null}
            {running ? <AssistantProse>Still the same request — nothing new was started.</AssistantProse> : null}
          </div>

          {/* 起手模板与画布空态、Library 快产车间是同一个组件、同一批句子。 */}
          {entries.length ? null : <CreationTemplateRow locked={locked} onPick={(template) => { setPrompt(template.prompt); promptRef.current?.focus(); }} />}

          <form
            className="r22-creation-composer"
            data-r22-creation-composer
            onSubmit={(event) => { event.preventDefault(); send(); }}
          >
            <MentionPicker field={mentions}>
              <div className="r22-creation-composer-box">
                <div className="r22-canvas-composer-chips" data-r22-creation-chips>
                  <MentionChips field={mentions} />
                </div>
                <Textarea
                  unstyled
                  ref={promptRef}
                  rows={1}
                  value={prompt}
                  aria-label="Describe what to make"
                  placeholder="Describe what to make — @ adds references"
                  onChange={(event) => { setPrompt(event.target.value); mentions.sync(event.target.value, event.target.selectionStart); }}
                  onKeyDown={(event) => {
                    if (mentions.onKeyDown(event)) return;
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />
              </div>
            </MentionPicker>
            <div className="r22-creation-composer-row">
              <ToggleGroup
                unstyled
                className="r22-creation-kind"
                type="single"
                value={kind}
                aria-label="What to make"
                onValueChange={(value) => { if (value && !locked) setKind(value as CanvasMakeKind); }}
              >
                <ToggleGroupItem unstyled value="image" disabled={locked} data-r22-creation-kind="image"><ImageIcon aria-hidden />Image</ToggleGroupItem>
                <ToggleGroupItem unstyled value="video" disabled={locked} data-r22-creation-kind="video"><Video aria-hidden />Video</ToggleGroupItem>
              </ToggleGroup>
              <span className="r22-creation-gap" />
              <Popover open={paramsOpen && !locked} onOpenChange={setParamsOpen}>
                <PopoverTrigger asChild>
                  <Button unstyled type="button" className="r22-creation-shape" disabled={locked}>{count > 1 ? `${ratio} · ${count}` : ratio}</Button>
                </PopoverTrigger>
                <PopoverContent className="r22-creation-params" align="end" side="top" sideOffset={8} data-r22-creation-params>
                  <ToggleGroup unstyled className="r22-creation-shapes" type="single" value={ratio} aria-label="Shape" onValueChange={(value) => { if (value) setRatio(value); }}>
                    {FIXTURE_RATIO_OPTIONS.map((value) => (
                      <ToggleGroupItem unstyled key={value} value={value} data-r22-creation-ratio={value}>
                        <i style={{ aspectRatio: value.replace(":", " / ") }} aria-hidden="true" />
                        <span>{value}</span>
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <ToggleGroup unstyled className="r22-creation-counts" type="single" value={String(count)} aria-label="How many" onValueChange={(value) => { if (value) setCount(Number(value)); }}>
                    {Array.from({ length: CANVAS_IMAGE_MAX_VARIANT_COUNT }, (_, index) => index + 1).map((value) => (
                      <ToggleGroupItem unstyled key={value} value={String(value)} data-r22-creation-count={value}>{value}</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </PopoverContent>
              </Popover>
              <span className="r22-creation-price" data-r22-creation-price>{quote} cr</span>
              <span className="r22-creation-balance" data-r22-creation-balance>{balance} cr left</span>
              <Button unstyled type="submit" className="r22-creation-send" aria-label="Send" disabled={running || locked || !prompt.trim()}>
                <ArrowUp aria-hidden="true" />
              </Button>
            </div>
          </form>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export default CreationConversation;
