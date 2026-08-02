"use client";

/**
 * 北极星 · 沉浸式外壳上下文(Immersive shell context)
 *
 * 目的:让沉浸式产品外壳复用「北极星画廊」里已建好的每一页内容组件,而不是重画。
 * 机制:一个 client context,携带 `insideImmersive` 标志 + Otto 停靠状态。
 *  - MockNote / DemoStateBar / DemoStates 在 immersive 内自我隐藏(§设计稿角标是画廊
 *    chrome,产品里不出现)。它们各加一行 useInsideImmersive() 早退,零重画内容。
 *  - 页面上的「问 Otto」用 openOtto() 落到真对话(#609:假 Otto 小窗已砍除)。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto。
 */

import * as React from "react";

export interface ImmersiveContextValue {
  /** 是否运行在沉浸式产品外壳内(画廊 chrome 据此隐藏) */
  insideImmersive: boolean;
  /**
   * 把商家送到真 Otto 对话面前(线上 `/otto`)。
   * #609 之前这里是「展开右下假小窗并预填一句话」;那个小窗会编造经营事实,已砍除。
   */
  openOtto: () => void;
}

const ImmersiveContext = React.createContext<ImmersiveContextValue | null>(null);

export function ImmersiveProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: ImmersiveContextValue;
}) {
  return <ImmersiveContext.Provider value={value}>{children}</ImmersiveContext.Provider>;
}

/** 完整上下文(仅在沉浸式外壳内可用)。 */
export function useImmersive(): ImmersiveContextValue | null {
  return React.useContext(ImmersiveContext);
}

/** 便捷布尔:内容组件用它一行判断是否要隐藏画廊 chrome。 */
export function useInsideImmersive(): boolean {
  return React.useContext(ImmersiveContext)?.insideImmersive ?? false;
}
