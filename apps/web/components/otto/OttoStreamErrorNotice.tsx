"use client";

import type { CSSProperties } from "react";
import type { OttoErrorData } from "@/lib/otto-stream-bridge";
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
    <div
      role="alert"
      className="rounded-[14px] bg-error-soft px-4 py-3 text-[0.875rem] text-[var(--error-soft-foreground)]"
      style={style}
    >
      {error.text}
      {error.kind === "insufficient_credits" && (
        <>
          {" "}
          <a
            href="/billing"
            className="font-semibold text-[var(--error-soft-foreground)] underline"
          >
            Top up
          </a>
        </>
      )}
      {/* #524 — the merchant's own spend cap stopped this turn. The only thing that moves is
          the cap, so the exit is Settings; a Top-up link here would buy them nothing. */}
      {error.kind === "spend_cap" && (
        <>
          {" "}
          <a
            href="/otto?view=account"
            className="font-semibold text-[var(--error-soft-foreground)] underline"
          >
            Open settings
          </a>
        </>
      )}
      {error.kind === "error" && retryDraft && onRetry && (
        <div className="mt-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onRetry(retryDraft)}
          >
            Edit and retry
          </Button>
        </div>
      )}
    </div>
  );
}
