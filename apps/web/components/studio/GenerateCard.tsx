"use client";
import { useEffect, useRef, useState } from "react";
import { MentionInput, buildMentionDoc } from "@/components/MentionInput";
import { coworkGenerate, coworkTurn } from "@/lib/cowork-actions";
import { getGenJob } from "@/lib/gen-actions";
import { GEN_PRICE_USD_PER_IMAGE, videoPriceUsd, type GenVideoModel } from "@artlio/core";
import { Lightbox } from "@/components/Lightbox";
import type { EntityDTO } from "@/lib/types";

const POLL_CAP = 120; // ~4 min at 2s — mirrors GenSpace
const isVideoUrl = (u: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(u); // mirrors GenSpace

export function GenerateCard({
  cardId,
  payload,
  entities,
  alreadyGenerated,
  threadId,
  projectId,
  onRevised,
}: {
  cardId: string;
  payload: unknown;
  entities: EntityDTO[];
  alreadyGenerated: boolean;
  threadId: string;
  projectId: string;
  onRevised: () => void;
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

  // T2: Skip — client-only dismiss (no server call); collapses the card body.
  const [skipped, setSkipped] = useState(false);

  // T2: "Do it differently" — NL revise. coworkTurn re-plans (propose-only, never
  // spends); onRevised() lets the parent re-fetch the thread so the new card appears.
  const [revise, setRevise] = useState("");
  const [reviseBusy, setReviseBusy] = useState(false);
  const reviseBusyRef = useRef(false); // synchronous double-submit guard (GenSpace pattern)
  const [reviseError, setReviseError] = useState<string | undefined>(undefined);

  // T3: click-to-enlarge for the in-card live result (reuses the Gen-space Lightbox).
  const [zoom, setZoom] = useState<{ src: string; kind: "image" | "video" } | null>(null);

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

  async function submitRevise() {
    const feedback = revise.trim();
    // double-submit guard: reviseBusyRef catches a same-frame re-submit `reviseBusy`
    // state can't. Propose-only — coworkTurn never spends.
    if (!feedback || reviseBusy || reviseBusyRef.current) return;
    reviseBusyRef.current = true;
    setReviseBusy(true);
    setReviseError(undefined);
    try {
      const res = await coworkTurn({ threadId, projectId, text: feedback });
      if ("error" in res) {
        setReviseError(res.error);
        return;
      }
      setRevise("");
      onRevised(); // parent re-fetches the thread → the re-planned card appears
    } catch {
      setReviseError("Couldn't reach cowork — please try again.");
    } finally {
      reviseBusyRef.current = false;
      setReviseBusy(false);
    }
  }

  // T2: Skip is a client-only dismiss — the message stays; we just collapse its body.
  if (skipped) {
    return <div className="cw-card-skipped">Skipped</div>;
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

      <div className="cw-card-actions">
        <button
          className="al-btn al-btn-md al-btn-primary"
          disabled={busy || generated || !prompt.trim()}
          onClick={generate}
        >
          {generated ? "Generated" : busy ? "Generating…" : "Generate"}
        </button>
        {/* T2: Skip — client-only dismiss; hidden once generated (nothing to skip). */}
        {!generated && (
          <button
            className="al-btn al-btn-md al-btn-ghost"
            disabled={busy}
            onClick={() => setSkipped(true)}
          >
            Skip
          </button>
        )}
      </div>

      {/* T2: "Do it differently" — NL revise; coworkTurn re-plans (propose-only). */}
      {!generated && (
        <div className="cw-card-revise">
          <input
            className="cw-card-revise-input"
            placeholder="Do it differently — e.g. make it night, wider shot"
            value={revise}
            disabled={reviseBusy}
            onChange={(e) => setRevise(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submitRevise(); }
            }}
          />
          <button
            className="al-btn al-btn-md al-btn-ghost"
            disabled={reviseBusy || !revise.trim()}
            onClick={submitRevise}
          >
            {reviseBusy ? "Revising…" : "Revise"}
          </button>
        </div>
      )}
      {reviseError && <span className="cw-error cw-card-result-error">{reviseError}</span>}

      {showResult && (
        <div className="cw-card-result">
          {resultStatus === "pending" && (
            <span className="cw-card-result-pending">Generating…</span>
          )}
          {resultStatus === "failed" && (
            <span className="cw-error cw-card-result-error">{resultMessage}</span>
          )}
          {resultStatus === "done" &&
            resultUrls.map((u, i) => {
              const kind = isVideoUrl(u) ? "video" : "image";
              return (
                <figure key={i} className="cw-media">
                  {kind === "video" ? (
                    <video
                      src={u}
                      controls
                      muted
                      loop
                      playsInline
                      className="cw-card-result-img"
                    />
                  ) : (
                    <button
                      type="button"
                      className="cw-media-btn"
                      title="Click to enlarge"
                      onClick={() => setZoom({ src: u, kind })}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" className="cw-card-result-img" />
                    </button>
                  )}
                  <figcaption className="cw-media-cap">
                    {p.model || kind}
                    {Number.isFinite(price) && <span className="cw-media-cap-price"> · ~${price.toFixed(2)}</span>}
                  </figcaption>
                </figure>
              );
            })}
        </div>
      )}

      {zoom && <Lightbox src={zoom.src} kind={zoom.kind} onClose={() => setZoom(null)} />}
    </div>
  );
}
