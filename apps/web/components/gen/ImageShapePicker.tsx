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
 */

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
  if (options.length === 0) return null;
  const select = (
    <select
      value={value}
      disabled={disabled}
      aria-label={`${label} of the image`}
      title={title ?? "The shape this image will be made in"}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-[8px] border border-border bg-card px-2 py-1 text-[0.8125rem] text-foreground disabled:opacity-40"
      style={{ flex: "none" }}
    >
      {options.map((aspect) => (
        <option key={aspect} value={aspect}>{aspect}</option>
      ))}
    </select>
  );
  if (compact) return select;
  return (
    <label className="flex items-center gap-2 text-[0.75rem] text-muted-foreground">
      <span className="font-semibold text-foreground">{label}</span>
      {select}
    </label>
  );
}
