"use client";
import React, { useEffect, useReducer, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DetailPanel from "@/components/asset/DetailPanel";
import { startGen, getGenJob, getActiveGenModels } from "@/lib/gen-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { uploadFilesDirect } from "@/lib/direct-upload";
import { finalizeCandidateUploads } from "@/lib/upload-actions";
import type { EntityDTO } from "@/lib/types";
import { type Template, buildTemplatePrompt, templateRunCredits } from "@/lib/templates";
import { creditsLabel } from "@/lib/credit-format";

type Phase = "form" | "generating" | "done" | "unknown";

export type TemplateRunState = {
  phase: Phase;
  message: string | null;
  resultUrl: string | null;
  resultGenId: string | null;
};

type TemplateRunEvent =
  | { type: "start" }
  | { type: "explicit-error"; message: string }
  | { type: "failed" }
  | { type: "unknown" }
  | { type: "done"; url: string; genId: string }
  | { type: "clear-message" }
  | { type: "reset" };

export function initialTemplateRunState(): TemplateRunState {
  return { phase: "form", message: null, resultUrl: null, resultGenId: null };
}

export function isTemplatePaidConfirmAvailable(state: TemplateRunState): boolean {
  return state.phase === "form";
}

export function templateRunReducer(state: TemplateRunState, event: TemplateRunEvent): TemplateRunState {
  switch (event.type) {
    case "start":
      return { phase: "generating", message: null, resultUrl: null, resultGenId: null };
    case "explicit-error":
      return { ...state, phase: "form", message: event.message };
    case "failed":
      return { ...state, phase: "form", message: "Generation failed. You weren't charged. Try again." };
    case "unknown":
      return {
        ...state,
        phase: "unknown",
        message: "This didn't finish. Check your Library in a minute.",
      };
    case "done":
      return { phase: "done", message: null, resultUrl: event.url, resultGenId: event.genId };
    case "clear-message":
      return { ...state, message: null };
    case "reset":
      return initialTemplateRunState();
  }
}

export type TemplatePollOutcome =
  | { kind: "done"; url: string; genId: string }
  | { kind: "failed" }
  | { kind: "unknown" };

type TemplateStartOutcome =
  | { kind: "started"; id: string }
  | { kind: "explicit-error"; message: string }
  | { kind: "unknown" };

export async function startTemplateJob(
  request: unknown,
  starter: (request: unknown) => ReturnType<typeof startGen> = startGen,
): Promise<TemplateStartOutcome> {
  try {
    const started = await starter(request);
    return "error" in started
      ? { kind: "explicit-error", message: started.error }
      : { kind: "started", id: started.id };
  } catch {
    return { kind: "unknown" };
  }
}

type TemplateJobSnapshot = {
  status: string;
  urls: string[];
  generationIds: string[];
};

export async function pollTemplateJob(
  jobId: string,
  options: {
    lookup?: (jobId: string) => Promise<TemplateJobSnapshot | null>;
    wait?: () => Promise<void>;
    attempts?: number;
    isCancelled?: () => boolean;
  } = {},
): Promise<TemplatePollOutcome> {
  const lookup = options.lookup ?? getGenJob;
  const wait = options.wait ?? (() => new Promise((resolve) => setTimeout(resolve, 1500)));
  const isCancelled = options.isCancelled ?? (() => false);

  for (let i = 0; i < (options.attempts ?? 60); i++) {
    if (isCancelled()) return { kind: "unknown" };
    try {
      await wait();
    } catch {
      return { kind: "unknown" };
    }
    if (isCancelled()) return { kind: "unknown" };
    let job: TemplateJobSnapshot | null;
    try {
      job = await lookup(jobId);
    } catch {
      return { kind: "unknown" };
    }
    if (isCancelled()) return { kind: "unknown" };
    if (!job) return { kind: "unknown" };
    if (job.status === "DONE") {
      const url = job.urls[0];
      const genId = job.generationIds[0];
      return url && genId ? { kind: "done", url, genId } : { kind: "unknown" };
    }
    if (job.status === "FAILED") {
      return job.generationIds.length === 0 && job.urls.length === 0
        ? { kind: "failed" }
        : { kind: "unknown" };
    }
  }
  return { kind: "unknown" };
}

export default function TemplateModal({
  template,
  projectId,
  entities = [],
  onClose,
}: {
  template: Template;
  projectId: string;
  entities?: EntityDTO[];
  onClose: () => void;
}) {
  const cancelledRef = useRef(false);
  const inFlightRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  const [uploading, setUploading] = useState(false);
  const [sourceGenId, setSourceGenId] = useState<string | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [run, dispatchRun] = useReducer(templateRunReducer, initialTemplateRunState());
  const { phase, message, resultUrl, resultGenId } = run;
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    dispatchRun({ type: "clear-message" });
    setUploading(true);
    try {
      const outcome = await uploadFilesDirect([file], () => {});
      const res = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in res) {
        dispatchRun({ type: "explicit-error", message: res.error });
      } else if (res.generationIds.length === 0) {
        dispatchRun({ type: "explicit-error", message: "Upload failed — please try another image." });
      } else {
        setSourceGenId(res.generationIds[0]);
        setThumbUrl(URL.createObjectURL(file));
        setConfirming(false);
      }
    } catch {
      dispatchRun({ type: "explicit-error", message: "Upload failed — please try again." });
    } finally {
      setUploading(false);
    }
  }

  const canGenerate =
    !uploading && !!sourceGenId && (!template.question || answer.trim().length > 0) && isTemplatePaidConfirmAvailable(run);

  useEffect(() => {
    idempotencyKeyRef.current = null;
  }, [template.id, sourceGenId, answer]);

  function templateRunKey() {
    const safeTemplateId = template.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "template";
    const runId = typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12);
    idempotencyKeyRef.current ??= `tpl:${safeTemplateId}:${runId}`;
    return idempotencyKeyRef.current;
  }

  async function onGenerate() {
    if (!sourceGenId || !isTemplatePaidConfirmAvailable(run) || inFlightRef.current) return;
    inFlightRef.current = true;
    setConfirming(false);
    dispatchRun({ type: "start" });
    try {
      let image: string;
      let prompt: string;
      try {
        ({ image } = await getActiveGenModels());
        prompt = buildTemplatePrompt(template, answer);
      } catch {
        if (!cancelledRef.current) {
          dispatchRun({ type: "explicit-error", message: "Couldn't prepare this generation. Please try again." });
        }
        return;
      }

      const started = await startTemplateJob({
        projectId,
        kind: "image",
        sourceGenerationId: sourceGenId,
        prompt,
        model: image,
        count: 1,
        idempotencyKey: templateRunKey(),
      });
      // Announce before branching: an "unknown" start is outcome-unknown, not proven-free
      // — the job may already be reserved (#550).
      notifyBalanceRefresh();
      if (cancelledRef.current) return;
      if (started.kind === "unknown") {
        dispatchRun({ type: "unknown" });
        return;
      }
      if (started.kind === "explicit-error") {
        dispatchRun({ type: "explicit-error", message: started.message });
        return;
      }
      const out = await pollTemplateJob(started.id, { isCancelled: () => cancelledRef.current });
      if (cancelledRef.current) return;
      if (out.kind === "failed") {
        dispatchRun({ type: "failed" });
      } else if (out.kind === "unknown") {
        dispatchRun({ type: "unknown" });
      } else {
        dispatchRun({ type: "done", url: out.url, genId: out.genId });
      }
    } finally {
      inFlightRef.current = false;
      // …and again once the run leaves, so the settle/refund shows too.
      notifyBalanceRefresh();
    }
  }

  const costLabel = creditsLabel(templateRunCredits());

  const footer =
    phase === "done" ? (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDetailOpen(true)}>Open in detail</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { idempotencyKeyRef.current = null; dispatchRun({ type: "reset" }); }}>Make another</Button>
        <Button type="button" variant="brand" size="sm" onClick={onClose}>Close</Button>
      </>
    ) : phase === "generating" ? (
      <Button type="button" variant="brand" size="sm" disabled>
        Generating…
      </Button>
    ) : phase === "unknown" ? (
      <Button type="button" variant="secondary" size="sm" onClick={onClose}>Close</Button>
    ) : confirming ? (
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 text-[0.8125rem] text-muted-foreground">
          Cost: {costLabel}. No charge until you confirm.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Back
          </Button>
          <Button type="button" variant="brand" size="sm" disabled={!canGenerate} onClick={onGenerate}>
            Confirm generate · {costLabel}
          </Button>
        </div>
      </div>
    ) : (
      <Button type="button" variant="brand" size="sm" disabled={!canGenerate} onClick={() => setConfirming(true)}>
        Review cost · {costLabel}
      </Button>
    );

  if (detailOpen && resultGenId) {
    return (
      <DetailPanel
        generationId={resultGenId}
        projectId={projectId}
        entities={entities}
        onClose={() => setDetailOpen(false)}
      />
    );
  }

  return (
    <>
      {/* leading-[1.5] — design-baseline body line-height (Analytics standard) */}
      <Dialog open onOpenChange={(isOpen: boolean) => { if (!isOpen) onClose(); }}>
        <DialogContent className="gb leading-[1.5]">
          <DialogHeader>
            <DialogTitle>{template.name}</DialogTitle>
            {template.description && (
              <DialogDescription>{template.description}</DialogDescription>
            )}
          </DialogHeader>

          {phase === "done" && resultUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resultUrl} alt="result" style={{ width: "100%", borderRadius: "14px", display: "block" }} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <span className="text-[0.8125rem] text-muted-foreground">Product image</span>
                {thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbUrl} alt="upload" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: "14px" }} />
                ) : (
                  <input type="file" accept="image/*" onChange={onPickFile} disabled={uploading} />
                )}
                {uploading && <span className="text-[0.75rem] text-muted-foreground">Uploading…</span>}
              </label>
              {template.question && (
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span className="text-[0.8125rem] text-muted-foreground">{template.question.label}</span>
                  <Input value={answer} onChange={(e) => { setAnswer(e.target.value); setConfirming(false); }} placeholder={template.question.placeholder} />
                </label>
              )}
              {message && (
                <div
                  role="alert"
                  className="rounded-[14px] bg-error-soft px-3 py-2 text-[13px] font-medium leading-[18px] text-[var(--error-soft-foreground)]"
                >
                  {message}
                </div>
              )}
            </div>
          )}

          <DialogFooter>{footer}</DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
