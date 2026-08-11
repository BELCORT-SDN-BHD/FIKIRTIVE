/**
 * renderVideo — $0 cut-building + export + captions skill (W-B3-B, parity debts 19,20,21,22,23 /
 * B0-13; anchor M1 media-editor: export render + caption pipeline; #780 opens the building half).
 *
 * Lets Otto do with the merchant what the merchant can do alone on the edit desk: see what media
 * and what video they have, join clips into one video, put a clip's words on screen, lay music
 * under it, take either back off, export the result, and follow progress.
 *
 * Single action layer (宪法 7 / Seam 9): every operation goes through the injected `ctx.render`
 * port — thin closures over the SAME owner-gated $0 server actions the merchant's own edit desk
 * uses (edit-desk-actions: getEditDesk / joinClipsIntoCut / setCutMusic / clearCutMusic /
 * addCaptionsToClip / clearCutCaptions, plus startRender / getRenderJobs / startCaption /
 * getCaptionJob / getTranscript), pre-bound to THIS owner+project. This skill never touches
 * Prisma or the web action files, and never sees timeline JSON — placing things by coordinates
 * stays a visual job, so what Otto can do here is exactly what a merchant can ask for in words.
 *
 * $0 by construction: joining/captioning/scoring only rewrite the saved cut, rendering is ffmpeg
 * concat ("re-rendering is free") and transcription is whisper — no GenJob, no reserve, no
 * provider. A double-dispatch is refused by the underlying action's in-flight guard, and two
 * writers on one cut are settled by its optimistic-concurrency guard, never last-one-wins.
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext } from "../context.js";

const params = z.object({
  action: z.enum([
    "desk",
    "join",
    "music",
    "clear_music",
    "add_captions",
    "clear_captions",
    "export",
    "jobs",
    "caption",
    "caption_job",
    "transcript",
  ]),
  // join — which clips, in the order they should play:
  srcs: z
    .array(z.string().min(1).max(400))
    .min(1)
    .max(100)
    .optional()
    .describe("join: the clips to put together, in the order they should play (each one's src)."),
  // music / add_captions / caption / transcript — one clip (its content-addressed src, e.g. "/files/<hash>.mp4"):
  src: z
    .string()
    .min(1)
    .max(400)
    .optional()
    .describe("music/add_captions/caption/transcript: the clip's content-addressed src."),
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
    case "desk": {
      const r = await render.desk();
      return "error" in r ? { ok: false, error: r.error } : { ok: true, media: r.media, cut: r.cut };
    }
    case "join": {
      if (!input.srcs || input.srcs.length === 0) {
        return { ok: false, error: "join needs `srcs` (the clips to put together, in order)." };
      }
      const r = await render.join(input.srcs);
      return "error" in r ? { ok: false, error: r.error } : { ok: true, cut: r.cut };
    }
    case "music": {
      if (!input.src) return { ok: false, error: "music needs `src` (the audio file to lay under the video)." };
      const r = await render.music(input.src);
      return "error" in r ? { ok: false, error: r.error } : { ok: true, cut: r.cut };
    }
    case "clear_music": {
      const r = await render.clearMusic();
      return "error" in r ? { ok: false, error: r.error } : { ok: true, cut: r.cut };
    }
    case "add_captions": {
      if (!input.src) return { ok: false, error: "add_captions needs `src` (the clip whose words go on screen)." };
      const r = await render.addCaptions(input.src);
      return "error" in r ? { ok: false, error: r.error } : { ok: true, cut: r.cut };
    }
    case "clear_captions": {
      const r = await render.clearCaptions();
      return "error" in r ? { ok: false, error: r.error } : { ok: true, cut: r.cut };
    }
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
  // $0 build/export/caption surface: rewrites OUR saved cut + writes OUR render/caption job rows
  // only — ffmpeg/whisper on our own infra, no external side-effect. free + write + internal ⇒
  // needsApproval=false, the same standing as the merchant's own edit-desk buttons.
  cost: "free",
  effect: "write",
  reach: "internal",
  // WHITE LABEL (#787): the description is prompt text — Otto can repeat it to a merchant
  // verbatim, so it names the CAPABILITY (captions), never the engine behind it.
  description:
    "Build and export ONE video out of clips the merchant already has ($0 — never spends credits). " +
    "desk: see their clips and what the video holds right now. " +
    "join: put chosen clips together into one video, in the order given (pass `srcs`). " +
    "music: lay an audio file under the whole video; clear_music: take it back off. " +
    "caption: work out one clip's words (pass its `src`); caption_job: check that progress; " +
    "add_captions: once those words are ready, put them on screen; clear_captions: take them off. " +
    "export: turn the saved video into a finished file; jobs: check export progress. " +
    "transcript: read back a clip's words. " +
    "To CREATE new footage, use generate.",
  parameters: params,
  execute: executeRenderVideo,
});

export const renderVideo = renderVideoSkill.tool;
