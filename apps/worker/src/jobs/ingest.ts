/**
 * Ingest: hash re-verification + media metadata probe into the Asset row.
 *
 * Hash re-check (T4b, D19 rule 3): direct uploads name their own key with a
 * client-claimed sha256 — the worker streams the stored bytes, re-hashes,
 * and deletes mismatches (object + soft-deleted row). The claimed hash is a
 * fast-path hint only; this hash is truth.
 *
 * Idempotent by construction: hashing and probing twice write the same values.
 */
import { execa } from "execa";
import { prisma } from "@fikirtive/db";
import { runAsSystem, runAsTenant } from "@fikirtive/db/principal";
import { storageKey, sha256Stream, newId } from "@fikirtive/core";
import { storage } from "../storage.js";

export interface IngestJobData {
  assetId: string;
}

interface ProbeResult {
  durationS: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}

/** ffprobe a local file — exported for the render job (audio-stream detection). */
export async function probeFile(file: string): Promise<ProbeResult> {
  const { stdout } = await execa(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    { timeout: 60_000 },
  );
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  const duration = Number(data.format?.duration ?? video?.duration ?? NaN);
  return {
    durationS: Number.isFinite(duration) ? duration : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasAudio: Boolean(audio),
  };
}

// F41(c): finalize commits Asset+Generation BEFORE the ingest dispatch; a
// boss.send failure leaves the asset unverified (client-claimed hash, no probe
// metadata) with nothing re-dispatching it. The reaper sweep below recovers
// those: any live UPLOAD asset whose probe metadata is still all-null after the
// grace window gets its ingest re-sent. Ingest is idempotent, and the caller
// dedupes in-flight re-sends via a pg-boss singletonKey. The age ceiling stops
// a permanently-unprobeable asset (probe crashed to DLQ) re-dispatching forever.
export const INGEST_REDISPATCH_MIN_AGE_MS = 15 * 60_000;
export const INGEST_REDISPATCH_MAX_AGE_MS = 24 * 60 * 60_000;

// #463: a cross-tenant scan with a named system identity. Unlike the other reapers there is no
// per-row tenant phase — this function performs no application-domain Prisma writes, it only
// re-enqueues. Not "no writes at all": the injected `send` is `boss.send` (apps/worker/src/index.ts:256),
// which persists pg-boss queue state. That write is platform-scoped (the job table, keyed by
// singletonKey), carries no tenant column, and is why the system frame here stays `ownerId: null`.
export async function redispatchLostIngest(
  send: (assetId: string) => Promise<unknown>,
  now: Date = new Date(),
): Promise<number> {
  return runAsSystem("ingest-redispatch", async () => {
    const assets = await prisma.asset.findMany({
      where: {
        ownerId: { not: "" },
        deletedAt: null,
        // GENERATED assets never get ingest jobs (worker-computed hash, no probe)
        // — sweeping them would re-dispatch every generated image forever.
        source: "UPLOAD",
        width: null,
        height: null,
        durationS: null,
        createdAt: {
          lt: new Date(now.getTime() - INGEST_REDISPATCH_MIN_AGE_MS),
          gt: new Date(now.getTime() - INGEST_REDISPATCH_MAX_AGE_MS),
        },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 100, // per-tick bound; the next 5-min tick picks up the rest
    });
    for (const a of assets) await send(a.id);
    return assets.length;
  });
}

export async function handleIngest(data: IngestJobData): Promise<void> {
  const asset = await prisma.asset.findUnique({ where: { id: data.assetId } });
  if (!asset) {
    console.error(`[ingest] asset ${data.assetId} missing — dropping`);
    return;
  }
  if (asset.deletedAt) {
    // already removed/swept (or a prior mismatch) — nothing to verify, and
    // its object may be gone (would falsely throw the read below)
    return;
  }
  // #463: the queue payload carries only the asset id, so the tenant is knowable only after the
  // row load. The scope opens here — past the early returns, before the first write.
  await runAsTenant(asset.ownerId, async () => {
    const key = storageKey(asset.ownerId, asset.contentHash, asset.ext);

    // D19 hash re-verification: the key's hash segment is a client claim until
    // proven here. This is load-bearing security, not best-effort — a read
    // failure must THROW so pg-boss retries with backoff (a swallowed failure
    // would let a forged same-size upload survive). Only a CONFIRMED mismatch
    // deletes; transient storage errors bubble up to the queue.
    const actualHash = await sha256Stream(await storage.readStream(key));
    if (actualHash !== asset.contentHash) {
      console.error(
        `[ingest] HASH MISMATCH ${asset.id}: key claims ${asset.contentHash}, bytes are ${actualHash} — deleting`,
      );
      await storage.deleteObject(key);
      await prisma.$transaction([
        prisma.asset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } }),
        // candidates pointing at the forged blob must vanish too — read paths
        // include the asset without re-checking asset.deletedAt (codex round)
        prisma.generation.updateMany({
          where: { assetId: asset.id, deletedAt: null },
          data: { deletedAt: new Date() },
        }),
        prisma.actionEvent.create({
          data: {
            id: newId(),
            ownerId: asset.ownerId,
            type: "asset.hash_mismatch",
            payload: { assetId: asset.id, claimed: asset.contentHash, actual: actualHash },
          },
        }),
      ]);
      return;
    }

    let file: string;
    try {
      file = await storage.ffmpegInput(key);
    } catch {
      console.error(`[ingest] blob for ${asset.id} unreachable — skipping`);
      return;
    }
    const probe = await probeFile(file);
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        durationS: probe.durationS,
        width: probe.width,
        height: probe.height,
      },
    });
    console.log(
      `[ingest] ${asset.id}: ${probe.width}x${probe.height} ${probe.durationS ?? "?"}s audio=${probe.hasAudio}`,
    );
  });
}
