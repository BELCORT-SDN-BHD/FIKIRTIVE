"use client";

/**
 * OttoPanelMount.tsx — 面板真正挂进壳的那一处,商家表面上唯一的一处。
 *
 * 规格:`docs/specs/wave2-shell.md` §3、§9.2(W2-7 行);票 #994 挂载项。
 *
 * 它挂在 `MerchantShellContent` 的内容列里,而不是 `app/layout.tsx` 的最外层 —— 最外层还包着
 * `/login`、`/signup`、`/reset-password` 这些根本没有商家的面。商家表面的判定
 * (`isMerchantSurface`)今天已经在那一层做完了,这里不再抄第二份。
 *
 * 「挤而不盖」就在这一层落地:面板与主内容是同一个 flex 行里的两个兄弟(见 `OttoPanelShell`),
 * 所以没有遮罩、没有 `pointer-events: none`,面板开着的时候底下那一页照样点得到。
 */

import * as React from "react";
import { OttoPanelConversation } from "./OttoPanelConversation";
import { OttoPanelShell } from "./OttoPanelShell";
import { ottoPanelMountsOn } from "./panel-surface";

export function OttoPanelMount({
  location,
  children,
}: {
  /** 当前地址(带 query,与 `MerchantShellContent` 收到的是同一个字符串)。 */
  location: string;
  children: React.ReactNode;
}) {
  if (!ottoPanelMountsOn(location)) return <>{children}</>;

  return <OttoPanelShell panelBody={<OttoPanelConversation />}>{children}</OttoPanelShell>;
}
