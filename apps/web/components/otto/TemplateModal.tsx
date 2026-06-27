"use client";
import React, { useState } from "react";
import { Dialog } from "@/components/fk/Dialog";
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
      await new Promise((r) => setTimeout(r, 1500));
      let job;
      try {
        job = await getGenJob(jobId);
      } catch {
        return null;
      }
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
        <button type="button" className="al-btn al-btn-sm" onClick={() => setDetailOpen(true)}>Open in detail</button>
        <button type="button" className="al-btn al-btn-sm" onClick={() => { setPhase("form"); setResultUrl(null); setResultGenId(null); }}>Make another</button>
        <button type="button" className="al-btn al-btn-primary al-btn-sm" onClick={onClose}>Close</button>
      </>
    ) : (
      <button type="button" className="al-btn al-btn-primary al-btn-sm" disabled={!canGenerate} onClick={onGenerate}>
        {phase === "generating" ? "Generating…" : `Generate · ${templateRunCredits()} credit`}
      </button>
    );

  return (
    <>
      <Dialog open onClose={onClose} title={template.name} description={template.description} footer={footer}>
        {phase === "done" && resultUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resultUrl} alt="result" style={{ width: "100%", borderRadius: "var(--radius-md)", display: "block" }} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Product image</span>
              {thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbUrl} alt="upload" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: "var(--radius-md)" }} />
              ) : (
                <input type="file" accept="image/*" onChange={onPickFile} disabled={uploading} />
              )}
              {uploading && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Uploading…</span>}
            </label>
            {template.question && (
              <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{template.question.label}</span>
                <input className="al-input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={template.question.placeholder} />
              </label>
            )}
            {error && <div style={{ color: "var(--danger, #d65a5a)", fontSize: 13 }}>{error}</div>}
          </div>
        )}
      </Dialog>
      {detailOpen && resultGenId && (
        <DetailPanel generationId={resultGenId} projectId={projectId} entities={entities} onClose={() => setDetailOpen(false)} />
      )}
    </>
  );
}
