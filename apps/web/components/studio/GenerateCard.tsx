"use client";
import { useEffect, useRef, useState } from "react";
import { MentionInput, buildMentionDoc } from "@/components/MentionInput";
import { coworkGenerate } from "@/lib/cowork-actions";
import { getGenJob } from "@/lib/gen-actions";
import { GEN_PRICE_USD_PER_IMAGE, videoPriceUsd, type GenVideoModel } from "@artlio/core";
import type { EntityDTO } from "@/lib/types";

const POLL_CAP = 120; // ~4 min at 2s — mirrors GenSpace
const isVideoUrl = (u: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(u); // mirrors GenSpace

export function GenerateCard({
  cardId,
  payload,
  entities,
  alreadyGenerated,
}: {
  cardId: string;
  payload: unknown;
  entities: EntityDTO[];
  alreadyGenerated: boolean;
}) {
  const p = (payload ?? {}) as {
    kind?: "image" | "video";
    model?: string;
    reason?: string;
    downgraded?: boolean;
    structuredPrompt?: string;
    entityIds?: string[];
    variantSel?: Record<string, string>;
    params?: {
      durationSeconds?: number;
      resolution?: string;
      audio?: boolean;
      count?: number;
    };
    estimatedPriceUsd?: number;
  };

  const byId = new Map(entities.map((e) => [e.id, e]));

  // Build the seed doc from the persisted proposal's structuredPrompt + entity bindings.
  // buildMentionDoc expects { id, name, type, variantId? }[].
  const seedDoc = buildMentionDoc(
    p.structuredPrompt ?? "",
    (p.entityIds ?? [])
      .map((id) => {
        const e = byId.get(id);
        return e
          ? { id: e.id, name: e.name, type: e.type, variantId: p.variantSel?.[id] }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x),
  );

  const [prompt, setPrompt] = useState(p.structuredPrompt ?? "");
  const [ids, setIds] = useState<string[]>(p.entityIds ?? []);
  const [variantSel, setVariantSel] = useState<Record<string, string>>(p.variantSel ?? {});

  // generated=true disables the Generate button — UI-side re-spend guard
  const [generated, setGenerated] = useState(alreadyGenerated);
  const [busy, setBusy] = useState(false);
  // busyRef: synchronous mirror of busy — a same-frame double-click can't be caught
  // by `busy` STATE (React hasn't re-rendered yet); the ref flips synchronously.
  const busyRef = useRef(false);

  const [resultStatus, setResultStatus] = useState<"pending" | "done" | "failed">("pending");
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [resultMessage, setResultMessage] = useState<string | undefined>(undefined);
  // the in-card result area is for the LIVE in-session poll only; on reload the durable
  // GEN_RESULT message (rendered by Cowork.tsx) is the source of truth for the image, so
  // a reloaded already-generated card shows "Generated" without a stuck "Generating…".
  const [showResult, setShowResult] = useState(false);

  // Hold the interval timer so we can clear it on unmount (leak avoidance).
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => {
      if (intervalRef.current != null) clearInterval(intervalRef.current);
    };
  }, []);

  // Price is DISPLAY-ONLY — Generate is never gated on it; the real charge is server-side.
  const price =
    p.kind === "video"
      ? videoPriceUsd((p.model ?? "") as GenVideoModel, {
          seconds: p.params?.durationSeconds ?? 1,
          resolution: p.params?.resolution ?? "",
          audio: !!p.params?.audio,
          count: 1,
        })
      : (p.params?.count ?? 1) * GEN_PRICE_USD_PER_IMAGE;

  async function generate() {
    // UI-side re-spend guard: busy AND generated both block.
    // busyRef catches a same-frame double-click that `busy` state can't.
    if (busy || busyRef.current || generated) return;
    busyRef.current = true;
    setBusy(true);
    setShowResult(true);
    setResultStatus("pending");
    setResultUrls([]);
    setResultMessage(undefined);

    try {
      const res = await coworkGenerate({ cardId, prompt, entityIds: ids, variantSel });
      if ("error" in res) {
        setResultStatus("failed");
        setResultMessage(res.error);
        return;
      }

      // Mark generated NOW so the button stays disabled regardless of poll outcome.
      // This is the UI-side spend guard; the server already set genJobId on the card.
      setGenerated(true);

      const jobId = res.id;
      let n = 0;
      const t = setInterval(async () => {
        n += 1;
        try {
          const job = await getGenJob(jobId);
          if (!job) {
            if (n > POLL_CAP) {
              clearInterval(t);
              intervalRef.current = null;
              // Non-retryable on timeout — the job may still be running/charged.
              setResultStatus("failed");
              setResultMessage(
                "Status unknown — reload to check (don't re-run, you may have been charged).",
              );
            }
            return;
          }
          if (job.status === "DONE") {
            clearInterval(t);
            intervalRef.current = null;
            setResultStatus("done");
            setResultUrls(job.urls);
          } else if (job.status === "FAILED") {
            clearInterval(t);
            intervalRef.current = null;
            setResultStatus("failed");
            setResultMessage(
              job.spent
                ? `Charged, but saving the result failed${job.error ? `: ${job.error}` : ""} — reload to check; it'll be reconciled.`
                : job.error || "Generation failed (you were not charged).",
            );
          } else if (n > POLL_CAP) {
            clearInterval(t);
            intervalRef.current = null;
            // Non-retryable on timeout — mirrors GenSpace's "don't re-run, you may have been charged"
            setResultStatus("failed");
            setResultMessage(
              "Still running — reload to check (don't re-run, you may have been charged).",
            );
          }
        } catch {
          if (n > POLL_CAP) {
            clearInterval(t);
            intervalRef.current = null;
            setResultStatus("failed");
            setResultMessage(
              "Status unknown — reload to check (don't re-run, you may have been charged).",
            );
          }
        }
      }, 2000);
      intervalRef.current = t;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="cw-card cw-card-gen">
      {/* Header: model label + display-only price + downgrade note */}
      <div className="cw-card-head">
        <span className="cw-card-model">{p.model}</span>
        <span className="cw-card-price">{Number.isFinite(price) ? `~$${price.toFixed(2)}` : "—"}</span>
        {p.downgraded && (
          <span className="cw-card-note" title={p.reason ?? ""}>
            adjusted
          </span>
        )}
      </div>

      {/* Editable prompt via MentionInput — locked once generated */}
      <div className="cw-card-input-wrap">
        <MentionInput
          entities={entities}
          initialDoc={seedDoc}
          docKey={cardId}
          disabled={busy || generated}
          onChange={(t, i, vs) => {
            setPrompt(t);
            setIds(i);
            setVariantSel(vs);
          }}
        />
      </div>

      {p.kind === "video" && (
        <p className="cw-card-hint">
          Variant binding applies to image keyframes; video animates the source frame.
        </p>
      )}

      <button
        className="al-btn al-btn-md al-btn-primary"
        disabled={busy || generated || !prompt.trim()}
        onClick={generate}
      >
        {generated ? "Generated" : busy ? "Generating…" : "Generate"}
      </button>

      {showResult && (
        <div className="cw-card-result">
          {resultStatus === "pending" && (
            <span className="cw-card-result-pending">Generating…</span>
          )}
          {resultStatus === "failed" && (
            <span className="cw-error cw-card-result-error">{resultMessage}</span>
          )}
          {resultStatus === "done" &&
            resultUrls.map((u, i) => (
              isVideoUrl(u) ? (
                <video key={i} src={u} muted loop autoPlay playsInline className="cw-card-result-img" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={u} alt="" className="cw-card-result-img" />
              )
            ))}
        </div>
      )}
    </div>
  );
}
