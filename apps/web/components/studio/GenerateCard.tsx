"use client";
import { useEffect, useRef, useState } from "react";
import { MentionInput, buildMentionDoc } from "@/components/MentionInput";
import { coworkGenerate, coworkTurn, coworkVaryCard } from "@/lib/cowork-actions";
import { ottoApprove } from "@/lib/otto-client-actions";
import { getGenJob } from "@/lib/gen-actions";
import {
  GEN_PRICE_USD_PER_IMAGE, videoPriceUsd, videoDefaults,
  GEN_MODELS, GEN_VIDEO_MODELS, GEN_VIDEO_MODEL_INFO, GEN_VIDEO_MODEL_OPTIONS,
  type GenVideoModel,
} from "@artlio/core";
import { Lightbox } from "@/components/Lightbox";
import type { EntityDTO } from "@/lib/types";

const POLL_CAP = 120; // ~4 min at 2s — mirrors GenSpace
const isVideoUrl = (u: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(u); // mirrors GenSpace

export function GenerateCard({
  cardId,
  payload,
  entities,
  alreadyGenerated,
  hasDurableResult = false,
  threadId,
  projectId,
  onRevised,
  simple = false,
  pendingApproval = false,
  onApproved,
}: {
  cardId: string;
  payload: unknown;
  entities: EntityDTO[];
  alreadyGenerated: boolean;
  // a canonical GEN_RESULT row for this card already exists in the thread → hide the
  // in-card live preview so the same figure never renders twice.
  hasDurableResult?: boolean;
  threadId: string;
  projectId: string;
  onRevised: () => void;
  /** Simple mode: hide model picker + param pills. The card keeps its persisted model
   *  and params (set by suggestModel in coworkTurn) but doesn't expose them to the user. */
  simple?: boolean;
  /** Otto approval path: when true, show an "Approve & Generate" button that calls
   *  ottoApprove. Coexists with the existing manual Generate button (both paths use the
   *  same server idempotency key `cowork:<cardId>`). Transient — lost on full reload. */
  pendingApproval?: boolean;
  /** Called after a successful ottoApprove so Cowork can drop the card from its pending set. */
  onApproved?: () => void;
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
      aspectRatio?: string;
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

  // Editable control surface (Hedra parity). The chosen model + video params start from
  // the card's persisted values; the user may change them before Generate. These are
  // DISPLAY/INTENT only — startGen re-validates everything (model∈menu, params∈option set,
  // count≤max) at spend, so an invalid combo is rejected, never charged.
  const isVideo = p.kind === "video";
  // The card-kind's model menu — the user edits WITHIN the kind (can't flip image↔video).
  const modelMenu: readonly string[] = isVideo ? GEN_VIDEO_MODELS : GEN_MODELS;
  const modelLabel = (m: string): string => (isVideo ? GEN_VIDEO_MODEL_INFO[m as GenVideoModel]?.label ?? m : "Seedream");

  const [model, setModel] = useState<string>(p.model && modelMenu.includes(p.model) ? p.model : (modelMenu[0] ?? ""));
  // video params (snapped to the chosen model's option set; image cards don't use these)
  const [aspectRatio, setAspectRatio] = useState<string>(p.params?.aspectRatio ?? "");
  const [resolution, setResolution] = useState<string>(p.params?.resolution ?? "");
  const [durationSeconds, setDurationSeconds] = useState<number | undefined>(p.params?.durationSeconds);
  const [audio, setAudio] = useState<boolean>(!!p.params?.audio);

  // The chosen model's option set drives which pills are offered (mirrors genRequest.superRefine
  // client-side — the server still re-validates). Empty list → that control is hidden.
  const opts = isVideo ? GEN_VIDEO_MODEL_OPTIONS[model as GenVideoModel] : undefined;

  // On model change: re-snap every param to the NEW model's option set, defaulting to its
  // videoDefaults and dropping params the new model doesn't expose — so only valid values
  // are ever sent (and the live price re-derives from the new selection).
  function chooseModel(next: string) {
    setModel(next);
    if (isVideo && (GEN_VIDEO_MODELS as readonly string[]).includes(next)) {
      const d = videoDefaults(next as GenVideoModel);
      const o = GEN_VIDEO_MODEL_OPTIONS[next as GenVideoModel];
      setAspectRatio(o.aspectRatios.length ? d.aspectRatio : "");
      setResolution(o.resolutions.length ? d.resolution : "");
      setDurationSeconds(o.durations.length ? d.seconds : undefined);
      setAudio(d.audio);
    }
  }

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

  // "Create variations" — clones this card's payload into a new UN-generated card ($0).
  const [varyBusy, setVaryBusy] = useState(false);
  const varyBusyRef = useRef(false);
  const [varyError, setVaryError] = useState<string | undefined>(undefined);

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
  // Re-derived LIVE from the CHOSEN model/params (re-runs on every edit). The true charge is
  // the chosen valid model's rate, which the user sees here before clicking Generate.
  const price = isVideo
    ? videoPriceUsd(model as GenVideoModel, {
        seconds: durationSeconds ?? videoDefaults(model as GenVideoModel).seconds,
        resolution,
        audio,
        count: 1,
      })
    : (p.params?.count ?? 1) * GEN_PRICE_USD_PER_IMAGE;

  // Per-model price at its defaults — shown in the model picker so the user can compare cost.
  function modelDefaultPrice(m: string): number {
    if (!isVideo) return (p.params?.count ?? 1) * GEN_PRICE_USD_PER_IMAGE;
    const d = videoDefaults(m as GenVideoModel);
    return videoPriceUsd(m as GenVideoModel, { seconds: d.seconds, resolution: d.resolution, audio: d.audio, count: 1 });
  }

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
      const res = await coworkGenerate({
        cardId,
        prompt,
        entityIds: ids,
        variantSel,
        // editable overrides (Hedra parity) — startGen re-validates all of these at spend.
        model,
        ...(isVideo
          ? {
              ...(durationSeconds != null ? { durationSeconds } : {}),
              ...(resolution ? { resolution } : {}),
              ...(aspectRatio ? { aspectRatio } : {}),
              // only send audio for models that actually expose an audio toggle. startGen
              // rejects audio:false for always-silent models (gen.ts superRefine), so an
              // unconditional `audio` would make kling/grok/wan/hailuo un-generatable from a card.
              ...(opts?.audioToggle ? { audio } : {}),
            }
          : {}),
      });
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

  // Approve & Generate — calls ottoApprove (Otto money path), then polls the same way
  // generate() does. The existing Generate button (coworkGenerate) is unchanged — both
  // coexist; the server idempotency key `cowork:<cardId>` ensures at-most-one generation.
  async function approve() {
    if (busy || busyRef.current || generated) return;
    busyRef.current = true;
    setBusy(true);
    setShowResult(true);
    setResultStatus("pending");
    setResultUrls([]);
    setResultMessage(undefined);

    try {
      const res = await ottoApprove({ threadId, cardId });
      if ("error" in res) {
        setResultStatus("failed");
        setResultMessage(res.error);
        return;
      }

      // Mark generated now (same as generate()) — anti-respend latch.
      setGenerated(true);
      onApproved?.();

      // If the resume already produced a job id, poll it; otherwise the result
      // will land as a durable GEN_RESULT message on thread refresh (acceptable v1).
      const jobId = ("genJobId" in res && res.genJobId) ? res.genJobId : null;
      if (!jobId) {
        // No job id yet (chained approval / degraded) — the thread refresh via
        // onRevised is not available here; the durable GEN_RESULT will appear on
        // next thread load. Mark done-ish so the card doesn't hang on "Generating…".
        setResultStatus("done");
        return;
      }

      let n = 0;
      const t = setInterval(async () => {
        n += 1;
        try {
          const job = await getGenJob(jobId);
          if (!job) {
            if (n > POLL_CAP) {
              clearInterval(t);
              intervalRef.current = null;
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
      setReviseError("Couldn't reach Otto — please try again.");
    } finally {
      reviseBusyRef.current = false;
      setReviseBusy(false);
    }
  }

  async function createVariations() {
    if (varyBusy || varyBusyRef.current) return;
    varyBusyRef.current = true;
    setVaryBusy(true);
    setVaryError(undefined);
    try {
      const res = await coworkVaryCard({ cardId });
      if ("error" in res) {
        setVaryError(res.error);
        return;
      }
      onRevised(); // parent re-fetches the thread → the cloned card appears at the bottom
    } catch {
      setVaryError("Couldn't create variations — please try again.");
    } finally {
      varyBusyRef.current = false;
      setVaryBusy(false);
    }
  }

  // T2: Skip is a client-only dismiss — the message stays; we just collapse its body.
  if (skipped) {
    return <div className="cw-card-skipped">Skipped</div>;
  }

  return (
    <div className="cw-card cw-card-gen">
      {/* Header: model picker + live display-only price + downgrade note.
          Hidden in simple mode — the persisted model (from suggestModel) runs unchanged. */}
      {!simple && (
        <div className="cw-card-head">
          <label className="cw-ctrl">
            <span className="cw-ctrl-label">Model</span>
            <select
              className="cw-select cw-card-model-select"
              value={model}
              disabled={busy || generated}
              onChange={(e) => chooseModel(e.target.value)}
            >
              {modelMenu.map((m) => (
                <option key={m} value={m}>
                  {modelLabel(m)} · ~${modelDefaultPrice(m).toFixed(2)}
                </option>
              ))}
            </select>
          </label>
          <span className="cw-card-price">{Number.isFinite(price) ? `~$${price.toFixed(2)}` : "—"}</span>
          {p.downgraded && (
            <span className="cw-card-note" title={p.reason ?? ""}>
              adjusted
            </span>
          )}
        </div>
      )}

      {/* Param pills (video only) — hidden in simple mode (persisted params from coworkTurn run unchanged).
          In power-user mode: each sourced from the CHOSEN model's option set, so only valid values are
          offered (mirrors genRequest.superRefine; the server re-validates). A control with an empty option
          list is hidden (the model doesn't expose it). */}
      {!simple && isVideo && opts && (
        <div className="cw-card-pills">
          {opts.aspectRatios.length > 0 && (
            <label className="cw-ctrl">
              <span className="cw-ctrl-label">Aspect</span>
              <select
                className="cw-select"
                value={aspectRatio}
                disabled={busy || generated}
                onChange={(e) => setAspectRatio(e.target.value)}
              >
                {opts.aspectRatios.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
          )}
          {opts.resolutions.length > 0 && (
            <label className="cw-ctrl">
              <span className="cw-ctrl-label">Resolution</span>
              <select
                className="cw-select"
                value={resolution}
                disabled={busy || generated}
                onChange={(e) => setResolution(e.target.value)}
              >
                {opts.resolutions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
          )}
          {opts.durations.length > 0 && (
            <label className="cw-ctrl">
              <span className="cw-ctrl-label">Duration</span>
              <select
                className="cw-select"
                value={durationSeconds ?? ""}
                disabled={busy || generated}
                onChange={(e) => setDurationSeconds(Number(e.target.value))}
              >
                {opts.durations.map((d) => (
                  <option key={d} value={d}>{d}s</option>
                ))}
              </select>
            </label>
          )}
          {opts.audioToggle && (
            <label className="cw-ctrl cw-ctrl-check">
              <input
                type="checkbox"
                checked={audio}
                disabled={busy || generated}
                onChange={(e) => setAudio(e.target.checked)}
              />
              <span className="cw-ctrl-label">Audio</span>
            </label>
          )}
        </div>
      )}

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
        {/* Approve & Generate — Otto approval path. Additive: coexists with the manual
            Generate button below. Both paths share the server idempotency key `cowork:<cardId>`. */}
        {pendingApproval && !generated && (
          <button
            className="al-btn al-btn-md al-btn-primary"
            disabled={busy}
            onClick={approve}
            style={{ background: "var(--accent-2, var(--accent))", order: -1 }}
          >
            {busy ? "Generating…" : "Approve & Generate"}
          </button>
        )}
        <button
          className="al-btn al-btn-md al-btn-primary"
          disabled={busy || generated || !prompt.trim()}
          onClick={generate}
        >
          {/* Label follows the REAL job status; `generated` stays the anti-respend disable
              latch (untouched). A live in-flight gen reads "Generating…"; only a confirmed
              DONE (or a reloaded already-generated card) reads "Generated". */}
          {generated
            ? (showResult && resultStatus === "pending" ? "Generating…"
              : showResult && resultStatus === "failed" ? "Failed"
              : "Generated")
            : busy ? "Generating…" : "Generate"}
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
        {/* Create variations — only shown once generated; clones card payload ($0). */}
        {generated && (
          <button
            className="al-btn al-btn-md al-btn-ghost"
            disabled={varyBusy}
            onClick={createVariations}
          >
            {varyBusy ? "Creating…" : "Create variations"}
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
      {varyError && <span className="cw-error cw-card-result-error">{varyError}</span>}

      {showResult && !hasDurableResult && (
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
                  {/* Model id + raw cost are studio-only; the merchant surface hides them. */}
                  {!simple && (
                    <figcaption className="cw-media-cap">
                      {modelLabel(model) || kind}
                      {Number.isFinite(price) && <span className="cw-media-cap-price"> · ~${price.toFixed(2)}</span>}
                    </figcaption>
                  )}
                </figure>
              );
            })}
        </div>
      )}

      {zoom && <Lightbox src={zoom.src} kind={zoom.kind} onClose={() => setZoom(null)} />}
    </div>
  );
}
