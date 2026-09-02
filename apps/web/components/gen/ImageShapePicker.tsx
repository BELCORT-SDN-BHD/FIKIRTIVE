"use client";

/**
 * ImageShapePicker — 「这次出图是什么形状」，在花钱之前。
 *
 * 一个控件，三个入口（画布输入条 / 卡片上的「再来一张」条 / 资产详情页），因为形状这件事
 * 在三处必须长得一样、说的一样。选项**永远**来自服务端解析的菜单
 * （`getActiveGenModels().imageAspectRatios`）—— 这里一格都不写死，菜单上于是不可能出现
 * 一格引擎给不了的形状。
 *
 * 不做动画：这是每次生成都要经过的控件（Emil 的判据：高频操作不加动画），原生 select
 * 还顺带拿到键盘操作与移动端系统选择器。
 *
 * #914：「这台引擎会不会自己改写我的提示词」是一个模型能力属性，不是每次生成的动态结果
 * （Founder 裁决，市调见 #909）。图片这条产品线一律不回传改写后的提示词，说一次就够了 ——
 * 放在这里（花钱之前、选形状的同一处），不放进每一张图各自的回执里。悬浮态发现，不占位、
 * 不打断高频操作。
 */

import { useId } from "react";
import { CircleHelp } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TooltipButton } from "@/components/ui/tooltip-button";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * #914 r2(orchestrator 裁定,判官同一条原则贯彻到底):只许主张可证明的**回报行为**
 * （官方契约：图片响应结构没有 revised_prompt），不许主张引擎内部「原样执行 / 不改写」——
 * 那件事我们证明不了，此前的措辞正是这个不可证明的断言。
 */
export const IMAGE_ENGINE_PROMPT_CAPABILITY_NOTE =
  "This engine does not report the prompt it runs.";

export function ImageShapePicker({
  value,
  options,
  onChange,
  disabled = false,
  label = "Shape",
  compact = false,
  title,
}: {
  /** 当前会交付的形状。必须是 `options` 里的一格 —— 显示的就是会发出去的。 */
  value: string;
  /** 服务端解析的形状菜单（default-first）。空数组 ⇒ 不渲染任何东西。 */
  options: readonly string[];
  onChange: (aspect: string) => void;
  disabled?: boolean;
  label?: string;
  /** 窄条里用：标签只留给读屏器，视觉上只剩下形状本身。 */
  compact?: boolean;
  title?: string;
}) {
  const selectId = useId();
  if (options.length === 0) return null;
  const select = (
    <NativeSelect
      id={selectId}
      size="sm"
      value={value}
      disabled={disabled}
      aria-label={`${label} of the image`}
      title={title ?? "The shape this image will be made in"}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((aspect) => (
        <NativeSelectOption key={aspect} value={aspect}>{aspect}</NativeSelectOption>
      ))}
    </NativeSelect>
  );
  // #914：一个小图标，悬浮才说话——高频控件旁边不铺一整句常驻文案。
  const promptCapabilityNote = (
    <TooltipButton
      label="How this engine handles your prompt"
      tooltip={IMAGE_ENGINE_PROMPT_CAPABILITY_NOTE}
      variant="ghost"
      size="icon-xs"
    >
      <CircleHelp aria-hidden="true" />
    </TooltipButton>
  );
  const content = compact ? <>{select}{promptCapabilityNote}</> : (
    <Field orientation="horizontal" className="w-auto gap-2">
      <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
      {select}
      {promptCapabilityNote}
    </Field>
  );
  return <TooltipProvider>{content}</TooltipProvider>;
}
