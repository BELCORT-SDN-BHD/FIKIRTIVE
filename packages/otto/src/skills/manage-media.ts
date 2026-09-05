/**
 * manageMedia — $0 media library / asset-viewer skill (W-B3-B, parity debts 16,17,18,24,25,26,39
 * / B0-12 + B0-14; anchors M1 media-editor + C1 asset-viewer version track).
 *
 * Lets Otto see and organize the project's generated media: list it as timeline-ready clips,
 * page the Assets library, attach a candidate to a shot (or detach it back), soft-delete a
 * finished generation from the library or discard one from the candidate zone, and cancel a
 * still-QUEUED generation job (which only ever REFUNDS — never charges).
 *
 * Single action layer (宪法 7 / Seam 9): every operation goes through the injected `ctx.media`
 * port — thin closures over the SAME owner-gated $0 server actions the human media UI uses
 * (getEditorMedia / loadMoreMedia / attach|detach|delete|softDeleteGeneration / cancelGenJob),
 * each pre-bound to THIS owner+project. This skill never touches Prisma or the web action files.
 *
 * $0 by construction: no action here creates a GenJob, reserves credits, or calls the provider.
 * delete/discard soft-delete a FINISHED generation (a reversible tombstone, same as the human
 * UI — no model self-confirmation, 宪法 11). cancel_job cancels only a still-QUEUED job and the
 * server action refunds it atomically; a job already running reports `alreadyStarted` (no
 * double-charge, no forced stop).
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext } from "../context.js";

/** Cap the clip payload returned to the model (a busy project can hold hundreds of clips). */
export const MEDIA_LIST_CAP = 60;

const params = z.object({
  action: z.enum(["list", "load_more", "attach", "detach", "delete", "discard", "cancel_job"]),
  // load_more:
  cursor: z.string().max(200).optional().describe("load_more: the previous page's nextCursor."),
  // attach / detach / delete / discard — which generation:
  generationId: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe("attach/detach/delete/discard: the target generation id (from list)."),
  // attach — which shot:
  shotId: z.string().min(1).max(80).optional().describe("attach: the shot to attach the generation to."),
  // cancel_job — which job:
  jobId: z.string().min(1).max(80).optional().describe("cancel_job: the still-QUEUED generation job to cancel."),
});

type ManageMediaInput = z.infer<typeof params>;

export async function executeManageMedia(
  input: ManageMediaInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  const media = ctx.media;
  if (!media) return { ok: false, error: "The media library isn't available right now." };

  switch (input.action) {
    case "list": {
      const clips = await media.list();
      return {
        ok: true,
        count: clips.length,
        truncated: clips.length > MEDIA_LIST_CAP,
        clips: clips.slice(0, MEDIA_LIST_CAP),
      };
    }
    case "load_more": {
      const page = await media.loadMore(input.cursor ?? null);
      return "error" in page ? { ok: false, error: page.error } : { ok: true, ...page };
    }
    case "attach": {
      if (!input.generationId) return { ok: false, error: "attach needs `generationId`." };
      if (!input.shotId) return { ok: false, error: "attach needs `shotId`." };
      const r = await media.attach(input.generationId, input.shotId);
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
    case "detach": {
      if (!input.generationId) return { ok: false, error: "detach needs `generationId`." };
      const r = await media.detach(input.generationId);
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
    case "delete": {
      if (!input.generationId) return { ok: false, error: "delete needs `generationId`." };
      const r = await media.remove(input.generationId);
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
    case "discard": {
      if (!input.generationId) return { ok: false, error: "discard needs `generationId`." };
      const r = await media.discard(input.generationId);
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
    case "cancel_job": {
      if (!input.jobId) return { ok: false, error: "cancel_job needs `jobId`." };
      const r = await media.cancelJob(input.jobId);
      if ("error" in r) return { ok: false, error: r.error };
      // alreadyStarted is not an error — it's an honest "too late to cancel" (no refund, job runs on).
      if ("alreadyStarted" in r) return { ok: true, refunded: false, alreadyStarted: true };
      return { ok: true, refunded: true };
    }
  }
}

export const manageMediaSkill = defineOttoSkill({
  name: "manageMedia",
  // $0 library surface: reads OUR generations + writes OUR rows only (attach/detach/soft-delete),
  // and cancel_job only ever refunds a not-yet-started job. free + write + internal ⇒
  // needsApproval=false — same as the human media UI, which organizes assets without a dialog.
  cost: "free",
  effect: "write",
  reach: "internal",
  // ENGINE-A4:list / load_more 只列不改 —— 翻素材页翻到跑满步数的一轮是零交付。
  readOnlyActions: { field: "action", actions: ["list", "load_more"] },
  description:
    "See and organize the project's generated media ($0 — never generates media or spends credits). " +
    "list: media as timeline-ready clips. load_more: page the Assets library. " +
    "attach: put a candidate generation on a shot. detach: send it back to the candidate zone. " +
    "delete: soft-delete a finished generation from the library. discard: hide one from the candidate zone. " +
    "cancel_job: cancel a still-QUEUED generation job (refunds it; a job already running can't be cancelled). " +
    "To CREATE new media, use generate instead; to bring media in from a URL, use importMedia.",
  parameters: params,
  execute: executeManageMedia,
});
