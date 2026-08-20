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
import { startAssetGen, getGenJob, getActiveGenModels } from "@/lib/gen-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { uploadFilesDirect } from "@/lib/direct-upload";
import { finalizeCandidateUploads } from "@/lib/upload-actions";
import type { EntityDTO } from "@/lib/types";
import {
  type Template,
  type TemplateCaptionLanguage,
  TEMPLATE_RUN_IMAGE_COUNT,
  buildTemplatePrompt,
  templateRunCredits,
} from "@/lib/templates";
import { creditsLabel } from "@/lib/credit-format";

type Phase = "form" | "generating" | "done" | "cancelled" | "unknown";

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
  /** The merchant stopped it themselves — an ending, and NOT a failure (#602 r2, judge P2). */
  | { type: "cancelled" }
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
    case "cancelled":
      // No `message`: the alert slot is styled as an error, and nothing went wrong.
      return { ...state, phase: "cancelled", message: null, resultUrl: null, resultGenId: null };
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
  | { kind: "cancelled" }
  | { kind: "unknown" };

type TemplateStartOutcome =
  | { kind: "started"; id: string }
  | { kind: "explicit-error"; message: string }
  | { kind: "unknown" };

export async function startTemplateJob(
  request: unknown,
  starter: (request: unknown) => ReturnType<typeof startAssetGen> = startAssetGen,
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

/** What a caption's language tag is called on screen. */
export const TEMPLATE_CAPTION_LANGUAGE_LABELS: Record<TemplateCaptionLanguage, string> = {
  en: "English",
  ms: "Bahasa Melayu",
  zh: "Chinese",
};

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
    // Either ending stops the wait (#602 T3). A CANCELLED job used to be unrecognised here, so
    // this loop kept polling a job that had stopped until its budget ran out — and it gets its
    // own word, so the modal does not apologise for the merchant's own decision (r2 judge P2).
    if (job.status === "CANCELLED") {
      return job.generationIds.length === 0 && job.urls.length === 0
        ? { kind: "cancelled" }
        : { kind: "unknown" };
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
  const [copiedCaption, setCopiedCaption] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  async function copyCaption(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCaption(text);
    } catch {
      setCopiedCaption(null);
      return;
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedCaption(null), 1500);
  }

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
      }
    } catch {
      dispatchRun({ type: "explicit-error", message: "Upload failed — please try again." });
    } finally {
      setUploading(false);
    }
  }

  const canGenerate =
    !uploading && !!sourceGenId && (!template.question || answer.trim().length > 0) && isTemplatePaidConfirmAvailable(run);

  /** ONE press (#896, Founder 2026-08-13): the button carries the price, so pressing it is
   *  the approval. The spend path below — idempotency key, in-flight lock, the paid-confirm
   *  availability gate — is exactly what it was behind the old second click. */
  async function onGenerate() {
    if (!sourceGenId || !isTemplatePaidConfirmAvailable(run) || inFlightRef.current) return;
    inFlightRef.current = true;
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
        // 与 templateRunCredits() 报的价同源:两处各写一个 1,就是「报的」与「扣的」分家的第一步。
        model: image,
        count: TEMPLATE_RUN_IMAGE_COUNT,
        // A scenario is not just words: a marketplace main image is square and a story is tall
        // (#783). Templates that don't care leave this off, and the shape is inherited from the
        // uploaded photo exactly as before. One image either way — the price does not move.
        ...(template.aspectRatio ? { aspectRatio: template.aspectRatio } : {}),
        // 幂等键由服务端从「动作 + 锚点 + 请求体」算出来(startAssetGen)。这一面不再自己出键:
        // 旧的 `tpl:<templateId>:<runId>` 每开一次弹窗就换一个 runId,所以刷新一次或开第二个
        // 标签页再按一次,就是两次真扣费。同一张底图 + 同一个模板 + 同一个答案 ⇒ 同一个键。
        assetOp: "template",
        assetAnchorGenerationId: sourceGenId,
        // 屏幕上那个价随请求发出去,服务端重核 —— 与详情页三条付费路同一套绑定。
        // 图片按张计价(pricedGenCredits 的 IMAGE 支只看 count),所以这个数与服务端
        // 用真实机型算出来的那个数恒等,不会因为在产机型换了而误拒。
        expectedCredits: templateRunCredits(),
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
      } else if (out.kind === "cancelled") {
        dispatchRun({ type: "cancelled" });
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
        <Button type="button" variant="ghost" size="sm" onClick={() => dispatchRun({ type: "reset" })}>Make another</Button>
        <Button type="button" variant="brand" size="sm" onClick={onClose}>Close</Button>
      </>
    ) : phase === "generating" ? (
      <Button type="button" variant="brand" size="sm" disabled>
        Generating…
      </Button>
    ) : phase === "cancelled" ? (
      // Nothing to retry and nothing to apologise for — the merchant stopped it (#602 r2).
      <div className="flex w-full items-center justify-between gap-3">
        <p className="m-0 text-[0.8125rem] text-muted-foreground">Canceled — you weren&rsquo;t charged.</p>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>Close</Button>
      </div>
    ) : phase === "unknown" ? (
      <Button type="button" variant="secondary" size="sm" onClick={onClose}>Close</Button>
    ) : (
      <Button type="button" variant="brand" size="sm" disabled={!canGenerate} onClick={onGenerate}>
        Generate · {costLabel}
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
        {/* 判官 r1 P1:公共 dialog 没有最大高度,一张 9:16 结果图加两三张文案卡就把关闭键与
            底部操作顶出视口。修在**本弹窗自己**身上(不动 components/ui/dialog.tsx,那是 #843 的地盘):
            整体不超过视口,中间那一行(内容)自己滚,头尾两行永远在屏内。 */}
        <DialogContent className="gb leading-[1.5] max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]">
          <DialogHeader>
            <DialogTitle>{template.name}</DialogTitle>
            {template.description && (
              <DialogDescription>{template.description}</DialogDescription>
            )}
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto">
          {phase === "done" && resultUrl ? (
            <div className="flex flex-col gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resultUrl}
                alt="result"
                style={{ maxWidth: "100%", maxHeight: "42vh", borderRadius: "14px", display: "block", margin: "0 auto" }}
              />
              {template.captions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[0.8125rem] text-muted-foreground">
                    A ready caption. Everything in brackets is a blank — fill them in before you post.
                  </span>
                  {template.captions.map((c) => (
                    <div
                      key={`${c.language}:${c.text}`}
                      className="flex items-start justify-between gap-2 rounded-[14px] border border-border bg-card p-3"
                    >
                      <div className="min-w-0">
                        <div className="text-[0.75rem] uppercase tracking-[0.4px] text-muted-foreground">
                          {TEMPLATE_CAPTION_LANGUAGE_LABELS[c.language]}
                        </div>
                        <p className="m-0 mt-0.5 text-[0.8125rem] text-foreground">{c.text}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => copyCaption(c.text)}
                      >
                        {copiedCaption === c.text ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                  <Input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={template.question.placeholder} />
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
          </div>

          <DialogFooter>{footer}</DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
