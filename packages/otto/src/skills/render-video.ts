/**
 * renderVideo — $0 export + captions skill (W-B3-B, parity debts 19,20,21,22,23 / B0-13;
 * anchor M1 media-editor: export render + caption pipeline).
 *
 * Lets Otto export the project's SAVED cut to a finished video, check export progress, add
 * $0 captions to a clip, and read caption progress / the cached transcript.
 *
 * Single action layer (宪法 7 / Seam 9): every operation goes through the injected `ctx.render`
 * port — thin closures over the SAME owner-gated $0 server actions the human media-editor uses
 * (startRender / getRenderJobs / startCaption / getCaptionJob / getTranscript), pre-bound to
 * THIS owner+project. This skill never touches Prisma or the web action files.
 *
 * $0 by construction: rendering is ffmpeg concat ("re-rendering is free") and captions are
 * whisper.cpp — no GenJob, no reserve, no provider. Otto exports what the USER built: authoring
 * the timeline itself is a VISUAL editor operation (exempt), so `export` renders the SAVED cut.
 * A double-dispatch is refused by the underlying action's in-flight guard.
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext } from "../context.js";

const params = z.object({
  action: z.enum(["export", "jobs", "caption", "caption_job", "transcript"]),
  // caption / transcript — which clip (its content-addressed src, e.g. "/files/<hash>.mp4"):
  src: z.string().min(1).max(400).optional().describe("caption/transcript: the clip's content-addressed src."),
  // caption_job — which job:
  jobId: z.string().min(1).max(80).optional().describe("caption_job: the caption job id to poll."),
});

type RenderVideoInput = z.infer<typeof params>;

export async function executeRenderVideo(
  input: RenderVideoInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  const render = ctx.render;
  if (!render) return { ok: false, error: "The editor isn't available right now." };

  switch (input.action) {
    case "export": {
      const r = await render.export();
      return "error" in r ? { ok: false, error: r.error } : { ok: true, renderJobId: r.id };
    }
    case "jobs": {
      const jobs = await render.jobs();
      return { ok: true, count: jobs.length, jobs };
    }
    case "caption": {
      if (!input.src) return { ok: false, error: "caption needs `src` (the clip to caption)." };
      const r = await render.caption(input.src);
      return "error" in r ? { ok: false, error: r.error } : { ok: true, captionJobId: r.id };
    }
    case "caption_job": {
      if (!input.jobId) return { ok: false, error: "caption_job needs `jobId`." };
      const job = await render.captionJob(input.jobId);
      return job ? { ok: true, job } : { ok: false, error: "Caption job not found." };
    }
    case "transcript": {
      if (!input.src) return { ok: false, error: "transcript needs `src`." };
      const cues = await render.transcript(input.src);
      return { ok: true, count: cues.length, cues };
    }
  }
}

export const renderVideoSkill = defineOttoSkill({
  name: "renderVideo",
  // $0 export/caption surface: renders OUR saved cut + writes OUR render/caption job rows only —
  // ffmpeg/whisper on our own infra, no external side-effect. free + write + internal ⇒
  // needsApproval=false, same as the human media-editor's export/caption buttons.
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Export the project's saved cut to a video and add $0 captions ($0 — ffmpeg/whisper, never spends credits). " +
    "export: render the SAVED cut to a finished video (build the cut in the editor first). " +
    "jobs: check export progress. caption: add captions to a clip (pass its src). " +
    "caption_job: check caption progress. transcript: read a clip's cached transcript. " +
    "To CREATE new footage, use generate; to arrange the cut, that's the visual editor.",
  parameters: params,
  execute: executeRenderVideo,
});

export const renderVideo = renderVideoSkill.tool;
