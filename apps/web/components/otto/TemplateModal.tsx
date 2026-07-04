"use client";
import React, { useEffect, useRef, useState } from "react";
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
import { startGen, getGenJob } from "@/lib/gen-actions";
import { uploadFilesDirect } from "@/lib/direct-upload";
import { finalizeCandidateUploads } from "@/lib/upload-actions";
import { activeImageModel } from "@fikirtive/core";
import type { EntityDTO } from "@/lib/types";
import { type Template, buildTemplatePrompt, templateRunCredits } from "@/lib/templates";

type Phase = "form" | "generating" | "done";

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
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  const [uploading, setUploading] = useState(false);
  const [sourceGenId, setSourceGenId] = useState<string | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultGenId, setResultGenId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const outcome = await uploadFilesDirect([file], () => {});
      const res = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in res) {
        setError(res.error);
      } else if (res.generationIds.length === 0) {
        setError("Upload failed — please try another image.");
      } else {
        setSourceGenId(res.generationIds[0]);
        setThumbUrl(URL.createObjectURL(file));
      }
    } catch {
      setError("Upload failed — please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function pollJob(jobId: string): Promise<{ url: string; genId: string } | null> {
    for (let i = 0; i < 60; i++) {
      if (cancelledRef.current) return null;
      await new Promise((r) => setTimeout(r, 1500));
      if (cancelledRef.current) return null;
      let job;
      try {
        job = await getGenJob(jobId);
      } catch {
        return null;
      }
      if (cancelledRef.current) return null;
      if (!job) return null;
      if (job.status === "DONE") {
        const url = job.urls[0];
        const genId = job.generationIds[0];
        return url && genId ? { url, genId } : null;
      }
      if (job.status === "FAILED") return null;
    }
    return null;
  }

  const canGenerate =
    !uploading && !!sourceGenId && (!template.question || answer.trim().length > 0) && phase === "form";

  async function onGenerate() {
    if (!sourceGenId) return;
    setError(null);
    setPhase("generating");
    const started = await startGen({
      projectId,
      kind: "image",
      sourceGenerationId: sourceGenId,
      prompt: buildTemplatePrompt(template, answer),
      model: activeImageModel(),
      count: 1,
      idempotencyKey: `tpl-${template.id}-${Date.now()}`,
    });
    if ("error" in started) {
      setError(started.error);
      setPhase("form");
      return;
    }
    const out = await pollJob(started.id);
    if (cancelledRef.current) return;
    if (!out) {
      setError("Generation failed — please try again.");
      setPhase("form");
      return;
    }
    setResultUrl(out.url);
    setResultGenId(out.genId);
    setPhase("done");
  }

  const footer =
    phase === "done" ? (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDetailOpen(true)}>Open in detail</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { setPhase("form"); setResultUrl(null); setResultGenId(null); }}>Make another</Button>
        <Button type="button" variant="brand" size="sm" onClick={onClose}>Close</Button>
      </>
    ) : (
      <Button type="button" variant="brand" size="sm" disabled={!canGenerate} onClick={onGenerate}>
        {phase === "generating" ? "Generating…" : `Generate · ${templateRunCredits()} credit`}
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
                  <Input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={template.question.placeholder} />
                </label>
              )}
              {error && <div style={{ color: "var(--destructive)", fontSize: "0.8125rem" }}>{error}</div>}
            </div>
          )}

          <DialogFooter>{footer}</DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
