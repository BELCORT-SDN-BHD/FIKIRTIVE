"use client";

/**
 * 北极星 · 沉浸式外壳上下文(Immersive shell context)
 *
 * 目的:让沉浸式产品外壳复用「北极星画廊」里已建好的每一页内容组件,而不是重画。
 * 机制:一个 client context,携带 `insideImmersive` 标志。
 *  - MockNote / DemoStateBar / DemoStates 在 immersive 内自我隐藏(§设计稿角标是画廊
 *    chrome,产品里不出现)。它们各加一行 useInsideImmersive() 早退,零重画内容。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto。
 */

import * as React from "react";

export interface ImmersiveContextValue {
  /** 是否运行在沉浸式产品外壳内(画廊 chrome 据此隐藏) */
  insideImmersive: boolean;
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

/** 便捷布尔:内容组件用它一行判断是否要隐藏画廊 chrome。 */
export function useInsideImmersive(): boolean {
  return React.useContext(ImmersiveContext)?.insideImmersive ?? false;
}
