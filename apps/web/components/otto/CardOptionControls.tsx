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
import React, { useId, useState } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { ottoUpdateGenCardOptions } from "@/lib/otto-client-actions";
import type { OttoPlanCardPayload } from "./plan-card-contract";

/** 精修那一格旁边那句话 —— 它会改价，所以这件事必须写在开关旁边，而不是等按下去才知道。 */
export const FINE_DETAIL_NOTE = "Costs more — the price below updates.";

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

export function CardOptionControls({ threadId, cardId, payload, disabled, onChanged }: CardOptionControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countId = useId();
  const shapeId = useId();

  const options = payload.options;
  const count = payload.params?.count ?? 1;
  const aspectRatio = payload.params?.aspectRatio ?? "";
  const fineDetail = payload.fineDetail === true;

  async function apply(edit: { count?: number; aspectRatio?: string; fineDetail?: boolean }) {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await ottoUpdateGenCardOptions({ threadId, cardId, ...edit });
      if (!res || "error" in res) {
        // 服务端已经说清楚了 —— 原样交给商家,泛化句不许盖掉它。
        setError(res ? res.error : "That didn't go through — please try again.");
        return;
      }
      onChanged(res.payload);
    } catch {
      setError("That didn't go through — please try again.");
    } finally {
      setBusy(false);
    }
  }

  // 老卡(这条修改之前铸的)与视频卡没有这份菜单 —— 一格都不渲染,与从前逐字相同。
  if (!options) return null;
  const counts = Array.from({ length: Math.max(1, options.maxCount) }, (_, i) => i + 1);
  const locked = busy || disabled === true;

  return (
    <div className="mt-3 flex flex-col gap-2" data-slot="card-options">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Field orientation="horizontal" className="w-auto gap-2">
          <FieldLabel htmlFor={countId} className="text-[0.75rem] text-muted-foreground">Images</FieldLabel>
          <NativeSelect
            id={countId}
            size="sm"
            value={count}
            disabled={locked}
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
            <span className="font-semibold text-foreground">Fine detail</span>
            <Switch
              checked={fineDetail}
              disabled={locked}
              aria-label="Fine detail"
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
