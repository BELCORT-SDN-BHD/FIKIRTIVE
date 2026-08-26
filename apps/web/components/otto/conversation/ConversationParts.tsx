"use client";

/**
 * ConversationParts.tsx —— 全站对话语言的**共用零件**。
 *
 * Founder 2026-08-26 裁决第 2 条:creation 对话(Create 弹窗 → 画布)与非画布的 Otto 对话
 * 是**分开的线程**,但**同一套对话组件语言** —— 气泡、输入条、卡片是同一个形状。
 *
 * 所以这里不做一个包办三处版式的巨型组件(三处的版式本来就不同:弹窗是一层、画布是浮在
 * 板上的一格、面板是一根竖条)。这里做的是**零件**:一枚状态芯片、一张选项卡、一张进度卡、
 * 一张等你卡、一行工时、一排后续问题。三处各自摆版式,摆的是同一批零件 —— 于是「Otto 在
 * 等我」这句话在三处长得一样,而不是三份各自演进的近似品。
 *
 * 取形(底册 §6,逐条):
 *   · ProgressCard —— Copilot 侧栏:一句应承 + 当前这一步 + 大概还要多久;
 *   · WaitingCard  —— WRITER「Waiting for your input」那张**实体卡**,不是一行灰字;
 *   · AskOptionCard—— Klarna 的选项 chips,**可以跳过**;
 *   · WorkedLine   —— Linear「Worked for N seconds」那一行,点开看做了什么;
 *   · FollowupChips—— Jasper 答尾那一排后续问题;
 *   · ThreadStatusPill —— Relevance 的状态芯片,人话不是状态机名字。
 *
 * 正典件全部来自仓库的 shadcn 基座(Badge / Spinner / Progress / RadioGroup / Card /
 * Collapsible / Button),这一份里没有一件手搓的语义。
 */

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";

import { OTTO_THREAD_STATE_LABEL, type OttoThreadState } from "./otto-thread-state";
import "./r22-conversation.css";

/* ── 状态芯片 ───────────────────────────────────────────────────────────────── */

/**
 * 一条线程此刻在哪一态。
 *
 * 「进行中」画的是一枚小转圈,不是一个静止的词 —— 商家扫一眼列表要能立刻分出「它自己在跑」
 * 与「它停在那里等我」。`idle` 不画:没有状态可说的时候摆一枚灰芯片,只是给每一行加一句
 * 废话。
 */
export function ThreadStatusPill({ state, className }: { state: OttoThreadState; className?: string }) {
  if (state === "idle") return null;
  const label = OTTO_THREAD_STATE_LABEL[state];
  if (state === "working") {
    return (
      <Badge variant="info" data-otto-thread-state="working" className={className}>
        <Spinner className="size-3" aria-hidden />
        {label}
      </Badge>
    );
  }
  const variant = state === "needs-you" ? "warning" : state === "failed" ? "destructive" : "outline";
  return (
    <Badge variant={variant} data-otto-thread-state={state} className={className}>
      {state === "done" ? <i className="r22-convo-done-dot" aria-hidden /> : null}
      {label}
    </Badge>
  );
}

/* ── 气泡与散文 ─────────────────────────────────────────────────────────────── */

/**
 * 一句话在对话里的样子。三处的气泡从此是同一个形状 —— 上一版画布用的是 `<li>` 加两个
 * class,面板用的是 shadcn 的 Bubble,同一句话在两处宽窄圆角都不一样。
 *
 * 它**不**接管滚动与虚拟化:面板那一面外面裹着 `MessageScroller`(shadcn 的),画布那一面
 * 是一条短列表。零件只管一句话长什么样。
 */
export function MessageBubble({
  from,
  children,
  className,
  ...rest
}: { from: "me" | "otto"; children: React.ReactNode; className?: string } & Omit<React.ComponentProps<"div">, "children">) {
  return (
    <div
      data-otto-bubble={from}
      className={`r22-convo-bubble is-${from}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Otto 的一段话。散文就是散文 —— 卡片留给「有待办的东西」,不是每句话都装进框里。 */
export function AssistantProse({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p data-otto-prose="" className={`r22-convo-prose${className ? ` ${className}` : ""}`}>{children}</p>;
}

/* ── 进度卡(Copilot 形)────────────────────────────────────────────────────── */

/**
 * 「我在做,做到这一步了,大概还要这么久」。
 *
 * 三件事缺一不可:**哪一步**(不是一句永恒的 "Working…")、**还剩几步**、**可以走开**。
 * 第三件是 Copilot 那一栏真正的贡献 —— 它把「等」从一件必须盯着的事变成一件可以放下的事。
 */
export function ProgressCard({
  title,
  steps,
  current,
  note,
  className,
}: {
  title: string;
  steps: readonly string[];
  /** 正在做第几步(0 起)。已经走过的画勾,当前那一步画转圈,后面的安静灰。 */
  current: number;
  /** 「你可以先去忙」那一句 —— 由调用点给,因为三处的措辞语境不同。 */
  note?: string;
  className?: string;
}) {
  const done = Math.min(current, steps.length);
  const percent = Math.round(((done + 1) / steps.length) * 100);
  return (
    <Card
      data-otto-progress-card=""
      data-otto-progress-step={String(current)}
      role="status"
      aria-live="polite"
      className={`r22-convo-card r22-convo-progress${className ? ` ${className}` : ""}`}
    >
      <div className="r22-convo-card-head">
        <Spinner className="size-3.5" aria-hidden />
        <b>{title}</b>
      </div>
      <Progress className="r22-convo-progress-bar" value={percent} aria-label={title} />
      <ul className="r22-convo-steps">
        {steps.map((step, index) => (
          <li key={step} data-done={index < current ? "" : undefined} data-current={index === current ? "" : undefined}>
            <span aria-hidden>{index < current ? <Check /> : index === current ? <Spinner className="size-3" /> : null}</span>
            {step}
          </li>
        ))}
      </ul>
      {note ? <small>{note}</small> : null}
    </Card>
  );
}

/* ── 等你卡(WRITER 形)─────────────────────────────────────────────────────── */

/**
 * 「轮到你了」——一张**实体卡**,不是一行灰字。
 *
 * WRITER 那张卡的判断很对:等人的那一刻是整条线程最需要被看见的一刻,它值一张有边框、
 * 有标题、有动作的卡。做成一行淡字,商家会滚过去。
 */
export function WaitingCard({
  title,
  detail,
  children,
  className,
}: {
  title: string;
  detail?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card data-otto-waiting-card="" className={`r22-convo-card r22-convo-waiting${className ? ` ${className}` : ""}`}>
      <div className="r22-convo-card-head">
        <ThreadStatusPill state="needs-you" />
        <b>{title}</b>
      </div>
      {detail ? <p>{detail}</p> : null}
      {children}
    </Card>
  );
}

/* ── 选项卡(Klarna 形)─────────────────────────────────────────────────────── */

export type AskOption = { label: string; description?: string; recommended?: boolean };

/**
 * 一组「挑一个」的选项 —— 三处问答卡共用的**那一份**(裁决第 2/4 条)。
 *
 * 它只画选项本身,不画卡的外壳:画布那张卡浮在板上、Create 弹窗那张住在对话框里、线程里
 * 那张长在气泡里,三处的外壳本来就不同。真正必须同一份的是**选项长什么样、怎么用键盘走**
 * —— 那正是上一版在三个文件里各抄了一遍的东西。
 *
 * `optionAttr` 是调用点自己那套 DOM 钩子(既有验收按它们找元素)。零件自己的
 * `data-otto-ask-option` 永远在,两者并存不冲突。
 */
export function AskOptions({
  idPrefix,
  label,
  labelledBy,
  options,
  value,
  onValueChange,
  optionAttr,
  className,
}: {
  idPrefix: string;
  label?: string;
  labelledBy?: string;
  options: readonly AskOption[];
  value: string;
  onValueChange: (value: string) => void;
  optionAttr?: string;
  className?: string;
}) {
  return (
    <RadioGroup
      unstyled
      className={className ?? "r22-convo-ask-options"}
      {...(labelledBy ? { "aria-labelledby": labelledBy } : { "aria-label": label })}
      value={value}
      onValueChange={onValueChange}
    >
      {options.map((option) => (
        <label className={value === option.label ? "is-selected" : ""} key={option.label} htmlFor={`${idPrefix}-${option.label}`}>
          <RadioGroupItem
            unstyled
            id={`${idPrefix}-${option.label}`}
            value={option.label}
            data-otto-ask-option={option.label}
            {...(optionAttr ? { [optionAttr]: option.label } : {})}
          />
          <span>
            <b>{option.label}{option.recommended ? <em>Recommended</em> : null}</b>
            {option.description ? <small>{option.description}</small> : null}
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}

/**
 * 线程里的一问一答:一组**真**单选,外加一颗跳过。
 *
 * 「可以跳过」是 Klarna 那一组 chips 的关键,也是这里最容易被做丢的一件:问题问出来,
 * 商家答不上来或者不在乎,他必须有一条不回答也能往下走的路 —— 否则问一句就等于把人卡住。
 *
 * 单选走 `RadioGroup` 而不是一排按钮加 `role="radio"`:方向键循环、焦点跟随、Tab 只占
 * 一站那一整套由 Radix 出。写第二遍不是错,是**第二份**,而两份键盘行为迟早分家。
 */
export function AskOptionCard({
  idPrefix,
  kicker,
  question,
  help,
  options,
  value,
  onValueChange,
  onSubmit,
  onSkip,
  submitLabel = "Continue",
  skipLabel = "Skip",
  footNote,
  busy = false,
  className,
  aliases,
}: {
  idPrefix: string;
  kicker?: React.ReactNode;
  question: string;
  help?: string;
  options: readonly AskOption[];
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onSkip?: () => void;
  submitLabel?: string;
  skipLabel?: string;
  footNote?: React.ReactNode;
  busy?: boolean;
  className?: string;
  /** 调用点自己那套 DOM 钩子(既有验收按它们找元素)。零件的 `data-otto-ask-*` 永远在。 */
  aliases?: { card?: string; option?: string; skip?: string; submit?: string };
}) {
  const titleId = `${idPrefix}-question`;
  return (
    <Card
      data-otto-ask-card=""
      {...(aliases?.card ? { [aliases.card]: "" } : {})}
      role="region"
      aria-labelledby={titleId}
      className={`r22-convo-card r22-convo-ask${className ? ` ${className}` : ""}`}
    >
      {kicker ? <div className="r22-convo-ask-kicker">{kicker}</div> : null}
      <h3 id={titleId}>{question}</h3>
      {help ? <p>{help}</p> : null}
      <AskOptions idPrefix={idPrefix} labelledBy={titleId} options={options} value={value} onValueChange={onValueChange} optionAttr={aliases?.option} />
      <footer className="r22-convo-ask-acts">
        {footNote ? <span className="r22-convo-ask-note">{footNote}</span> : null}
        {onSkip ? (
          <Button unstyled type="button" data-otto-ask-skip="" {...(aliases?.skip ? { [aliases.skip]: "" } : {})} disabled={busy} onClick={onSkip}>
            {skipLabel}
          </Button>
        ) : null}
        <Button unstyled type="button" className="is-primary" data-otto-ask-submit="" {...(aliases?.submit ? { [aliases.submit]: "" } : {})} disabled={busy || !value} onClick={onSubmit}>
          {submitLabel}
        </Button>
      </footer>
    </Card>
  );
}

/* ── 工时行(Linear 形)─────────────────────────────────────────────────────── */

/**
 * 「Worked for 48 seconds」——点开看它到底做了什么。
 *
 * Linear 那一行的好处不是显摆工时,是**给了一条回溯路径**:事情做完之后,商家还能回去
 * 问一句「你刚才都干了什么」。收起来只占一行,不打扰。
 */
export function WorkedLine({
  seconds,
  steps,
  className,
}: {
  seconds: number;
  steps: readonly string[];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={`r22-convo-worked${className ? ` ${className}` : ""}`}>
      <CollapsibleTrigger asChild>
        <Button unstyled type="button" data-otto-worked-line="" className="r22-convo-worked-trigger">
          <Check className="size-3" aria-hidden />
          <span>Worked for {seconds} seconds</span>
          <ChevronDown className="size-3" aria-hidden />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol data-otto-worked-steps="" className="r22-convo-worked-steps">
          {steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ── 后续问题(Jasper 形)───────────────────────────────────────────────────── */

/**
 * 答完之后那一排「接下来可以问的」。
 *
 * 它不是装饰:商家读完一段回答最常卡住的地方是「那我现在该问什么」。三条真能问的话,
 * 比一句「还有什么可以帮你」有用得多。点一下是**替他打好这句话**,发送仍然由他自己按。
 */
export function FollowupChips({
  chips,
  onPick,
  label = "Ask next",
  className,
}: {
  chips: readonly string[];
  onPick: (chip: string) => void;
  label?: string;
  className?: string;
}) {
  if (!chips.length) return null;
  return (
    <div data-otto-followups="" className={`r22-convo-followups${className ? ` ${className}` : ""}`} aria-label={label}>
      {chips.map((chip) => (
        <Button unstyled type="button" key={chip} data-otto-followup={chip} onClick={() => onPick(chip)}>
          {chip}
        </Button>
      ))}
    </div>
  );
}
