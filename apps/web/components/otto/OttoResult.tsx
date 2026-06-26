"use client";
import React, { useState } from "react";
import { Download, Copy, Check, Sparkles, ChevronLeft, AlertCircle, RefreshCw } from "lucide-react";
import { Card, Button } from "@/components/fk";
import { bustUrl } from "@/lib/media-retry";
import { readPick, writePick } from "@/lib/result-pick";
import { coworkVaryCard } from "@/lib/cowork-actions";
import { creditsLabel } from "@/lib/credit-format";

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
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 44,
        padding: "0 20px",
        borderRadius: "var(--radius-control)",
        background: "var(--brand)",
        color: "var(--text-on-brand)",
        fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"],
        fontSize: "var(--text-base)",
        textDecoration: "none",
      }}
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
        style={{
          borderRadius: rounded ? "var(--radius-lg)" : 0,
          background: "var(--surface-sunken)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-2)",
          padding: "var(--space-6)",
          minHeight: 120,
        }}
      >
        <AlertCircle size={22} color="var(--text-faint)" />
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          Couldn&apos;t load this
        </span>
        <button
          type="button"
          onClick={() => { setErrored(false); setAttempt((a) => a + 1); }}
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--accent)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            textDecoration: "underline",
          }}
        >
          Reload
        </button>
      </div>
    );
  }

  return (
    <div style={{ borderRadius: rounded ? "var(--radius-lg)" : 0, overflow: "hidden", background: "var(--surface-sunken)" }}>
      {video ? (
        <video
          key={src}
          src={src}
          controls
          muted
          loop
          playsInline
          preload="none"
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
    <div
      style={{
        marginTop: "var(--space-4)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-3)",
      }}
    >
      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
        Done — happy with it, or want a tweak?
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          background: "var(--surface-raised)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-control)",
          padding: "4px 12px",
          cursor: "pointer",
        }}
      >
        Looks great
      </button>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          if (onTweak) {
            onTweak();
          } else {
            const el = document.getElementById("otto-composer");
            if (el) (el as HTMLElement).focus();
          }
        }}
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          background: "var(--surface-raised)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-control)",
          padding: "4px 12px",
          cursor: "pointer",
        }}
      >
        Tweak it
      </button>
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
    if (pickKey) {
      // Clamp the persisted pick to a valid index — a corrupt/stale localStorage value
      // (e.g. out-of-range or negative) must not select a missing url and crash the card.
      const stored = readPick(pickKey);
      return stored !== null && stored >= 0 && stored < urls.length ? stored : null;
    }
    return null;
  });

  // Keep localStorage in sync when the user picks
  function pick(i: number) {
    setSelected(i);
    if (pickKey) writePick(pickKey, i);
  }

  // Fix #2 — honest copy state
  const [copyState, setCopyState] = useState<CopyState>("idle");

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

  async function makeAnother() {
    if (!sourceCardId || makingAnother) return;
    setMakingAnother(true);
    setMakeAnotherError(null);
    try {
      const res = await coworkVaryCard({ cardId: sourceCardId });
      if (res && "error" in res) { setMakeAnotherError(res.error); return; }
      onMakeAnother?.();
    } catch {
      setMakeAnotherError("Couldn't queue another — please try again.");
    } finally {
      setMakingAnother(false);
    }
  }

  if (!urls.length) {
    return (
      <Card variant="default" padding="md">
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Your result is ready.</div>
      </Card>
    );
  }

  // ---- Chooser grid (ad pack, nothing chosen yet) ----
  if (selected === null) {
    return (
      <div style={{ maxWidth: 560 }}>
        <Card variant="default" padding="md">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            <Sparkles size={18} color="var(--accent)" />
            <span style={{ fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-base)", color: "var(--text-strong)" }}>
              {urls.length} options — tap the one you like
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
            {urls.map((u, i) => (
              // Fix #4 — accessible label on chooser buttons
              <button
                key={i}
                type="button"
                aria-label={`Option ${i + 1}`}
                onClick={() => pick(i)}
                style={{
                  position: "relative",
                  padding: 0,
                  border: "2px solid var(--border-subtle)",
                  borderRadius: "var(--radius-lg)",
                  overflow: "hidden",
                  cursor: "pointer",
                  background: "var(--surface-card)",
                  transition: "var(--transition-control)",
                }}
              >
                <Media url={u} alt={prompt ? `Generated image: ${prompt}` : `Option ${i + 1}`} rounded={false} />
                {/* No "Otto's pick" badge: there is no real curation signal from the backend
                    (all variants are equal outputs of one prompt). Don't claim a pick we
                    didn't make — add it back only when GEN_RESULT carries a real pick index. */}
              </button>
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
    <div style={{ maxWidth: 540 }}>
      <Card variant="default" padding="md">
        {/* Fix #4 — meaningful alt via mediaAlt */}
        <Media url={url} alt={mediaAlt} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
          <DownloadLink url={url} filename={filename} />
          {/* Fix #2 — honest copy states */}
          {copyState === "manual" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              <AlertCircle size={15} />
              <span>Couldn&apos;t copy — long-press the link to copy</span>
            </div>
          ) : (
            <Button
              variant="soft"
              size="md"
              leftIcon={copyState === "copied" ? <Check size={18} /> : <Copy size={18} />}
              onClick={() => copyLink(url)}
            >
              {copyState === "copied" ? "Copied" : "Copy to post"}
            </Button>
          )}
          {urls.length > 1 && (
            <Button variant="ghost" size="md" leftIcon={<ChevronLeft size={18} />} onClick={() => setSelected(null)}>
              See all {urls.length} options
            </Button>
          )}
          {sourceCardId && (
            <Button variant="ghost" size="md" leftIcon={<RefreshCw size={18} />} disabled={makingAnother} onClick={makeAnother}>
              {makingAnother ? "Queuing…" : "Make another"}
            </Button>
          )}
        </div>
        {makeAnotherError && (
          <div role="alert" style={{ marginTop: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--error-700)" }}>
            {makeAnotherError}
          </div>
        )}
        {typeof payload?.costCredits === "number" && (
          <div style={{ marginTop: "var(--space-3)", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
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
