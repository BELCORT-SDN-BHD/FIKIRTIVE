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
import { Check, ChevronDown, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Kbd } from "@/components/ui/kbd";
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
 * 单选走 `RadioGroup` 而不是一排按钮各自贴一个单选 role:方向键循环、焦点跟随、Tab 只占
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

/* ── 问卷卡(Founder 2026-08-26 指定的 shadcn questionnaire 形)──────────────── */

/**
 * 一道题。`multi` = 可以多选;不写就是「挑一个」。
 *
 * 它与 `AskOption` 分开是有意的:`AskOption` 说的是**一个选项**长什么样,这一份说的是
 * **一道题**长什么样。一串题就是一份问卷 —— 全站每一处「Otto 问我几件事」从此都是它,
 * 画布的 pendingQuestion、Create 追问、研究链的中途澄清共用同一份键盘与同一副长相。
 */
export type QuestionnaireQuestion = {
  id: string;
  question: string;
  /** 题面下那一句灰说明。多选时若不写,自动补上「可以多选,也可以跳过」那一句。 */
  help?: string;
  multi?: boolean;
  options: readonly AskOption[];
};

/** 多选题的默认说明句 —— Founder 给的参考截图上就是这一句。 */
export const QUESTIONNAIRE_MULTI_HELP = "Select all that apply, or skip this question.";

/** 第 n 个选项的字母角标。A/B/C/D…… 与真正生效的按键同出这一处。 */
export function questionnaireLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 「Question 2 of 3」那一行。题号从 1 起数 —— 商家不数 0。 */
export function questionnaireCountLabel(index: number, total: number): string {
  return `Question ${index + 1} of ${total}`;
}

/**
 * 一份问卷,一次一道题。
 *
 * 形状逐条照 Founder 给的那张 shadcn 参考截图:左上灰字题号、加粗题面配一句灰说明、
 * 整行卡的选项、每行右端一枚小圆字母角标、脚排左 Previous / 右 Skip + Next。
 *
 * **字母角标不是装饰**:它印在屏幕上的那个字母,就是键盘上真的选得中这一行的那个键
 * (`questionnaireLetter` 是唯一出处)。印一个按不动的字母,比不印更糟。
 *
 * Esc 不在这里吃:问卷可能长在弹层、面板或板上,那一记归它所在的那一层
 * (壳层与画布守的是同一条链)。这里只吃字母与 Enter,而且只在焦点不在输入框里时吃 ——
 * 商家在「Something else…」里打字打到一个 c,不该顺手把选项换掉。
 */
export function QuestionnaireCard({
  idPrefix,
  questions,
  index,
  selected,
  onSelectedChange,
  onPrevious,
  onSkip,
  onNext,
  nextLabel,
  kicker,
  footNote,
  children,
  busy = false,
  className,
  aliases,
}: {
  idPrefix: string;
  questions: readonly QuestionnaireQuestion[];
  /** 现在问到第几道(0 起)。 */
  index: number;
  /** 这一道已经选中的那几个 label(单选也是一个数组 —— 两种题共用一份状态)。 */
  selected: readonly string[];
  onSelectedChange: (next: string[]) => void;
  /** 回上一题。第一道题上不画这颗。 */
  onPrevious?: () => void;
  /** 跳过这一道。不给就没有跳过这条路(问的是非答不可的事时)。 */
  onSkip?: () => void;
  onNext: () => void;
  /** 主键上的字。不写就是 Next,最后一道自动变 Finish。 */
  nextLabel?: string;
  kicker?: React.ReactNode;
  footNote?: React.ReactNode;
  /** 题面与脚排之间还要塞的东西(例如「Something else…」那一格)。 */
  children?: React.ReactNode;
  busy?: boolean;
  className?: string;
  /** 调用点自己那套 DOM 钩子(既有验收按它们找元素)。零件的 `data-otto-quiz-*` 永远在。 */
  aliases?: { card?: string; option?: string; skip?: string; submit?: string };
}) {
  const question = questions[index];
  const titleId = `${idPrefix}-question`;
  const last = index === questions.length - 1;

  const toggle = React.useCallback((label: string) => {
    if (!question) return;
    if (question.multi) {
      onSelectedChange(selected.includes(label) ? selected.filter((item) => item !== label) : [...selected, label]);
    } else {
      onSelectedChange([label]);
    }
  }, [onSelectedChange, question, selected]);

  if (!question) return null;

  const help = question.help ?? (question.multi ? QUESTIONNAIRE_MULTI_HELP : undefined);

  /** 字母键与 Enter。焦点在输入框里时一概不吃 —— 那时按键是在打字。 */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    const typing = tag === "input" || tag === "textarea" || target?.isContentEditable;
    if (typing) return;
    if (event.key === "Enter") {
      if (busy) return;
      event.preventDefault();
      onNext();
      return;
    }
    if (event.key.length !== 1) return;
    const letter = event.key.toUpperCase();
    const at = letter.charCodeAt(0) - 65;
    if (at < 0 || at >= question.options.length) return;
    event.preventDefault();
    toggle(question.options[at]!.label);
  }

  const rows = question.options.map((option, at) => {
    const letter = questionnaireLetter(at);
    const chosen = selected.includes(option.label);
    const id = `${idPrefix}-${question.id}-${at}`;
    return (
      <label key={option.label} htmlFor={id} className={chosen ? "is-selected" : ""}>
        {question.multi ? (
          <Checkbox
            unstyled
            id={id}
            checked={chosen}
            data-otto-quiz-option={option.label}
            {...(aliases?.option ? { [aliases.option]: option.label } : {})}
            onCheckedChange={() => toggle(option.label)}
          />
        ) : (
          <RadioGroupItem
            unstyled
            id={id}
            value={option.label}
            data-otto-quiz-option={option.label}
            {...(aliases?.option ? { [aliases.option]: option.label } : {})}
          />
        )}
        <span>
          <b>{option.label}{option.recommended ? <em>Recommended</em> : null}</b>
          {option.description ? <small>{option.description}</small> : null}
        </span>
        <Kbd className="r22-quiz-key" data-otto-quiz-key={letter}>{letter}</Kbd>
      </label>
    );
  });

  return (
    <Card
      data-otto-quiz-card=""
      data-otto-quiz-index={String(index)}
      {...(aliases?.card ? { [aliases.card]: "" } : {})}
      role="region"
      aria-labelledby={titleId}
      className={`r22-convo-card r22-convo-quiz${className ? ` ${className}` : ""}`}
      onKeyDown={onKeyDown}
    >
      <div className="r22-quiz-count" data-otto-quiz-count="">
        {kicker ? <span>{kicker}</span> : null}
        {questionnaireCountLabel(index, questions.length)}
      </div>
      <h3 id={titleId}>{question.question}</h3>
      {help ? <p className="r22-quiz-help">{help}</p> : null}
      {question.multi ? (
        <div className="r22-quiz-options" data-otto-quiz-options="multi">{rows}</div>
      ) : (
        <RadioGroup
          unstyled
          className="r22-quiz-options"
          data-otto-quiz-options="single"
          aria-labelledby={titleId}
          value={selected[0] ?? ""}
          onValueChange={(value) => onSelectedChange([value])}
        >
          {rows}
        </RadioGroup>
      )}
      {children}
      <footer className="r22-quiz-acts">
        {onPrevious && index > 0 ? (
          <Button unstyled type="button" data-otto-quiz-previous="" disabled={busy} onClick={onPrevious}>Previous</Button>
        ) : null}
        {footNote ? <span className="r22-quiz-note">{footNote}</span> : null}
        <span className="r22-quiz-gap" />
        {onSkip ? (
          <Button unstyled type="button" data-otto-quiz-skip="" {...(aliases?.skip ? { [aliases.skip]: "" } : {})} disabled={busy} onClick={onSkip}>Skip</Button>
        ) : null}
        <Button
          unstyled
          type="button"
          className="is-primary"
          data-otto-quiz-next=""
          {...(aliases?.submit ? { [aliases.submit]: "" } : {})}
          disabled={busy || !selected.length}
          onClick={onNext}
        >
          {nextLabel ?? (last ? "Finish" : "Next")}
        </Button>
      </footer>
    </Card>
  );
}

/* ── 答尾动作卡(Cofounder 语法①)──────────────────────────────────────────── */

/**
 * 答完之后那一列**能点着开工**的下一步。
 *
 * 它与 `FollowupChips` 分工写死,两者并存不合并:
 *   · chips = **续话建议** —— 点一下把这句话填进输入框,发送仍然由商家自己按,一分钱不动;
 *   · 动作卡 = **直接开工** —— 点一下真的做了那件事(跳过去、存进去、开始跑)。
 *
 * 所以卡上带价钱,chips 上永远不带:带价钱的东西必须点了就真的发生,否则那个数字是句谎。
 * 零死卡 —— 每一张的 `onRun` 都必须真的做成一件事,做不成的那一张不该出现在这一列里。
 */
export type ConversationAction = {
  id: string;
  label: string;
  /** 一句安静的副文(去处、代价、结果)。 */
  note?: string;
  icon?: LucideIcon;
  onRun: () => void;
};

export function ActionCards({
  actions,
  label = "Next steps",
  className,
}: {
  actions: readonly ConversationAction[];
  label?: string;
  className?: string;
}) {
  if (!actions.length) return null;
  return (
    <div data-otto-action-cards="" className={`r22-convo-actions${className ? ` ${className}` : ""}`} role="group" aria-label={label}>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Button unstyled type="button" key={action.id} data-otto-action-card={action.id} className="r22-convo-action" onClick={action.onRun}>
            {Icon ? <Icon aria-hidden className="r22-convo-action-icon" /> : null}
            <span>
              <b>{action.label}</b>
              {action.note ? <small>{action.note}</small> : null}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

/* ── 闸卡(Cofounder 语法⑤)────────────────────────────────────────────────── */

/**
 * 钱不够(或权限不够)的那一刻,**在线程里**解决。
 *
 * Cofounder 那张卡的判断很对:闸口出现在商家正在做的这件事旁边,而不是弹一层全局窗把他
 * 从现场拽走。他此刻的上下文就是「我刚让你再做四张」——余额行、主键、次键都长在那句话下面,
 * 按完就接着做,不用回来找自己刚才说到哪。
 *
 * 余额行永远在:闸卡最该回答的问题是「还差多少」,不是「你不能做」。
 */
export function GateCard({
  title,
  detail,
  balanceLabel,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  busy = false,
  className,
}: {
  title: string;
  detail: string;
  /** 「12 cr left · this batch needs 18 cr」那一行。 */
  balanceLabel: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  busy?: boolean;
  className?: string;
}) {
  return (
    <Card data-otto-gate-card="" role="group" aria-label={title} className={`r22-convo-card r22-convo-gate${className ? ` ${className}` : ""}`}>
      <div className="r22-convo-card-head"><b>{title}</b></div>
      <p>{detail}</p>
      <small data-otto-gate-balance="">{balanceLabel}</small>
      <footer className="r22-convo-ask-acts">
        {onSecondary && secondaryLabel ? (
          <Button unstyled type="button" data-otto-gate-secondary="" disabled={busy} onClick={onSecondary}>{secondaryLabel}</Button>
        ) : null}
        <Button unstyled type="button" className="is-primary" data-otto-gate-primary="" disabled={busy} onClick={onPrimary}>{primaryLabel}</Button>
      </footer>
    </Card>
  );
}
