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
import { OttoPanelShell } from "./OttoPanelShell";
import { ottoPanelMountsOn } from "./panel-surface";

/**
 * 会话那一整棵树(`OttoChatStream` → 审批卡 → 分镜卡 → …)按需加载(判官 r1 P3-6)。
 *
 * 静态 import 的话,商家壳的 client bundle 从 `OttoPanelShell` 那 9 个模块涨到 208 个 ——
 * 而**每一个**商家表面都要付这笔钱,包括面板收着、商家今天一次都没点开它的那些次。
 * 面板本身(壳、launcher、几何)仍然是静态的:它必须在首帧就画得出来,不然宽度会跳一下。
 *
 * 用 `React.lazy` 而不是 `next/dynamic`:分包这件事是那句 `import()` 做的,两者一样;
 * 但 `next/dynamic` 只在 Next 自己的 runtime 里活 —— 在 vitest 里它**永远渲染空**
 * (实测:12 拍之后面板体仍是空字符串),于是这一整段会话就再也没有测试盯着了。
 * 一个测不到的优化不值得用一整块验收去换。
 */
const OttoPanelConversation = React.lazy(() =>
  import("./OttoPanelConversation").then((m) => ({ default: m.OttoPanelConversation })),
);

/** 分包还没到之前面板体里的那一行字,和会话自己的加载态说同一句话,免得闪两种。 */
function ConversationFallback() {
  return (
    <p data-otto-panel-conversation="loading" className="px-4 py-6 text-[13px] text-muted-foreground">
      Opening your conversation…
    </p>
  );
}

export function OttoPanelMount({
  location,
  children,
}: {
  /** 当前地址(带 query,与 `MerchantShellContent` 收到的是同一个字符串)。 */
  location: string;
  children: React.ReactNode;
}) {
  if (!ottoPanelMountsOn(location)) return <>{children}</>;

  return (
    <OttoPanelShell
      panelBody={
        <React.Suspense fallback={<ConversationFallback />}>
          <OttoPanelConversation />
        </React.Suspense>
      }
    >
      {children}
    </OttoPanelShell>
  );
}
