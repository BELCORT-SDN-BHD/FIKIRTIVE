"use client";
import React, { useState } from "react";
import { Download, Copy, Check, Sparkles, ChevronLeft, Wrench } from "lucide-react";
import { Card, Button } from "@/components/fk";

export interface OttoResultProps {
  payload: { kind?: string; model?: string; urls?: string[]; generationIds?: string[]; costUsd?: number } | null;
  onEditByHand?: () => void;
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

function Media({ url, rounded = true }: { url: string; rounded?: boolean }) {
  const video = isVideoUrl(url);
  return (
    <div style={{ borderRadius: rounded ? "var(--radius-lg)" : 0, overflow: "hidden", background: "var(--surface-sunken)" }}>
      {video ? (
        <video src={url} controls muted loop playsInline style={{ width: "100%", display: "block" }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" style={{ width: "100%", display: "block" }} />
      )}
    </div>
  );
}

/** A finished result in the conversation. One asset → show it with Download / Copy.
 *  An ad pack (N variants) → a chooser grid with "Otto's pick"; tap one to settle on it. */
export function OttoResult({ payload, onEditByHand }: OttoResultProps) {
  const urls = payload?.urls ?? [];
  const genIds = payload?.generationIds ?? [];
  // Single result auto-selects index 0; a pack starts unchosen so the grid shows first.
  const [selected, setSelected] = useState<number | null>(urls.length === 1 ? 0 : null);
  const [copied, setCopied] = useState(false);

  if (!urls.length) {
    return (
      <Card variant="default" padding="md">
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Your result is ready.</div>
      </Card>
    );
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — no-op */
    }
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
              <button
                key={i}
                type="button"
                onClick={() => setSelected(i)}
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
                <Media url={u} rounded={false} />
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
  return (
    <div style={{ maxWidth: 540 }}>
      <Card variant="default" padding="md">
        <Media url={url} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
          <DownloadLink url={url} filename={filename} />
          <Button
            variant="soft"
            size="md"
            leftIcon={copied ? <Check size={18} /> : <Copy size={18} />}
            onClick={() => copyLink(url)}
          >
            {copied ? "Copied" : "Copy to post"}
          </Button>
          {urls.length > 1 && (
            <Button variant="ghost" size="md" leftIcon={<ChevronLeft size={18} />} onClick={() => setSelected(null)}>
              See all {urls.length} options
            </Button>
          )}
          {onEditByHand && (
            <Button variant="ghost" size="md" leftIcon={<Wrench size={18} />} onClick={onEditByHand}>
              Edit by hand
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

export default OttoResult;
