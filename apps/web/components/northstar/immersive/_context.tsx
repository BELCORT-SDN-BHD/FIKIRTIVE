"use client";

/**
 * 北极星 · 沉浸式外壳上下文(Immersive shell context)
 *
 * 目的:让沉浸式产品外壳复用「北极星画廊」里已建好的每一页内容组件,而不是重画。
 * 机制:一个 client context,携带 `insideImmersive` 标志 + Otto 停靠状态。
 *  - MockNote / DemoStateBar / DemoStates 在 immersive 内自我隐藏(§设计稿角标是画廊
 *    chrome,产品里不出现)。它们各加一行 useInsideImmersive() 早退,零重画内容。
 *  - Otto dock 用 openOtto(prompt?) 从任意路由展开为聊天面板(§8d 常驻 dock)。
 *
 * 铁律:纯 client、零后台 import;coral 只属于 Otto。
 */

import * as React from "react";
import type { NsOttoContext } from "./_store";

export interface ImmersiveContextValue {
  /** 是否运行在沉浸式产品外壳内(画廊 chrome 据此隐藏) */
  insideImmersive: boolean;
  /** Otto 是否正在后台工作(dock coral 徽点脉冲) */
  ottoWorking: boolean;
  /**
   * 打开 Otto dock 聊天面板;可带一句预填 prompt(不自动发送)。
   * 第二参 context 走上下文桥(宪法 7):dock 显示「Looking at: …」并把它注入回复前缀,
   * 让「把这个改成 9:16」的「这个」可解析。
   */
  openOtto: (prompt?: string, context?: NsOttoContext) => void;
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
