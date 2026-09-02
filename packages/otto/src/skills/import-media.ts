/**
 * importMedia — media import skill (W-B3-B, parity debts 14,15,78,79,80,81,82 / E1-17 upload
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
 * ── What it costs (MONEY-A9, spec docs/specs/money-engine.md §7.3) ──────────────────────────
 * The IMPORT is still $0 by construction: it stores bytes — no GenJob, no reserve, no provider.
 * What it LEAVES BEHIND is not. It lands a `source:"UPLOAD"` image/video Asset, and since
 * 2026-09-01 every such asset is read automatically and BILLED to the merchant at the price in
 * effect when the SCANNER creates the understanding row (worker `jobs/understand.ts`, at most
 * UNDERSTAND_SCAN_BATCH rows a minute) — which can be well after the import when there is a
 * backlog, so no copy here may say the price is fixed at import time. The old header line
 * here — "$0 by construction … no reserve" — was true of this call and misleading about its
 * consequence, so it is gone.
 *
 * That makes disclosure this file's job. The three human upload entries each carry a price hint
 * in the UI; a URL import is a server-side action with NO surface of its own, so the spec routes
 * its disclosure through the action layer: `ottoInstructions` tells Otto to quote the price
 * BEFORE calling this, and `otto-media-port.ts` returns the same quote with the result.
 *
 * `cost: "free"` is UNCHANGED and correct: that field is the approval router
 * (`needsApproval = cost === "spend" || …`), and it answers "does THIS CALL spend the merchant's
 * credits?" — it does not. The spec asks for disclosure here, not an approval dialog; flipping it
 * to "spend" would gate the human upload's own analogue behind a confirm the human upload has
 * never had, and would also demand an `idempotencyKey` this call has no charge to key.
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import { displayCredits, pricedUnderstandingCredits } from "@fikirtive/core";
import type { RunContext } from "@openai/agents";
import type { OttoContext } from "../context.js";

/** 价现算,不手抄 —— 同 instructions.ts 与 otto-media-port.ts,三处同源一个函数。
 *  手抄一份在工具描述里,涨价当天模型就会拿着一个旧数字去跟商家报价。 */
const IMAGE_PRICE = displayCredits(pricedUnderstandingCredits("image-caption"));
const VIDEO_PRICE = displayCredits(pricedUnderstandingCredits("video-qa"));
const DOC_PRICE = displayCredits(pricedUnderstandingCredits("doc-extract"));

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
  // This CALL spends nothing: it fetches an external URL (a guarded READ) and writes OUR
  // Asset/Generation rows (the write lands internally, never mutates the outside world).
  // free + write + internal ⇒ needsApproval=false — same as the human upload, which lands media
  // without a confirm dialog; the SSRF guard on the fetch is the safety boundary, not an approval
  // gate. The automatic understanding charge the landed asset then incurs (MONEY-A9) is disclosed,
  // not approval-gated — see the header for why this field stays "free".
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Import an image or video into the project from a public URL. " +
    "Use this to bring in an external reference (e.g. a link the user shared): the file is fetched, stored, " +
    "and lands in the project's media as an uploaded generation. " +
    "Supported: png/jpg/webp/gif/avif images and mp4/mov/webm video, up to 64 MiB. " +
    "The import call itself costs nothing to run, but what it leaves behind is billed: every imported " +
    `image or video is read automatically so Otto knows what is in it, charging the user ${IMAGE_PRICE} credits ` +
    `for an image or ${VIDEO_PRICE} credits for a video, at the price in effect when it is queued for ` +
    `understanding — which can be later than the import if there is a backlog — plus ` +
    `${DOC_PRICE} credits again if that image turns out to be a menu or price list. ` +
    "TELL THE USER THAT PRICE AND GET THEIR GO-AHEAD BEFORE CALLING THIS — there is no upload dialog here, " +
    "so this is the only place the charge can be disclosed. " +
    "To CREATE new media, use generate instead; to turn an imported image into a video, that's a paid generate.",
  parameters: params,
  requires: [{ field: "url", question: "What is the URL of the image or video to import?" }],
  execute: executeImportMedia,
});
