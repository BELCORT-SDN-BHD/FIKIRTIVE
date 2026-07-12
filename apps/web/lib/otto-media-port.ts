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
 * $0 by construction: nothing here touches startGen / reserveCredits / the provider.
 *  - media:  list/organize already-produced generations (attach/detach to shots, delete or
 *            discard, cancel a still-QUEUED job — which only ever REFUNDS, never charges).
 *  - render: export the SAVED cut (ffmpeg concat, "re-rendering is free") and $0 captions
 *            (whisper.cpp) — no gen job, no spend.
 *  - mediaImport: bring an image/video into the project FROM A URL — the server-side analogue
 *            of the browser direct-upload chain (direct-upload.ts): SSRF-guarded fetch →
 *            storage.put → the SAME finalizeCandidateUploads authority the human upload lands
 *            through (Asset upsert + Generation(source:UPLOAD) + ingest verify). No spend.
 *
 * NOT an action surface: no "use server", not *-actions — the parity scanner must not
 * discover this module (its capabilities are the manifest entries of the wrapped actions).
 */
import { prisma } from "@fikirtive/db";
import { assertPublicHttpUrlResolved } from "@fikirtive/core/server";
import { uploadExtFromFilename, UPLOAD_SINGLE_MAX_BYTES } from "@fikirtive/core";
import { storage } from "@/lib/storage";
import {
  getEditorMedia,
  loadMoreMedia,
  attachGeneration,
  detachGeneration,
  deleteGeneration,
  softDeleteGeneration,
  startRender,
  getRenderJobs,
  startCaption,
  getCaptionJob,
  getTranscript,
} from "./actions";
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
// ctx.render — media-editor export + $0 captions
// ---------------------------------------------------------------------------
export function makeOttoRenderPort(ownerId: string, projectId: string) {
  return {
    export: async () => {
      // Otto renders the SAVED cut (Project.editJson). Authoring the timeline is VISUAL
      // (saveProjectEdit/addSegmentToCut are exempt); Otto exports what the user built.
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId, deletedAt: null },
        select: { editJson: true },
      });
      if (!project) return { error: "Project not found." };
      if (!project.editJson) return { error: "There's no saved cut to export yet — build one in the editor first." };
      return startRender(projectId, JSON.stringify(project.editJson));
    },
    jobs: () => getRenderJobs(projectId),
    caption: (src: string) => startCaption(projectId, src),
    captionJob: (jobId: string) => getCaptionJob(jobId),
    transcript: (src: string) => getTranscript(projectId, src),
  };
}

// ---------------------------------------------------------------------------
// ctx.mediaImport — bring external media into the project from a URL ($0)
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
    ): Promise<{ ok: true; generationId: string } | { error: string }> => {
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
      return { ok: true, generationId };
    },
  };
}
