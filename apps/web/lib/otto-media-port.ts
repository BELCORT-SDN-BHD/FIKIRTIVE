import "server-only";
/**
 * makeOttoMediaPort / makeOttoRenderPort / makeOttoMediaImportPort — the ctx.media /
 * ctx.render / ctx.mediaImport port factories (W-B3-B, media-editor + asset-viewer $0).
 *
 * Each wraps the SAME owner-gated $0 server actions the human media UI uses, adding the
 * Otto-side hard line the UI doesn't need: an Otto thread is bound to exactly one project,
 * so every generation/job a mutating call names must live in THIS owner+project — a stray
 * or cross-project id is rejected loudly, never silently acted on (mirrors the #266
 * makeOttoCanvasPort discipline).
 *
 * No generation here: nothing in this file touches startGen / reserveCredits / the provider.
 *  - media:  list/organize already-produced generations (attach/detach to shots, delete or
 *            discard, cancel a still-QUEUED job — which only ever REFUNDS, never charges). $0.
 *  - render: build and export the cut — join clips into one video, put a clip's words on
 *            screen, lay music under it (edit-desk-actions.ts, the SAME functions the
 *            merchant's own edit desk calls), plus export (ffmpeg concat, "re-rendering is
 *            free") and $0 captions (whisper.cpp). No gen job, no spend.
 *  - mediaImport: bring an image/video into the project FROM A URL — the server-side analogue
 *            of the browser direct-upload chain (direct-upload.ts): SSRF-guarded fetch →
 *            storage.put → the SAME finalizeCandidateUploads authority the human upload lands
 *            through (Asset upsert + Generation(source:UPLOAD) + ingest verify).
 *
 *            **NOT $0 downstream, and this file used to claim it was** (MONEY-A9, 规格 §7.3).
 *            The import itself still spends nothing — but the row it lands is an
 *            `Generation(source:"UPLOAD")` image/video, and since Founder's 2026-08-31 ruling
 *            every one of those is auto-understood and CHARGED at the price snapshotted the
 *            moment it lands. Inheriting the human upload's authority means inheriting the
 *            human upload's bill. So this port quotes that price back to Otto (`note` on the
 *            success result) the way the three upload UIs show it before a merchant picks a
 *            file: 披露先于扣费, on the action layer because there is no UI here to put it on.
 *
 * NOT an action surface: no "use server", not *-actions — the parity scanner must not
 * discover this module (its capabilities are the manifest entries of the wrapped actions).
 */
import { prisma } from "@fikirtive/db";
import { assertPublicHttpUrlResolved } from "@fikirtive/core/server";
import { uploadExtFromFilename, UPLOAD_SINGLE_MAX_BYTES, understandingKindForMime } from "@fikirtive/core";
import { displayCredits, pricedUnderstandingCredits } from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";
import { storage } from "@/lib/storage";
import {
  getEditorMedia,
  loadMoreMedia,
  attachGeneration,
  detachGeneration,
  deleteGeneration,
  softDeleteGeneration,
  getRenderJobs,
  startCaption,
  getCaptionJob,
  getTranscript,
} from "./actions";
import {
  getEditDesk,
  joinClipsIntoCut,
  setCutMusic,
  clearCutMusic,
  addCaptionsToClip,
  clearCutCaptions,
  exportSavedCut,
} from "./edit-desk-actions";
import { finalizeCandidateUploads } from "./upload-actions";
import { cancelGenJob } from "./cowork-actions";

// ---------------------------------------------------------------------------
// ctx.media — asset-viewer / library lifecycle ($0)
// ---------------------------------------------------------------------------
export function makeOttoMediaPort(ownerId: string, projectId: string) {
  /** Project binding: true only when the generation exists in THIS owner+project. */
  const genInProject = async (id: string): Promise<boolean> => {
    const g = await prisma.generation.findFirst({ where: { id, ownerId, projectId }, select: { id: true } });
    return !!g;
  };
  return {
    list: () => getEditorMedia(projectId),
    loadMore: (cursor?: string | null) => loadMoreMedia(projectId, cursor ?? null),
    attach: async (generationId: string, shotId: string) => {
      if (!(await genInProject(generationId))) return { error: "That generation isn't in this project." };
      const r = await attachGeneration(generationId, shotId);
      return "error" in r ? r : { ok: true as const };
    },
    detach: async (generationId: string) => {
      if (!(await genInProject(generationId))) return { error: "That generation isn't in this project." };
      const r = await detachGeneration(generationId);
      return "error" in r ? r : { ok: true as const };
    },
    remove: async (generationId: string) => {
      if (!(await genInProject(generationId))) return { error: "That generation isn't in this project." };
      const r = await deleteGeneration(generationId);
      return "error" in r ? r : { ok: true as const };
    },
    discard: async (generationId: string) => {
      if (!(await genInProject(generationId))) return { error: "That generation isn't in this project." };
      const r = await softDeleteGeneration(generationId);
      return "error" in r ? r : { ok: true as const };
    },
    cancelJob: async (jobId: string) => {
      const job = await prisma.genJob.findFirst({ where: { id: jobId, ownerId, projectId }, select: { id: true } });
      if (!job) return { error: "That job isn't in this project." };
      return cancelGenJob({ jobId });
    },
  };
}

// ---------------------------------------------------------------------------
// ctx.render — build the cut, export it, $0 captions
// ---------------------------------------------------------------------------
/** `ownerId` is intentionally still in the signature (and unused): every function below is an
 *  owner-gated action that resolves the owner from the SESSION, never from an argument — a port
 *  that passed an owner in would be a second, weaker answer to "whose video is this?". Kept so
 *  the three port factories are called identically at the one wiring site (otto-actions.ts). */
export function makeOttoRenderPort(_ownerId: string, projectId: string) {
  return {
    // #780 — the three merchant-sized moves the engine always supported and nobody could
    // reach: join, captions, music. They are THE SAME functions the merchant's own edit desk
    // calls (edit-desk-actions.ts), pre-bound to this owner+project, so "Otto, join these
    // three and caption them" and doing it by hand produce one cut, not two rival ones.
    // Free-hand timeline JSON (saveProjectEdit) stays out of Otto's reach — that is authoring
    // by coordinates, which belongs to the visual desk.
    desk: () => getEditDesk(projectId),
    join: (srcs: string[]) => joinClipsIntoCut(projectId, srcs),
    music: (src: string) => setCutMusic(projectId, src),
    clearMusic: () => clearCutMusic(projectId),
    addCaptions: (src: string) => addCaptionsToClip(projectId, src),
    clearCaptions: () => clearCutCaptions(projectId),
    // Otto exports the SAVED cut — whatever the desk and `join` above have agreed on. The read
    // of that cut lives in the action (exportSavedCut), not here, so the merchant's Export
    // button and Otto's export cannot drift into rendering two different things.
    export: () => exportSavedCut(projectId),
    jobs: () => getRenderJobs(projectId),
    caption: (src: string) => startCaption(projectId, src),
    captionJob: (jobId: string) => getCaptionJob(jobId),
    transcript: (src: string) => getTranscript(projectId, src),
  };
}

// ---------------------------------------------------------------------------
// ctx.mediaImport — bring external media into the project from a URL
// (the fetch/store is $0; the imported asset is then auto-understood and charged — MONEY-A9)
// ---------------------------------------------------------------------------
/** Single-shot import ceiling. Larger files need the app's chunked (multipart) upload. */
const IMPORT_MAX_BYTES = UPLOAD_SINGLE_MAX_BYTES; // 64 MiB

/** content-type → candidate ext (re-validated through the canonical deriver below). */
const CT_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** Derive a valid upload ext from the URL path, falling back to the content-type header.
 *  Everything routes through uploadExtFromFilename so only exts the upload contract accepts
 *  are ever returned (an unknown type yields null → honest refusal, never a bad row). */
function extFromUrlOrType(rawUrl: string, contentType: string | null): string | null {
  try {
    const fromPath = uploadExtFromFilename(new URL(rawUrl).pathname);
    if (fromPath) return fromPath;
  } catch {
    /* fall through to content-type */
  }
  const ct = contentType?.split(";")[0]?.trim().toLowerCase();
  const guess = ct ? CT_EXT[ct] : undefined;
  return guess ? uploadExtFromFilename(`file.${guess}`) : null;
}

function filenameFromUrl(rawUrl: string, ext: string): string {
  try {
    const base = new URL(rawUrl).pathname.split("/").filter(Boolean).pop();
    if (base && base.length <= 200) return base;
  } catch {
    /* fall through */
  }
  return `import.${ext}`;
}

/** The video exts THIS file already declares (derived from CT_EXT, never a second list) —
 *  the fallback when a server sends bytes with no usable content-type. */
const VIDEO_EXTS = new Set(
  Object.entries(CT_EXT)
    .filter(([contentType]) => contentType.startsWith("video/"))
    .map(([, ext]) => ext),
);

/**
 * MONEY-A9 §7.3 — the **动作前报价** for a URL import: what Otto must tell the merchant
 * before/with the import, because this path has no UI to hang the shared hint on.
 *
 * Same source as every other quote in the product (`pricedUnderstandingCredits`), so the
 * number Otto says and the number the ledger takes cannot drift; nothing is typed by hand.
 * Which kind runs is `understandingKindForMime`, the same router the ingest uses — with the
 * file's derived ext as the fallback when the origin sent no usable content-type.
 *
 * The cascade clause (计费四则②) is added for images only: the second, doc-extract charge is
 * triggered by the caption's `isDocument`, so a video genuinely cannot incur it and promising
 * otherwise would be its own small lie.
 */
function importUnderstandingQuote(ext: string, contentType: string | null): string {
  const kind =
    understandingKindForMime(contentType ?? "") ?? (VIDEO_EXTS.has(ext) ? "video-qa" : "image-caption");
  const price = (k: typeof kind | "doc-extract") =>
    creditsLabel(displayCredits(pricedUnderstandingCredits(k)));
  const cascade =
    kind === "image-caption"
      ? ` If it turns out to be a menu or price list, reading it as a document costs ${price("doc-extract")} more.`
      : "";
  return `Imported. It is read automatically so Otto knows what is in it: ${price(kind)}, charged at the price locked in on upload.${cascade}`;
}

/** SSRF-hardened media byte fetch — reuses the exact public-only resolver the research /
 *  product-ingest ports use (assertPublicHttpUrlResolved), with redirect:"error", a timeout,
 *  and a hard size ceiling (Content-Length pre-check AND post-read cap). */
async function fetchMediaBytes(
  rawUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string | null } | { error: string }> {
  let url: URL;
  try {
    url = await assertPublicHttpUrlResolved(rawUrl);
  } catch {
    return { error: "That URL isn't a reachable public http(s) address." };
  }
  let response: Response;
  try {
    response = await fetch(url.href, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { "user-agent": "FikirtiveBot/1.0" },
    });
  } catch {
    return { error: "Couldn't download that URL." };
  }
  if (!response.ok) return { error: `That URL returned ${response.status}.` };
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > IMPORT_MAX_BYTES) {
    return { error: "That file is too large to import from a URL (over 64 MiB) — upload it in the app instead." };
  }
  const buf = await response.arrayBuffer();
  if (buf.byteLength === 0) return { error: "That URL had no file to import." };
  if (buf.byteLength > IMPORT_MAX_BYTES) {
    return { error: "That file is too large to import from a URL (over 64 MiB) — upload it in the app instead." };
  }
  return { bytes: new Uint8Array(buf), contentType: response.headers.get("content-type") };
}

export function makeOttoMediaImportPort(ownerId: string, projectId: string) {
  return {
    fromUrl: async (
      rawUrl: string,
      opts?: { promptText?: string; entityIds?: string[] },
      // `note` = the understanding quote (MONEY-A9 §7.3). It rides on the SUCCESS result so
      // Otto has something true to say the moment the file lands; the port stays structurally
      // compatible with the narrower `ctx.mediaImport` contract in packages/otto (extra field).
    ): Promise<{ ok: true; generationId: string; note: string } | { error: string }> => {
      const fetched = await fetchMediaBytes(rawUrl);
      if ("error" in fetched) return fetched;
      const ext = extFromUrlOrType(rawUrl, fetched.contentType);
      if (!ext) {
        return { error: "Couldn't tell what kind of file that URL is (need a png/jpg/webp/gif/avif/mp4/mov/webm)." };
      }
      // Bytes to storage first, then hand the receipt to the SAME finalize authority the human
      // direct-upload lands through (mode:"existed" — the object is already in place). Finalize
      // re-checks the stored size, byte-verifies image mime, writes the Asset + Generation rows,
      // and dispatches the ingest hash-verify — all inherited, not re-implemented.
      const { contentHash } = await storage.put(ownerId, fetched.bytes, ext);
      const res = await finalizeCandidateUploads(projectId, opts?.promptText ?? "", opts?.entityIds ?? [], [
        {
          sha256: contentHash,
          ext,
          sizeBytes: fetched.bytes.byteLength,
          originalFilename: filenameFromUrl(rawUrl, ext),
          upload: { mode: "existed" as const },
        },
      ]);
      if ("error" in res) return { error: res.error };
      const generationId = res.generationIds[0];
      if (!generationId) return { error: res.failures[0]?.reason ?? "That file couldn't be imported." };
      return { ok: true, generationId, note: importUnderstandingQuote(ext, fetched.contentType) };
    },
  };
}
