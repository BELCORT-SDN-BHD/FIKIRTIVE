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
 * **这里一分钱都不算。** 菜单来自卡自己的 `options`（服务端唯一一次派生），改动交给
 * 服务端那个 $0 动作重铸整张卡，新的价随新卡回来。界面自己乘一个数当报价，就是第二处
 * 派生 —— 那正是「卡面说的」与「真正扣的」分家的来源（#580）。
 */
import React, { useId, useRef, useState } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
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
          setError(res ? res.error : FAILED_NOTE);
          // 这一趟被拒,排在后面那一格就不再替他发了 —— 他没看到这句话之前,再改一格
          // 是我们替他做的决定。
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

  return (
    <div className="mt-3 flex flex-col gap-2" data-slot="card-options" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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

export default CardOptionControls;
