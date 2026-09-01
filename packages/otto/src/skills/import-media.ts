/**
 * importMedia — $0 media import skill (W-B3-B, parity debts 14,15,78,79,80,81,82 / E1-17 upload
 * chain; anchor A2 direct-upload).
 *
 * The Otto-side analogue of the human upload: a person drags a local file in; Otto has no local
 * filesystem, so it imports media the one way it can — from a public URL. This is the same
 * CAPABILITY (bring external media into the project) the human upload chain provides
 * (uploadCandidates / uploadReference + the direct-upload transport authorize/sign/abort/
 * finalize); the manifest maps that whole family to this skill.
 *
 * Single action layer (宪法 7 / Seam 9): the operation goes through the injected `ctx.mediaImport`
 * port — a server-side SSRF-guarded fetch (the SAME public-only resolver research/product-ingest
 * use) → storage.put → the SAME finalizeCandidateUploads authority the human upload lands through
 * (Asset upsert + Generation(source:UPLOAD) + size re-check + mime byte-verify + ingest dispatch).
 * This skill never touches Prisma, storage, or the web action files directly.
 *
 * $0 by construction: importing REFERENCES/stores bytes only — no GenJob, no reserve, no provider.
 * Turning an imported image into a video (i2v) is a separate, PAID generate call.
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext } from "../context.js";

const params = z.object({
  url: z.string().min(1).max(2000).describe("The public http(s) URL of the image or video to import."),
  promptText: z
    .string()
    .max(2000)
    .optional()
    .describe("Optional note/caption stored with the imported media (the prompt-style context)."),
  entityIds: z
    .array(z.string().min(1).max(80))
    .max(20)
    .optional()
    .describe("Optional owned entity ids to snapshot onto the import (brand/product references)."),
});

type ImportMediaInput = z.infer<typeof params>;

export async function executeImportMedia(
  input: ImportMediaInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  const mediaImport = ctx.mediaImport;
  if (!mediaImport) return { ok: false, error: "Importing media isn't available right now." };

  const r = await mediaImport.fromUrl(input.url, {
    ...(input.promptText !== undefined ? { promptText: input.promptText } : {}),
    ...(input.entityIds ? { entityIds: input.entityIds } : {}),
  });
  return "error" in r
    ? { ok: false, error: r.error }
    : { ok: true, generationId: r.generationId, ...(r.note ? { note: r.note } : {}) };
}

export const importMediaSkill = defineOttoSkill({
  name: "importMedia",
  // $0 import surface: fetches an external URL (a guarded READ) and writes OUR Asset/Generation
  // rows (the write lands internally, never mutates the outside world). free + write + internal ⇒
  // needsApproval=false — same as the human upload, which lands media without a confirm dialog;
  // the SSRF guard on the fetch is the safety boundary, not an approval gate.
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Import an image or video into the project from a public URL ($0 — never generates media or spends credits). " +
    "Use this to bring in an external reference (e.g. a link the user shared): the file is fetched, stored, " +
    "and lands in the project's media as an uploaded generation. " +
    "Supported: png/jpg/webp/gif/avif images and mp4/mov/webm video, up to 64 MiB. " +
    "To CREATE new media, use generate instead; to turn an imported image into a video, that's a paid generate.",
  parameters: params,
  requires: [{ field: "url", question: "What is the URL of the image or video to import?" }],
  execute: executeImportMedia,
});
