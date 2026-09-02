"use client";

import type { CSSProperties } from "react";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import type { OttoErrorData } from "@/lib/otto-stream-bridge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

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
            <a href="/billing">Top up</a>
          </Button>
        )}
      {/* #524 — the merchant's own spend cap stopped this turn. The only thing that moves is
          the cap, so the exit is wherever the cap control lives; a Top-up link here would buy
          them nothing (they already have the credits).
          FRONT-A1 判官 2026-09-02 P1:新壳把上限控件搬到了 Billing & credits
          (app/billing/page.tsx 挂 <SpendCapCard>,Settings 侧由
          settings-production-convergence.test.ts 反向围栏保证「一个钱控件都没有」),
          所以这颗按钮原来指的 /settings 是一条死路 —— 上面那句 SPEND_CAP_RAISE_CTA 说
          「Raise the cap in Billing & credits」,按钮却把商家送去别处。目的地跟着控件走。 */}
        {error.kind === "spend_cap" && (
          <Button type="button" size="xs" variant="outline" asChild>
            <a href={SHELL_ROUTES.billing}>Raise your cap</a>
          </Button>
        )}
        {error.kind === "error" && retryDraft && onRetry && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onRetry(retryDraft)}
          >
            Edit and retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
