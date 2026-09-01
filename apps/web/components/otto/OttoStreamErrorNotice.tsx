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
          the cap, so the exit is Settings; a Top-up link here would buy them nothing. */}
        {error.kind === "spend_cap" && (
          <Button type="button" size="xs" variant="outline" asChild>
            <a href={SHELL_ROUTES.preferences}>Open settings</a>
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
