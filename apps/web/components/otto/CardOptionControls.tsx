"use client";
/**
 * CardOptionControls —— 确认卡上那三格（张数／形状／精修），**一份**，两张卡共用。
 *
 * Founder 2026-09-05 裁决「加进确认卡」：⑦段把画布上那个直出 composer 退役之后，这三格
 * 在商家那一侧无处可选，而确认卡是今天唯一的花钱入口。所以它们长在卡上，**批准之前**
 * 可以改。
 *
 * 为什么是一个共用组件：同一张 GEN_CARD 今天有两处确认位（对话抽屉里的 `OttoPlanCard`、
 * 画布上始终可见的 `OttoTurnCard`）。两处各抄一份控件，就是把「改了什么、按什么价」
 * 复制成两份 —— 与参考回执（`CardReferenceReceipt`）同一条理由。
 *
 * 清单 A5（P2-013）之后这份文件还住着**同一张卡的另一半改法** —— 文末的 `CardChangeForm`
 * （「Change something」那张小表单）。两者同住一处是有意的：哪一格能就地改、哪一格只能
 * 让 Otto 重出一份计划，判据是同一份 `options`；分成两个文件，那份判据就会长出第二份。
 *
 * **这里一分钱都不算。** 菜单来自卡自己的 `options`（服务端唯一一次派生），改动交给
 * 服务端那个 $0 动作重铸整张卡，新的价随新卡回来。界面自己乘一个数当报价，就是第二处
 * 派生 —— 那正是「卡面说的」与「真正扣的」分家的来源（#580）。
 */
import React, { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ottoUpdateGenCardOptions } from "@/lib/otto-client-actions";
import type { OttoPlanCardPayload } from "./plan-card-contract";

/** 精修那一格旁边那句话 —— 它会改价，所以这件事必须写在开关旁边，而不是等按下去才知道。 */
export const FINE_DETAIL_NOTE = "Costs more — the price below updates.";

/** 规格条上那一格。与开关上那个名字**同一个常量** —— 两处各写一遍字面量，就是同一件事
 *  在界面上有两个名字。 */
export const FINE_DETAIL_CHIP = "Fine detail";

/**
 * 卡面规格条 —— 服务端那份 `specChips` 逐字在前，精修那一格补在末尾。
 *
 * 终检 r4：精修打开之后价从 1 变 2 credits，而规格条仍是「2048 × 2048 · 1:1 · 1 image」——
 * 商家看得见贵了，看不出贵在哪。服务端那份 `buildSpecChips`（`packages/core/src/spec-chips.ts`）
 * 不认识精修这一格，所以这一格由卡自己按**卡上那个已被服务端写定的 `fineDetail`** 派生：
 * 它不是界面自己发明的事实，也不参与算钱（价照旧只从 `estimatedCredits` 来）。
 *
 * 老卡（没有 specChips）照旧不显示规格条 —— 猜一份规格出来是 #580 那条禁令。
 */
export function cardSpecChips(payload: OttoPlanCardPayload): string[] {
  const chips = payload.specChips ?? [];
  if (chips.length === 0 || payload.fineDetail !== true) return chips;
  return [...chips, FINE_DETAIL_CHIP];
}

/** 商家在这三格里改的那一格。三格都可空 —— 一次交互只动一格。 */
type CardOptionEdit = { count?: number; aspectRatio?: string; fineDetail?: boolean };

export interface CardOptionControlsProps {
  threadId: string;
  cardId: string;
  /** 已过 `planCardGate` 的卡面 payload —— 菜单与当前值都从它读。 */
  payload: OttoPlanCardPayload;
  /** 卡忙着别的事（正在批准 / 已排队）时锁住这三格。 */
  disabled?: boolean;
  /** 服务端重铸完那张卡之后，把**新的 payload** 交回给卡：卡面的价、规格条目、
   *  按钮上那个数据此全部换新。改不动时交回一句给商家看的话。 */
  onChanged: (payload: unknown) => void;
}

const FAILED_NOTE = "That didn't go through — please try again.";

/** 这一趟被拒时，排在它后面那一格是被丢掉的 —— 商家点过它，所以必须听见这件事
 *  （#1241 判官 P2-2）。服务端那句原话在前，这一句跟在后面，绝不盖掉它。 */
export const QUEUED_DROPPED_NOTE = "Your other change was not sent either — try it again.";

export function CardOptionControls({ threadId, cardId, payload, disabled, onChanged }: CardOptionControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 重铸还没回来时,商家**已经点过**的那几格 —— 只管这三格自己怎么显示,不参与算钱。 */
  const [pending, setPending] = useState<CardOptionEdit | null>(null);
  /** 重铸进行中又点的那一格,排在这里等上一趟回来（后点的盖前点的同一格）。 */
  const queued = useRef<CardOptionEdit | null>(null);
  const running = useRef(false);
  const countId = useId();
  const shapeId = useId();

  const options = payload.options;
  // 显示值 = 已经点过的那一格优先,其余照卡上那一份。重铸回来之后 `pending` 清空,
  // 卡上那一份就是唯一的事实（服务端说了算,界面不留第二份）。
  const count = pending?.count ?? payload.params?.count ?? 1;
  const aspectRatio = pending?.aspectRatio ?? payload.params?.aspectRatio ?? "";
  const fineDetail = pending?.fineDetail ?? payload.fineDetail === true;

  /**
   * 改一格。
   *
   * 终检 r4：下拉改完**紧接着**点精修,那一次点击被吞（开关一动不动、价不变）。原因是
   * 上一趟重铸还在飞的时候这三格是 `disabled` 的 —— base-ui 的 Switch 在 disabled 下
   * 就是一颗 disabled 的按钮,那次点击连事件都没有,商家看到的是「点了没反应」。
   *
   * 修法：重铸进行中**不再锁控件**,而是把这一次改动排队（`queued`,后点的盖同一格),
   * 上一趟回来立刻接着发,并用 `aria-busy` 说明正在重铸。这三格从头到尾一分钱不算,
   * 所以排队不会让「卡面说的」与「真正扣的」分家：每一趟都是服务端重铸整张卡,价随
   * 新卡回来。
   */
  async function apply(edit: CardOptionEdit) {
    if (disabled) return;
    setPending((prev) => ({ ...(prev ?? {}), ...edit }));
    if (running.current) {
      queued.current = { ...(queued.current ?? {}), ...edit };
      return;
    }
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      let next: CardOptionEdit | null = edit;
      while (next) {
        const res = await ottoUpdateGenCardOptions({ threadId, cardId, ...next });
        if (!res || "error" in res) {
          // 服务端已经说清楚了 —— 原样交给商家,泛化句不许盖掉它。
          // 这一趟被拒,排在后面那一格就不再替他发了 —— 他没看到这句话之前,再改一格
          // 是我们替他做的决定。但**被丢掉这件事他得听见**(#1241 判官 P2-2):否则那一格
          // 会退回卡上原来的值,而屏幕上只有另一格的拒绝理由,像是白点了一下。
          const said = res ? res.error : FAILED_NOTE;
          setError(queued.current ? `${said} ${QUEUED_DROPPED_NOTE}` : said);
          break;
        }
        onChanged(res.payload);
        next = queued.current;
        queued.current = null;
      }
    } catch {
      setError(FAILED_NOTE);
    } finally {
      queued.current = null;
      running.current = false;
      setBusy(false);
      setPending(null);
    }
  }

  // 老卡(这条修改之前铸的)与视频卡没有这份菜单 —— 一格都不渲染,与从前逐字相同。
  if (!options) return null;
  const counts = Array.from({ length: Math.max(1, options.maxCount) }, (_, i) => i + 1);
  // 只有卡自己忙别的事(正在批准 / 已排队)才真的锁住这三格。**重铸进行中不锁** ——
  // 锁住的那半秒正是终检 r4 里那次被吞掉的点击,现在改成排队 + `aria-busy`。
  const locked = disabled === true;

  // 重铸在飞时**看得见**(#1241 判官 P2-1):从前只有 `aria-busy`,屏幕读者听得到、眼睛
  // 看不到 —— 三格照旧可点(排队),但商家得知道上一趟还没回来。只改透明度,不锁控件、
  // 不改行为(`aria-busy:` 这个变体读的就是下面那一格 `aria-busy`,不是第二份状态)。
  return (
    <div
      className="mt-3 flex flex-col gap-2 transition-opacity aria-busy:opacity-60"
      data-slot="card-options"
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* 只能选「1」的卡上不摆这一格（#1245 判官 P2-4）—— 一个只有一个选项的下拉改不了
            任何东西,而小表单那句指路话（`inPlaceOptionNames` 的 `maxCount > 1`）也不会点
            它的名,于是话与卡面对不上。判据两处同一条,与精修那一格同一条理由。 */}
        {options.maxCount > 1 && (
          <Field orientation="horizontal" className="w-auto gap-2">
            <FieldLabel htmlFor={countId} className="text-[0.75rem] text-muted-foreground">Images</FieldLabel>
            <NativeSelect
              id={countId}
              size="sm"
              value={count}
              disabled={locked}
              aria-busy={busy}
              aria-label="How many images"
              onChange={(event) => void apply({ count: Number(event.target.value) })}
            >
              {counts.map((n) => (
                <NativeSelectOption key={n} value={n}>{n}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
        {options.aspectRatios.length > 0 && (
          <Field orientation="horizontal" className="w-auto gap-2">
            <FieldLabel htmlFor={shapeId} className="text-[0.75rem] text-muted-foreground">Shape</FieldLabel>
            <NativeSelect
              id={shapeId}
              size="sm"
              value={aspectRatio}
              disabled={locked}
              aria-busy={busy}
              aria-label="Shape of the image"
              onChange={(event) => void apply({ aspectRatio: event.target.value })}
            >
              {options.aspectRatios.map((shape) => (
                <NativeSelectOption key={shape} value={shape}>{shape}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
        {/* 精修那一格只在**今天真的卖得动**时出现(服务端按可售白名单判,与付费闸同一个
            函数)。菜单上摆一格没有价的能力,商家点了才被拒,那是把 fail closed 做成陷阱。 */}
        {options.fineDetailAvailable && (
          <span className="flex items-center gap-2 text-[0.75rem] text-muted-foreground">
            <span className="font-semibold text-foreground">{FINE_DETAIL_CHIP}</span>
            <Switch
              checked={fineDetail}
              disabled={locked}
              aria-busy={busy}
              aria-label={FINE_DETAIL_CHIP}
              title={FINE_DETAIL_NOTE}
              onCheckedChange={(checked) => void apply({ fineDetail: checked })}
            />
            <span>{FINE_DETAIL_NOTE}</span>
          </span>
        )}
      </div>
      {error && (
        <div role="alert" className="text-[0.75rem] text-[var(--error-soft-foreground)]">{error}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CardChangeForm —— 「Change something」按下去之后长出来的那张小表单（清单 A5 / P2-013）
// ---------------------------------------------------------------------------

/**
 * 从前按下「Change something」只做一件事：把这张卡的**原话**（送给供应商的那段提示词）
 * 塞回输入框，商家自己在一坨机器措辞上改。清单 A5 要的是一张小表单 ——「能就地改的
 * 在卡上改，改不动的用人话说给 Otto」。
 *
 * **它一格新的服务端能力都不发明。** 今天 `ottoUpdateGenCardOptions` →
 * `applyCardOptions`（`packages/otto/src/skills/propose-card-options.ts`）只收图片卡的
 * 张数／形状／精修三格；视频卡整张拒绝（时长与声音改不动），参考那一格服务端根本没有
 * 入口。所以这张表单里**不摆**那几格：摆一个按下去必然被拒的控件，就是把 fail closed
 * 做成陷阱（与三格里精修那一格同一条理由）。它们的出路是下面那行人话，走的仍是
 * `onChangeSomething` 那**一条**既有对话路 —— 不新造第二条。
 */

export const CHANGE_FORM_LABEL = "Tell Otto what to change";
export const CHANGE_FORM_SEND = "Send to Otto";
export const CHANGE_FORM_PLACEHOLDER = "For example: make it 4:5, or drop the blue cup";

/** 「a、b and c」。一句话里念得出来的那种连接，不是逗号堆。 */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * 这张卡今天**能就地改**的那几格，用商家读得懂的词。判据只有卡自己那份 `options`
 * （服务端唯一一次派生）—— 界面不猜、不写死。
 */
export function inPlaceOptionNames(payload: OttoPlanCardPayload): string[] {
  const options = payload.options;
  if (!options) return [];
  // 用的就是那三格自己的名字（`FINE_DETAIL_CHIP` 是同一个常量）—— 指路句里叫一个名字、
  // 控件上写另一个名字，商家找不到你说的那一格。
  const names: string[] = [];
  if (options.maxCount > 1) names.push("images");
  if (options.aspectRatios.length > 0) names.push("shape");
  if (options.fineDetailAvailable) names.push(FINE_DETAIL_CHIP.toLowerCase());
  return names;
}

/**
 * 这张卡上**改不动**、只能让 Otto 重出一份计划的那几件事。
 *
 * 判据是卡自己的形状，不是一份手写清单：视频卡 ⇒ 时长与声音（`applyCardOptions` 对
 * 非图片卡整张拒绝）；带着参考的卡 ⇒ 用哪几件参考（服务端没有这个入口）。返回空数组
 * ⇒ 这张卡上没有这一类事，表单也就不说这句话。
 */
export function askOttoOnlyChanges(payload: OttoPlanCardPayload): string[] {
  const items: string[] = [];
  // 时长与声音是**两件事,两格**(#1245 复判 P2-2):从前它们合成一格「length and sound」,
  // 带参考的视频卡上就念成「length and sound and which references it uses」—— 一句话里两个
  // and 连读。拆成两格之后 `joinWords` 自己接得对:「length, sound and which references it
  // uses」;没有参考的视频卡仍是「length and sound」,与从前逐字相同。
  if (payload.kind === "video") items.push("length", "sound");
  if ((payload.mediaReferences?.length ?? 0) > 0 || (payload.approvedEntities?.length ?? 0) > 0) {
    items.push("which references it uses");
  }
  return items;
}

/** 上面那几件事的人话版；没有就不说。 */
export function askOttoNote(payload: OttoPlanCardPayload): string | null {
  const items = askOttoOnlyChanges(payload);
  if (items.length === 0) return null;
  return `I can't change ${joinWords(items)} on this card — tell me below and I'll redo the plan.`;
}

/** 卡上那几格的指路句；卡上没有渲染那几格时（老卡、视频卡、已排队）不说。 */
export function inPlaceNote(payload: OttoPlanCardPayload): string | null {
  const names = inPlaceOptionNames(payload);
  if (names.length === 0) return null;
  const subject = joinWords(names);
  const verb = names.length === 1 ? "is" : "are";
  const object = names.length === 1 ? "it" : "one";
  return `${subject[0].toUpperCase()}${subject.slice(1)} ${verb} on the card above — change ${object} there and the price updates.`;
}

/**
 * 送回对话的那句话 —— 商家写的那句在前，这张卡的原话跟在后面。
 *
 * 「连同当前卡送回对话」就是这一件事：Otto 收到的是「要改什么」加上「改的是哪一份
 * 计划」，所以它重出的那张卡不必靠商家自己再描述一遍。空的原话（读不懂的老卡）只送
 * 商家那句 —— 附一段空白比不附更糟。
 */
export function changeRequestSeed(note: string, payload: OttoPlanCardPayload): string {
  const wanted = note.trim();
  const current = (payload.structuredPrompt ?? "").trim();
  if (!current) return wanted;
  if (!wanted) return current;
  return `${wanted}\n\nThe plan to change: ${current}`;
}

export interface CardChangeFormProps {
  /** 已过 `planCardGate` 的卡面 payload —— 表单里每一句话都从它派生。 */
  payload: OttoPlanCardPayload;
  /** 这一刻卡上是不是真的渲染着那三格（父组件知道，表单不重判一次）。 */
  optionsOnCard: boolean;
  disabled?: boolean;
  /** 商家按下 Send —— 交出他写的那句话（已 trim，且必然非空）。 */
  onSubmit: (note: string) => void;
}

export function CardChangeForm({ payload, optionsOnCard, disabled, onSubmit }: CardChangeFormProps) {
  const [note, setNote] = useState("");
  const noteId = useId();
  const pointer = optionsOnCard ? inPlaceNote(payload) : null;
  const redo = askOttoNote(payload);
  const ready = note.trim().length > 0;

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-[11px] border border-border bg-card p-3" data-slot="card-change-form">
      {pointer && <div className="text-[0.75rem] text-muted-foreground">{pointer}</div>}
      {redo && <div className="text-[0.75rem] text-muted-foreground">{redo}</div>}
      <Field className="gap-1.5">
        <FieldLabel htmlFor={noteId} className="text-[0.75rem] text-muted-foreground">
          {CHANGE_FORM_LABEL}
        </FieldLabel>
        <Textarea
          id={noteId}
          rows={2}
          value={note}
          disabled={disabled}
          placeholder={CHANGE_FORM_PLACEHOLDER}
          aria-label={CHANGE_FORM_LABEL}
          onChange={(event) => setNote(event.target.value)}
          className="text-[0.8125rem]"
        />
      </Field>
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          className="rounded-[11px]"
          disabled={disabled || !ready}
          onClick={() => onSubmit(note.trim())}
        >
          {CHANGE_FORM_SEND}
        </Button>
      </div>
    </div>
  );
}

export default CardOptionControls;
