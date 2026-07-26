/**
 * Caption handler ($0 — whisper.cpp transcription, NEVER fal/gen).
 *
 * Pipeline: probe asset → (audio gate) → ffmpeg extract 16kHz mono WAV →
 * whisper-cli → JSON → CaptionCue[] → content-hash-keyed Transcript cache.
 * The RENDER job consumes the (possibly-edited) captions from the contract and
 * burns them in; this job ONLY transcribes + caches (no MP4, no spend).
 *
 * Control flow copies render.ts EXACTLY (atomic claim, retry-aware
 * FAILED-vs-requeue, tmpdir cleanup) — but NOT the gen/refgen exactly-once-spend
 * machinery (no spent/committed markers): whisper is $0, so a re-run is free.
 *
 * WORKER-SAFETY: every ffmpeg/whisper call is bounded — thread cap, duration
 * double-cap (ffmpeg -t AND whisper-cli -d), execa timeout on both. The queue's
 * expireInSeconds (15m) > whisper timeout (10m); STALE_MS (13m) between, so a
 * crashed transcribe is both redelivered AND re-claimable, never duplicated.
 */
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import { prisma } from "@fikirtive/db";
import { runAsTenant } from "@fikirtive/db/principal";
import { storage } from "../storage.js";
import { sanitizeError, scrubUrls } from "../redact.js";
import {
  captionCue,
  CAPTION_RETRY_LIMIT,
  MAX_CAPTIONS,
  newId,
  storageKey,
  type CaptionJobData,
  type CaptionCue,
} from "@fikirtive/core";
import { probeFile } from "./ingest.js";

const WHISPER_MODEL_PATH = process.env.WHISPER_MODEL_PATH ?? "/opt/whisper/models/ggml-base.en.bin";
const WHISPER_MODEL_NAME = "base.en"; // cache key dimension
const WHISPER_THREADS = Math.max(1, Math.min(8, Number(process.env.WHISPER_THREADS ?? 4)));
const WHISPER_MAX_SECONDS = Math.max(1, Number(process.env.WHISPER_MAX_SECONDS ?? 600));
const WHISPER_TIMEOUT_MS = 1000 * 60 * 10; // = render's ffmpeg magnitude; < expire (15m)
const EXTRACT_TIMEOUT_MS = 60_000; // like probeFile
const STALE_MS = 1000 * 60 * 13; // > whisper timeout, < expire (same invariant as render)

/** whisper-cli -oj emits { transcription: [{ offsets: { from, to }, text }] }
 *  with offsets in MILLISECONDS. */
interface WhisperJson {
  transcription?: Array<{ offsets?: { from?: number; to?: number }; text?: string }>;
}

export async function handleCaption(data: CaptionJobData, retryCount = 0): Promise<void> {
  const job = await prisma.captionJob.findUnique({ where: { id: data.captionJobId } });
  if (!job) {
    console.error(`[caption] job row ${data.captionJobId} missing — dropping`);
    return;
  }
  if (job.status === "DONE") return; // idempotent re-delivery

  // #463: the payload carries only the job id — the tenant is knowable only after the row
  // load above. Note the Transcript cache below is reached by a tenant-free unique key
  // (contentHash+model); the scope names the owner, it does not change that lookup.
  await runAsTenant(job.ownerId, async () => {
    // CACHE SHORT-CIRCUIT: a re-request for the same audio bytes + model reuses the
    // cached transcript for $0 + 0 CPU. Whisper is deterministic for fixed inputs.
    const cached = await prisma.transcript.findUnique({
      where: { contentHash_model: { contentHash: job.contentHash, model: WHISPER_MODEL_NAME } },
    });
    if (cached) {
      await prisma.captionJob.update({
        where: { id: job.id },
        data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "" },
      });
      return;
    }

    // atomic claim: take a QUEUED job, or RE-take a RENDERING one whose attempt is
    // long past the whisper/expire window (a crashed transcribe — re-running is
    // free, no spend). A redelivery while another worker is actively transcribing
    // loses the claim and exits, so it can't start a 2nd whisper or flip DONE.
    const claim = await prisma.captionJob.updateMany({
      where: {
        id: job.id,
        OR: [
          { status: "QUEUED" },
          { status: "RENDERING", startedAt: { lt: new Date(Date.now() - STALE_MS) } },
        ],
      },
      data: { status: "RENDERING", progress: 5, startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 0) return; // another delivery owns it (active transcribe or settled)

    const work = path.join(tmpdir(), `fikirtive-caption-${job.id}`);
    try {
      await mkdir(work, { recursive: true });

      // resolve the source asset → local file (or presigned URL ffmpeg range-reads)
      const asset = await prisma.asset.findUnique({ where: { id: job.assetId } });
      if (!asset) throw new Error(`caption asset ${job.assetId} missing`);
      const file = await storage.ffmpegInput(storageKey(asset.ownerId, asset.contentHash, asset.ext));

      // audio gate: a silent/video-only clip has nothing to transcribe. Cache an
      // EMPTY transcript so it is treated as DONE and never retried.
      const probe = await probeFile(file);
      if (!probe.hasAudio) {
        await prisma.transcript.upsert({
          where: { contentHash_model: { contentHash: job.contentHash, model: WHISPER_MODEL_NAME } },
          update: { cuesJson: [] },
          create: {
            id: newId(),
            ownerId: job.ownerId,
            contentHash: job.contentHash,
            model: WHISPER_MODEL_NAME,
            cuesJson: [],
          },
        });
        await prisma.captionJob.updateMany({
          where: { id: job.id, status: "RENDERING" },
          data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "" },
        });
        return;
      }

      // bounded duration: cap at the configured ceiling AND the actual clip length.
      const maxS = Math.min(WHISPER_MAX_SECONDS, probe.durationS ?? WHISPER_MAX_SECONDS);

      // STEP 1 — extract 16kHz mono PCM WAV (bounded by -t + execa timeout).
      const wav = path.join(work, "audio.wav");
      await execa(
        "ffmpeg",
        ["-nostdin", "-y", "-i", file, "-t", String(maxS), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", wav],
        { timeout: EXTRACT_TIMEOUT_MS },
      );

      // STEP 2 — transcribe (bounded thread + duration + execa timeout).
      const outBase = path.join(work, "transcript");
      await execa(
        "whisper-cli",
        [
          "-m", WHISPER_MODEL_PATH,
          "-f", wav,
          "-l", "en",
          "-t", String(WHISPER_THREADS),
          "-d", String(Math.round(maxS * 1000)),
          "-ml", "1",
          "-sow",
          "-oj",
          "-of", outBase,
          "--no-prints",
        ],
        { timeout: WHISPER_TIMEOUT_MS, cwd: work },
      );

      // parse whisper JSON → CaptionCue[], policing every entry through the contract.
      const raw = JSON.parse(await readFile(`${outBase}.json`, "utf8")) as WhisperJson;
      const cues: CaptionCue[] = [];
      for (const entry of raw.transcription ?? []) {
        if (cues.length >= MAX_CAPTIONS) break;
        const text = (entry.text ?? "").trim();
        if (!text) continue;
        const from = Math.max(0, Math.round(entry.offsets?.from ?? 0));
        const to = Math.round(entry.offsets?.to ?? 0);
        const lengthMs = Math.max(1, to - from);
        const parsed = captionCue.safeParse({ startMs: from, lengthMs, text });
        if (parsed.success) cues.push(parsed.data);
      }

      // upsert the cache (content-hash + model keyed → reused for $0 on re-render).
      await prisma.transcript.upsert({
        where: { contentHash_model: { contentHash: job.contentHash, model: WHISPER_MODEL_NAME } },
        update: { cuesJson: cues },
        create: {
          id: newId(),
          ownerId: job.ownerId,
          contentHash: job.contentHash,
          model: WHISPER_MODEL_NAME,
          cuesJson: cues,
        },
      });

      await prisma.captionJob.updateMany({
        where: { id: job.id, status: "RENDERING" },
        data: { status: "DONE", progress: 100, finishedAt: new Date(), error: "" },
      });
      console.log(`[caption] ${job.id}: DONE → ${cues.length} cues cached (${job.contentHash.slice(0, 12)}…)`);
    } catch (err) {
      // PERSISTED error must never carry the whisper/ffmpeg argv (it contains the
      // presigned source URL + signature) — it surfaces verbatim in the admin UI.
      const safe = sanitizeError(err);
      // FAILED only when retries are exhausted (same delivery math as render).
      const final = retryCount >= CAPTION_RETRY_LIMIT;
      console.error(`[caption] ${job.id}: ${final ? "FAILED" : "retrying"} — ${scrubUrls(err instanceof Error ? err.message : String(err)).slice(0, 1000)}`);
      await prisma.captionJob.update({
        where: { id: job.id },
        data: final
          ? { status: "FAILED", error: safe, finishedAt: new Date() }
          : { status: "QUEUED", error: safe, progress: 0 },
      });
      // rethrow a SANITIZED error: pg-boss serializes the thrown error into its own
      // job.output column, so throwing the raw `err` would re-leak the argv/URL there.
      throw new Error(safe); // pg-boss owns the retry schedule
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
}
