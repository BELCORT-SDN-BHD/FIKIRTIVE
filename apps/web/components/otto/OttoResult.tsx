"use client";
import React, { useState } from "react";
import { Download, Copy, Check } from "lucide-react";
import { Card, Button } from "@/components/fk";

export interface OttoResultProps {
  payload: { kind?: string; model?: string; urls?: string[]; generationIds?: string[]; costUsd?: number } | null;
}

const isVideoUrl = (u: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(u);

/** A finished result rendered in the conversation: the asset + Download / Copy-to-post.
 *  (The 4-up "choose from a batch" chooser comes in a later milestone.) */
export function OttoResult({ payload }: OttoResultProps) {
  const [copied, setCopied] = useState(false);
  const urls = payload?.urls ?? [];

  if (!urls.length) {
    return (
      <Card variant="default" padding="md">
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Your result is ready.</div>
      </Card>
    );
  }

  const url = urls[0];
  const video = isVideoUrl(url);
  const ext = url.split("?")[0].split(".").pop() || "bin";
  const filename = `fikirtive-result.${ext}`;

  async function copyLink() {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <div style={{ maxWidth: 540 }}>
      <Card variant="default" padding="md">
        <div style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", boxShadow: "var(--shadow-sm)", background: "var(--surface-sunken)" }}>
          {video ? (
            <video src={url} controls muted loop playsInline style={{ width: "100%", display: "block" }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" style={{ width: "100%", display: "block" }} />
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
          {/* plain anchor download — no JS spend path (matches the dark surface) */}
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
          <Button variant="soft" size="md" leftIcon={copied ? <Check size={18} /> : <Copy size={18} />} onClick={copyLink}>
            {copied ? "Copied" : "Copy to post"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default OttoResult;
