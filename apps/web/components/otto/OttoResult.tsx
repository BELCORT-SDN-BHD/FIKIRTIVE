"use client";
import React, { useEffect, useState } from "react";
import { Download, Copy, Check, Sparkles, ChevronLeft, AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { bustUrl } from "@/lib/media-retry";
import { readPick, writePick } from "@/lib/result-pick";
import { coworkVaryCard } from "@/lib/cowork-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { creditsLabel } from "@/lib/credit-format";
import { videoFirstFrameSrc } from "@/lib/video-first-frame";

export interface OttoResultProps {
  payload: { kind?: string; model?: string; urls?: string[]; generationIds?: string[]; prompt?: string; costUsd?: number; costCredits?: number } | null;
  onTweak?: () => void;
  /** The GEN_CARD id that produced this result — enables "Make another". */
  sourceCardId?: string;
  /** Called after a fresh card is spawned so the parent can refetch/re-arm. */
  onMakeAnother?: () => void;
}

const isVideoUrl = (u: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(u);
const fileNameFor = (u: string, gid?: string) => {
  const ext = u.split("?")[0].split(".").pop() || "bin";
  return `fikirtive-${(gid ?? "result").slice(0, 8)}.${ext}`;
};

/** Download as a plain anchor styled like a primary button — NO JS spend path. */
function DownloadLink({ url, filename }: { url: string; filename: string }) {
  return (
    <a
      href={url}
      download={filename}
      className="inline-flex items-center gap-2 h-11 px-5 rounded-[14px] bg-primary text-primary-foreground font-semibold text-[1rem] no-underline"
    >
      <Download size={18} /> Download
    </a>
  );
}

/** Fix #1 — media with onError → retry with cache-bust, then show error tile */
function Media({
  url,
  alt,
  rounded = true,
}: {
  url: string;
  alt: string;
  rounded?: boolean;
}) {
  const video = isVideoUrl(url);
  const [attempt, setAttempt] = useState(0);
  const [errored, setErrored] = useState(false);
  const src = attempt === 0 ? url : bustUrl(url, attempt);

  function handleError() {
    if (attempt < 2) {
      // Retry up to twice with cache-bust, then show error tile.
      setAttempt((a) => a + 1);
    } else {
      setErrored(true);
    }
  }

  if (errored) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 p-6 min-h-[120px] bg-muted${rounded ? " rounded-[14px]" : ""}`}
      >
        <AlertCircle size={22} className="text-muted-foreground/70" />
        <span className="text-[0.875rem] text-muted-foreground">
          Couldn&apos;t load this
        </span>
        <Button
          type="button"
          variant="link"
          onClick={() => { setErrored(false); setAttempt((a) => a + 1); }}
          className="h-auto w-auto p-0 text-[0.875rem] underline"
        >
          Reload
        </Button>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden bg-muted${rounded ? " rounded-[14px]" : ""}`}>
      {video ? (
        <video
          key={src}
          // 首帧,不是黑砖(判官二轮复核 P2-2):与画布节点(VideoNode.tsx)同一个
          // `#t=0.001` 片段 + `preload="metadata"`,让浏览器在元数据阶段就把第一帧
          // 解出来画上 —— 片段不发给服务器,`bustUrl` 的重试查询参数不受影响。
          src={videoFirstFrameSrc(src)}
          controls
          muted
          loop
          playsInline
          preload="metadata"
          style={{ width: "100%", display: "block" }}
          onError={handleError}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={alt}
          loading="lazy"
          style={{ width: "100%", display: "block" }}
          onError={handleError}
        />
      )}
    </div>
  );
}

/** Fix #2 — honest copy: only show "Copied" on real success */
type CopyState = "idle" | "copied" | "manual";

async function attemptCopy(url: string): Promise<CopyState> {
  if (!navigator.clipboard?.writeText) return "manual";
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "manual";
  }
}

/** Fix #12 — "how's it look?" nudge, purely client-side, no Otto turn */
function ResultNudge({ onTweak }: { onTweak?: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <span className="text-[0.875rem] text-muted-foreground">
        Done — happy with it, or want a tweak?
      </span>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setDismissed(true)}
        className="h-auto rounded-[14px] px-3 py-1 text-[0.875rem] font-normal text-muted-foreground shadow-none"
      >
        Looks great
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setDismissed(true);
          if (onTweak) {
            onTweak();
          } else {
            const el = document.getElementById("otto-composer");
            if (el) (el as HTMLElement).focus();
          }
        }}
        className="h-auto rounded-[14px] px-3 py-1 text-[0.875rem] font-normal text-muted-foreground shadow-none"
      >
        Tweak it
      </Button>
    </div>
  );
}

/** A finished result in the conversation. One asset → show it with Download / Copy.
 *  An ad pack (N variants) → a chooser grid with "Otto's pick"; tap one to settle on it. */
export function OttoResult({ payload, onTweak, sourceCardId, onMakeAnother }: OttoResultProps) {
  const urls = payload?.urls ?? [];
  const genIds = payload?.generationIds ?? [];
  const prompt = payload?.prompt ?? "";

  // Fix #3 — variant pick persists via localStorage, keyed by first genId
  const pickKey = genIds[0] ?? urls[0] ?? "";
  const [selected, setSelected] = useState<number | null>(() => {
    if (urls.length === 1) return 0;
    // Keep SSR/client hydration deterministic; restore persisted picks after mount.
    return null;
  });
  useEffect(() => {
    queueMicrotask(() => {
      if (urls.length === 1) {
        setSelected(0);
        return;
      }
      if (pickKey) {
        const stored = readPick(pickKey);
        setSelected(stored !== null && stored >= 0 && stored < urls.length ? stored : null);
        return;
      }
      setSelected(null);
    });
  }, [pickKey, urls.length]);

  // Keep localStorage in sync when the user picks
  function pick(i: number) {
    setSelected(i);
    if (pickKey) writePick(pickKey, i);
  }

  // Fix #2 — honest copy state
  const [copyState, setCopyState] = useState<CopyState>("idle");
  useEffect(() => {
    queueMicrotask(() => setCopyState("idle"));
  }, [selected]);

  async function copyLink(url: string) {
    const outcome = await attemptCopy(url);
    setCopyState(outcome);
    if (outcome === "copied") {
      setTimeout(() => setCopyState("idle"), 1800);
    }
  }

  // "Make another" — spawns a fresh variant card via coworkVaryCard.
  const [makingAnother, setMakingAnother] = useState(false);
  const [makeAnotherError, setMakeAnotherError] = useState<string | null>(null);
  const [makeAnotherSuccess, setMakeAnotherSuccess] = useState(false);

  async function makeAnother() {
    if (!sourceCardId || makingAnother) return;
    setMakingAnother(true);
    setMakeAnotherError(null);
    setMakeAnotherSuccess(false);
    try {
      const res = await coworkVaryCard({ cardId: sourceCardId });
      if (res && "error" in res) { setMakeAnotherError(res.error); return; }
      setMakeAnotherSuccess(true);
      setTimeout(() => setMakeAnotherSuccess(false), 2500);
      onMakeAnother?.();
    } catch {
      setMakeAnotherError("Couldn't queue another — please try again.");
    } finally {
      setMakingAnother(false);
      // "Make another" queues a fresh paid variant (#550).
      notifyBalanceRefresh();
    }
  }

  if (!urls.length) {
    return (
      // leading-[1.5] — design-baseline body line-height (Analytics standard)
      <div className="gb leading-[1.5]">
        <Card>
          <div className="text-[0.875rem] text-muted-foreground">Your result is ready.</div>
        </Card>
      </div>
    );
  }

  // ---- Chooser grid (ad pack, nothing chosen yet) ----
  if (selected === null) {
    return (
      // leading-[1.5] — design-baseline body line-height (Analytics standard)
      <div className="gb leading-[1.5] max-w-[560px]">
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={18} className="text-brand" />
            <span className="font-bold text-[1rem] text-foreground">
              {urls.length} options — tap the one you like
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3, 0.75rem)" }}>
            {urls.map((u, i) => (
              // Fix #4 — accessible label on chooser buttons
              <Button
                key={i}
                type="button"
                variant="outline"
                aria-label={`Option ${i + 1}`}
                onClick={() => pick(i)}
                className="relative h-auto w-full overflow-hidden rounded-[14px] border-2 border-border bg-card p-0 shadow-none"
              >
                <Media url={u} alt={prompt ? `Generated image: ${prompt}` : `Option ${i + 1}`} rounded={false} />
                {/* No "Otto's pick" badge: there is no real curation signal from the backend
                    (all variants are equal outputs of one prompt). Don't claim a pick we
                    didn't make — add it back only when GEN_RESULT carries a real pick index. */}
              </Button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  // ---- Chosen result ----
  const url = urls[selected];
  const filename = fileNameFor(url, genIds[selected]);
  const mediaAlt = prompt ? `Generated image: ${prompt}` : "Generated image";

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className="gb leading-[1.5] max-w-[540px]">
      <Card>
        {/* Fix #4 — meaningful alt via mediaAlt */}
        <Media url={url} alt={mediaAlt} />
        <div className="flex flex-wrap gap-3 mt-4">
          <DownloadLink url={url} filename={filename} />
          {/* Fix #2 — honest copy states */}
          {copyState === "manual" ? (
            <div className="flex flex-wrap items-center gap-2 text-[0.875rem] text-muted-foreground">
              <AlertCircle size={15} />
              <span>Couldn&apos;t copy automatically.</span>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-foreground underline underline-offset-2"
              >
                Open asset
              </a>
              <Button
                type="button"
                variant="link"
                onClick={() => copyLink(url)}
                className="h-auto w-auto p-0 underline underline-offset-2"
              >
                Try again
              </Button>
            </div>
          ) : (
            <Button
              variant="default"
              onClick={() => copyLink(url)}
            >
              {copyState === "copied" ? <Check size={18} /> : <Copy size={18} />}
              {copyState === "copied" ? "Copied" : "Copy to post"}
            </Button>
          )}
          {urls.length > 1 && (
            <Button variant="ghost" onClick={() => setSelected(null)}>
              <ChevronLeft size={18} />
              See all {urls.length} options
            </Button>
          )}
          {sourceCardId && (
            <Button variant="ghost" disabled={makingAnother} onClick={makeAnother}>
              <RefreshCw size={18} />
              {makingAnother ? "Queuing…" : makeAnotherSuccess ? "Added" : "Make another"}
            </Button>
          )}
        </div>
        {makeAnotherSuccess && (
          <div role="status" className="mt-2 text-[0.875rem] text-[var(--success-soft-foreground)]">
            Added another card to this conversation.
          </div>
        )}
        {makeAnotherError && (
          <Alert role="alert" variant="destructive" density="compact" className="mt-2">
            <AlertDescription>{makeAnotherError}</AlertDescription>
          </Alert>
        )}
        {typeof payload?.costCredits === "number" && (
          <div className="mt-3 text-[0.875rem] text-muted-foreground">
            Cost: {creditsLabel(payload.costCredits)}
          </div>
        )}
        {/* Fix #12 — free "how's it look?" nudge */}
        <ResultNudge onTweak={onTweak} />
      </Card>
    </div>
  );
}

export default OttoResult;
