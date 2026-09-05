"use client";

import type { CSSProperties } from "react";
import { SETTINGS_SECTIONS } from "@fikirtive/core/navigation";
import type { OttoErrorData } from "@/lib/otto-stream-bridge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** 花费上限住在哪一面 —— 名字与地址都来自导航 registry(`SETTINGS_SECTIONS`)。 */
const CAP_SECTION = SETTINGS_SECTIONS.find((section) => section.key === "billing")!;

/**
 * 「改了再送」那颗键上的字。画布那张始终可见的 Otto 卡片(`OttoTurnCard`)在同一种失败下
 * 提供同一个出路,读的是这一份 —— 一句话一个产地(2026-09-05 走查修复一)。
 */
export const EDIT_AND_RETRY_LABEL = "Edit and retry";

/**
 * 另外两条出路的字与地址 —— 画布那张状态卡读的是**同一份**(#1225 判官残留)。
 *
 * 从前这两颗键只长在抽屉里那张告示上。可画布形态下抽屉默认折起、被画板盖着,商家在状态卡上
 * 读到「Not enough credits …」之后,卡上一个能按的东西都没有:他已经决定要付钱了,产品却让
 * 他自己去找 Billing 在哪 —— 与 #979 记下的那 40 秒是同一种病。
 *
 * 地址与名字照旧从导航 registry 那一格读(`CAP_SECTION`),所以「句子念的名字 / 按钮上的名字 /
 * 按钮去的地方」三样同源;两张脸也不可能各说各话。
 *
 * 两个地址都从 registry 那一格读(尾巴轮四组一,#1233 判官 P2-1):`TOP_UP_HREF` 从前是一句
 * 写死的那句 billing 路由字面量 —— 取值碰巧与 registry 相同,可 Billing 哪天换了路由,抽屉与状态卡上
 * 那颗「Top up」就会静静指向一个 404,而旁边那颗「Open Billing & credits」照常好用。
 * 「充值」与「改上限」今天落在同一面(`SETTINGS_SECTIONS` 的 billing 那一格,它的 `does`
 * 里逐字写着「Buy credits, set your spend cap」),所以同源不是巧合,是那一格的定义。
 */
export const TOP_UP_LABEL = "Top up";
export const TOP_UP_HREF: string = CAP_SECTION.href;
export const CAP_EXIT_LABEL = `Open ${CAP_SECTION.label}`;
export const CAP_EXIT_HREF: string = CAP_SECTION.href;

export interface OttoStreamErrorNoticeProps {
  error: OttoErrorData;
  retryDraft?: string | null;
  onRetry?: (draft: string) => void;
  style?: CSSProperties;
}

/** One presentation for live and rehydrated Otto stream failures. */
export function OttoStreamErrorNotice({
  error,
  retryDraft,
  onRetry,
  style,
}: OttoStreamErrorNoticeProps) {
  return (
    <Alert role="alert" variant="destructive" style={style}>
      <AlertTitle>Otto couldn&apos;t finish this turn</AlertTitle>
      <AlertDescription>
        <p>{error.text}</p>
        {error.kind === "insufficient_credits" && (
          <Button type="button" size="xs" variant="outline" asChild>
            <a href={TOP_UP_HREF}>{TOP_UP_LABEL}</a>
          </Button>
        )}
      {/* #524 — the merchant's own spend cap stopped this turn. The only thing that moves is
          the cap, so the exit is wherever the cap control lives; a Top-up link here would buy
          them nothing (they already have the credits).
          FRONT-A1 判官 2026-09-02 P1:新壳把上限控件搬到了 Billing & credits
          (app/billing/page.tsx 挂 <SpendCapCard>,Settings 侧由
          settings-production-convergence.test.ts 反向围栏保证「一个钱控件都没有」),
          所以这颗按钮原来指的 /settings 是一条死路 —— 上面那句 SPEND_CAP_RAISE_CTA 说
          「Raise the cap in Billing & credits」,按钮却把商家送去别处。
          地址与名字都从 SETTINGS_SECTIONS 那一格读:句子念的名字、按钮上的名字、按钮去的
          地址,三样同源,不可能各说各话。 */}
        {error.kind === "spend_cap" && (
          <Button type="button" size="xs" variant="outline" asChild>
            <a href={CAP_EXIT_HREF}>{CAP_EXIT_LABEL}</a>
          </Button>
        )}
        {error.kind === "error" && retryDraft && onRetry && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onRetry(retryDraft)}
          >
            {EDIT_AND_RETRY_LABEL}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
