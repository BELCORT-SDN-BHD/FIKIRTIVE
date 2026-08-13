/**
 * Generation provider port (Phase 2) — the model-neutral backend behind the
 * "Target chip". GENERATION_PROVIDER selects the implementation:
 *
 *   mock — deterministic solid-colour PNGs, $0, no network (dev/tracer)
 *   fal  — fal.ai sync endpoint, Seedream (prod; real money)
 *
 * The worker is the only caller. Providers download their outputs and return
 * bytes; the worker stores them content-addressed (same as any asset).
 */
import { deflateSync, crc32 } from "node:zlib";
import type { GenerationProvider, GenerationRequest, GeneratedImage, VideoRequest, GeneratedVideo, GenVideoModel } from "@fikirtive/core";
import { imageOutputSize } from "@fikirtive/core";
import { BytePlusProvider } from "./byteplus.js";
import { providerRequestGate } from "./provider-concurrency.js";

/** A tiny valid 1s mp4 (256×160 solid) the mock returns for i2v — real enough
 *  for ffprobe/the editor, no network. */
const MOCK_MP4_B64 =
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAPjbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAABI8AAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAw10cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAABI8AAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAQAAAACgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAASPAAAIAAABAAAAAAKFbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAOABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACMG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAfBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAQAAoABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAL/+EAGWdkAAus2UEBWwEQAAADABAAAAMBgPFCmWABAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAGY0AAAAAAAAAGHN0dHMAAAAAAAAAAQAAAA4AAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAACAY3R0cwAAAAAAAAAOAAAAAQAACAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAAFAAAAAABAAAIAAAAAAEAAAAAAAAAAQAABAAAAAABAAAIAAAAABxzdHNjAAAAAAAAAAEAAAABAAAADgAAAAEAAABMc3RzegAAAAAAAAAAAAAADgAAAu8AAAAQAAAADQAAAA0AAAANAAAAFgAAAA8AAAANAAAADQAAABYAAAAPAAAADQAAAA0AAAAWAAAAFHN0Y28AAAAAAAAAAQAABBMAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMAAAAAhmcmVlAAADwm1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9NSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MTIgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAA5ZYiEABD//ubA+ZZafwbc99R1oDqSugXdc8hvTiAZchoeXRuHJPHxZ4eKLPkYKAAABrAIdBw/PCh5AAAADEGaJGxBD/6qVQAEDAAAAAlBnkJ4hv8AC2kAAAAJAZ5hdEM/AA3oAAAACQGeY2pDPwAN6QAAABJBmmhJqEFomUwIf//+qZYAD7kAAAALQZ6GRREsN/8AC2kAAAAJAZ6ldEM/AA3pAAAACQGep2pDPwAN6AAAABJBmqxJqEFsmUwIb//+p4QAHzAAAAALQZ7KRRUsN/8AC2kAAAAJAZ7pdEM/AA3oAAAACQGe62pDPwAN6AAAABJBmu1JqEFsmUwIZ//+nhAAekE=";

/* ---------------- mock (deterministic, offline) ---------------- */

/** Encode a solid-colour RGB PNG at the given size — a real, decodable image with no
 *  deps beyond node:zlib. Colour derives from the seed so mock outputs are
 *  visually distinct and their hashes differ (distinct content keys). */
function solidPng(seed: number, w: number, h: number): Uint8Array {
  const r = (seed * 73) % 256;
  const g = (seed * 151) % 256;
  const b = (seed * 211) % 256;
  // raw image: each row = filter byte (0) + w*3 colour bytes
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const typeBuf = Buffer.from(type, "ascii");
    const body = Buffer.concat([typeBuf, data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  // 10,11,12 = compression/filter/interlace = 0
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(
    Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]),
  );
}

/** #642: the mock renders the real GEN_IMAGE_SIZES entry reduced to its lowest integer terms
 *  and scaled by this factor — so the offline shape is EXACT by construction (not "close"),
 *  and stays a few dozen pixels. The default square lands back on 8×8, byte-identical to the
 *  pre-#642 mock. Without a shaped mock, the fixed 8×8 square hid every shape defect from the
 *  worker/web tests, which all run on this provider. */
const MOCK_RATIO_SCALE = 8;

/** Reduce a real output size to its lowest integer terms (2880×1620 → 16×9). */
function reducedRatio(width: number, height: number): { width: number; height: number } {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(width, height) || 1;
  return { width: width / g, height: height / g };
}

export class MockProvider implements GenerationProvider {
  readonly name = "mock";
  async generate(req: GenerationRequest): Promise<GeneratedImage[]> {
    // deterministic per (prompt, conditioning, index) so a re-run is stable;
    // distinct seeds → distinct bytes → distinct content hashes
    const base = hashSeed(req.prompt + "|" + req.inputImageUrls.join(","));
    const real = imageOutputSize(req.aspectRatio);
    const ratio = reducedRatio(real.width, real.height);
    const w = ratio.width * MOCK_RATIO_SCALE;
    const h = ratio.height * MOCK_RATIO_SCALE;
    return Array.from({ length: req.count }, (_, i) => ({
      bytes: solidPng(base + i + 1, w, h),
      ext: "png",
    }));
  }
  async generateVideo(_req: VideoRequest): Promise<GeneratedVideo> {
    // a real, decodable 1s mp4 — content is the same for every mock i2v
    // (dedup is fine for tests; real fal returns distinct clips)
    return { bytes: new Uint8Array(Buffer.from(MOCK_MP4_B64, "base64")), ext: "mp4" };
  }
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100000;
}

/* ---------------- fal (prod, real money) ---------------- */

/** Mark an error the merchant's engine spend must be assumed to cover. The house
 *  rule (settled across the #664/#665 judge chain): a failure may stay PLAIN
 *  (retryable) ONLY where it is provable the engine never ran; anything already
 *  billed — or whose outcome is unknown — is a chargedError the worker must
 *  terminal-fail, because a retry re-POSTs and double-charges.
 *
 *  fal.run is a SYNC endpoint: the POST itself is the billing event (its response
 *  carries the finished asset). So on this provider only a 4xx is provably free
 *  (rate limit / validation / auth rejected the request before the model ran).
 *  A network throw on the POST is NOT free — the request may have reached the
 *  engine and run, with only the response lost — and neither is a 5xx. */
export function chargedError(message: string): Error {
  return Object.assign(new Error(message), { charged: true as const });
}

/**
 * #765 — a refusal a RETRY CANNOT FIX, carrying the sentence the merchant reads.
 *
 * Orthogonal to `charged` above, and the two answer different questions. `charged` asks "did
 * this cost money?" — a retry of a charged failure spends twice. This asks "can sending the
 * same request again ever succeed?" — the engine looked at what the merchant gave it and said
 * no, so the answer is no, forever, and the retry budget buys the merchant nothing but a longer
 * wait before the same non-answer.
 *
 * Provably free, so it is NOT charged: this only ever comes from a 4xx rejected before the
 * engine ran. The worker refunds the hold and records no spend, exactly as it does for any
 * other pre-charge failure — the only thing `permanent` changes is WHEN it gives up.
 *
 * `message` is the merchant's own sentence, already white-label (it comes from
 * `@fikirtive/core`'s gen-failure whitelist and never from the engine's reply), because the
 * worker persists this message verbatim and both merchant surfaces read it back.
 */
export function permanentInputError(message: string): Error {
  return Object.assign(new Error(message), { permanent: true as const });
}

/** The one paid POST both fal paths make, with the charge boundary applied to
 *  EVERY way it can die — image and video are the same sync endpoint shape, so
 *  they get the same yardstick from one place. Returns the ok response; the
 *  caller owns everything past it (all of which is already post-charge).
 *
 *  PLAIN (retryable) is reachable only via 4xx. Callers must not re-inspect the
 *  status: the classification lives here. */
async function falPaidPost(kind: "image" | "video", modelId: string, apiKey: string, body: unknown): Promise<Response> {
  // #796 判官 r1 P1-1: every paid provider request in this process passes the same gate. This
  // legacy adapter already sends ONE request per job (`num_images: count` rather than a POST per
  // image), so its job slots alone would bound it — but "which adapter happens to fan out" is not
  // something the concurrency budget should have to know. One gate, every paid call.
  const res = await providerRequestGate().run(() => fetch(`https://fal.run/${modelId}`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })).catch((e: unknown) => {
    // No response at all (connection reset, DNS, socket closed mid-flight). On a
    // SYNC endpoint the request may already have reached the engine and run — we
    // simply lost the reply. Outcome unknown ⇒ billed. Same yardstick as byteplus's
    // "submit returned 2xx but the receipt was unreadable" (#664): what we cannot
    // prove didn't spend, we treat as spent, because a retry POSTs a second time.
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`generation provider ${kind} request got no response:`, { modelId, error: detail });
    throw chargedError(`generation provider ${kind} request got no response (${detail}); outcome unknown, treated as billed`);
  });
  if (res.ok) return res;
  const detail = await res.text().catch(() => "");
  console.error(`generation provider ${kind} request failed:`, { modelId, status: res.status, detail: detail.slice(0, 300) });
  // 4xx — the endpoint rejected the request BEFORE running the model (rate limit,
  // validation, auth). This is the only provably-free failure on a sync endpoint,
  // so it is the only one that stays PLAIN and lets the worker retry.
  if (res.status >= 400 && res.status < 500) throw new Error(`generation provider ${kind} request failed (${res.status})`);
  // 5xx (and any other non-2xx) — a server-side error cannot prove the model didn't
  // run: a gateway timeout or upstream 500 can land AFTER execution. Outcome unknown
  // ⇒ terminal and charged, never a retry that risks a second charge.
  throw chargedError(`generation provider ${kind} request failed (${res.status}); outcome unknown, treated as billed`);
}

/** fal model ids — text-to-image vs image-conditioned edit. v1: Seedream,
 *  the $0.035 workhorse from the provider research. */
const FAL_MODELS: Record<string, { t2i: string; edit: string }> = {
  seedream: {
    t2i: "fal-ai/bytedance/seedream/v4.5/text-to-image",
    edit: "fal-ai/bytedance/seedream/v4.5/edit",
  },
};

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Per-model fal video wiring — endpoints + the param NAMES the model uses (verified
 *  against its fal API page). `imageParam` = i2v source frame; `tailParam` = end frame on
 *  the same i2v endpoint. Optional controls (`audioParam`/`resolutionParam`/`aspectParam`)
 *  are sent only when the model has the param AND the request provides a value — so each
 *  model carries exactly its real settings. All return { video: { url } }. Allowed values
 *  per control live in @fikirtive/core's GEN_VIDEO_MODEL_OPTIONS.
 *
 *  #647 T6:这张表原本有 13 行,其中 12 行(Kling / Veo / LTX / PixVerse / Grok / Wan /
 *  Hailuo / Seedance 2.0 全档)对应的模型从来没有在生产出过一条片。菜单删了而这里不删,
 *  就等于给菜单外的 id 留着一条能真的把钱花出去的路 —— 所以两边一起删(gen.ts 的
 *  GEN_VIDEO_MODELS 有同一条纪律)。随之退场的还有三样只为那 12 台存在的东西:
 *  Veo 专用的 first→last 独立端点、LTX 专用的 fps 参数、以及 duration 的四种编码方式
 *  (Kling 的字符串 "5"、Veo 的 "6s"、Hailuo 的「没有 duration 参数」)。 */
type VideoCfg = {
  t2v: string;
  i2v: string;
  imageParam: string;
  tailParam?: string;
  audioParam?: string;
  resolutionParam?: string;
  aspectParam?: string;
};

const GA = "generate_audio", RES = "resolution", ASP = "aspect_ratio";

const VIDEO_CFG: Record<GenVideoModel, VideoCfg> = {
  "seedance-2-mini": {
    // ByteDance's own fal namespace (no fal-ai/ prefix — unlike Seedream).
    // duration is sent as an INTEGER — verified by a real spend test; fal accepts the int
    // despite the schema page rendering the enum as strings. Don't "fix" it to a string
    // without re-testing.
    //
    // #769: the mini tier's own fal routes, NOT the fast ones renamed. Both were read off
    // fal's public model pages on 2026-08-08 (fal.ai/models/bytedance/seedance-2.0/mini/
    // {text,image}-to-video) — this file's standing rule is that a route/param is only
    // written down once the provider confirms it, so the tier swap had to be looked up
    // rather than derived. The i2v page lists the same controls this row already sends
    // (image_url / end_image_url / resolution / duration / generate_audio).
    t2v: "bytedance/seedance-2.0/mini/text-to-video",
    i2v: "bytedance/seedance-2.0/mini/image-to-video",
    imageParam: "image_url", tailParam: "end_image_url", audioParam: GA, resolutionParam: RES, aspectParam: ASP,
  },
};

export class FalProvider implements GenerationProvider {
  readonly name = "fal:seedream";
  constructor(private apiKey: string) {}

  async generate(req: GenerationRequest): Promise<GeneratedImage[]> {
    const ids = FAL_MODELS[req.model];
    if (!ids) throw new Error("generation provider has no image model mapping");
    const conditioned = req.inputImageUrls.length > 0;
    const modelId = conditioned ? ids.edit : ids.t2i;

    // fal sync endpoint blocks until the images are ready — the worker job is
    // already the async boundary, so no nested queue poll needed.
    //
    // #642 shape: req.aspectRatio is deliberately NOT sent here. This legacy fallback's
    // size parameter is not confirmed against the provider's own schema, and this file's
    // standing rule is: do NOT invent a param until it's confirmed in the provider docs
    // (same treatment as the video audio flag). Declared honestly rather than pretended —
    // EXECUTED_SPEC.image.fallbackAdapterAspectHonoured is false, and index.test.ts asserts
    // both the declaration and this request body agree. The PROD path is the active
    // adapter (byteplus), which does carry the exact WxH.
    const res = await falPaidPost("image", modelId, this.apiKey, {
      prompt: req.prompt,
      num_images: req.count,
      ...(conditioned ? { image_urls: req.inputImageUrls } : {}),
    });
    // res.ok ⇒ the sync endpoint ran the model: we've been billed. A failure
    // past here must terminal-fail (chargedError), never retry-and-re-charge.
    try {
      const data = (await res.json()) as { images?: { url: string; content_type?: string }[] };
      const images = data.images ?? [];
      // we paid for req.count images — a short batch (or none) is a charged failure,
      // never a silent partial DONE
      if (images.length !== req.count) throw new Error(`expected ${req.count} images, generation provider returned ${images.length}`);
      // download every result. allSettled (NOT Promise.all) so each download is
      // awaited even if one fails — no leaked response bodies on the first reject —
      // but a paid batch is all-or-nothing (no partial-success contract): if ANY
      // result didn't download we fail the whole batch (→ chargedError), so a
      // paid-for-but-missing output is never silently dropped/unauditable.
      const settled = await Promise.allSettled(
        images.map(async (img) => {
          const r = await fetch(img.url);
          if (!r.ok) throw new Error(`result download → ${r.status}`);
          const ext = EXT_BY_CONTENT_TYPE[img.content_type ?? ""] ?? extFromUrl(img.url) ?? "png";
          return { bytes: new Uint8Array(await r.arrayBuffer()), ext };
        }),
      );
      const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
      if (ok.length !== images.length) throw new Error(`only ${ok.length}/${images.length} results downloaded`);
      return ok;
    } catch (e) {
      console.error("generation provider returned an unusable image result:", { modelId, error: e instanceof Error ? e.message : String(e) });
      throw chargedError("generation provider billed but returned an unusable image result");
    }
  }

  async generateVideo(req: VideoRequest): Promise<GeneratedVideo> {
    if (req.refVideoUrl) throw new Error("generation provider does not support whole-clip reference video"); // pre-spend
    // Resolve the model's fal wiring. Unknown model → fail BEFORE the paid POST
    // (no spend); the contract already rejects it, this is defense in depth.
    const cfg = VIDEO_CFG[req.model as GenVideoModel];
    if (!cfg) throw new Error("generation provider has no video model mapping");
    // A source frame → image-to-video (Storyboard Animate); no frame →
    // text-to-video (Gen space). image_url (i2v) is a presigned R2 GET fal
    // fetches; the sync endpoint blocks until the clip is ready.
    const i2v = req.imageUrl.length > 0;
    if (req.tailImageUrl && !i2v) throw new Error("generation provider needs a start image for an end frame"); // pre-POST, no spend

    let modelId: string;
    const body: Record<string, unknown> = { prompt: req.prompt, duration: req.durationSeconds };
    // optional controls — sent only when the model has the param and the request
    // provides a value (so each model carries exactly its real settings)
    if (cfg.audioParam && req.audio != null) body[cfg.audioParam] = req.audio;
    if (cfg.resolutionParam && req.resolution) body[cfg.resolutionParam] = req.resolution;
    if (cfg.aspectParam && req.aspectRatio) body[cfg.aspectParam] = req.aspectRatio;
    if (req.tailImageUrl) {
      // an end frame was requested — route to the model's tail mechanism
      if (cfg.tailParam) {
        // same i2v endpoint, end frame alongside the start
        modelId = cfg.i2v;
        body[cfg.imageParam] = req.imageUrl;
        body[cfg.tailParam] = req.tailImageUrl;
      } else {
        // model has no end-frame support — fail before the paid POST (no spend).
        // The contract already rejects this; defense in depth.
        throw new Error("generation provider does not support an end frame for this video model");
      }
    } else if (i2v) {
      modelId = cfg.i2v;
      body[cfg.imageParam] = req.imageUrl;
    } else {
      modelId = cfg.t2v;
    }
    const res = await falPaidPost("video", modelId, this.apiKey, body);
    // res.ok ⇒ the sync endpoint ran the model: we've been billed. A failure
    // past here must terminal-fail (chargedError), never retry-and-re-charge.
    try {
      const data = (await res.json()) as { video?: { url: string; content_type?: string } };
      const url = data.video?.url;
      if (!url) throw new Error("returned no video url");
      const r = await fetch(url);
      if (!r.ok) throw new Error(`video download → ${r.status}`);
      const ext = extFromUrl(url) ?? "mp4";
      return { bytes: new Uint8Array(await r.arrayBuffer()), ext };
    } catch (e) {
      console.error("generation provider returned an unusable video result:", { modelId, error: e instanceof Error ? e.message : String(e) });
      throw chargedError("generation provider billed but returned an unusable video result");
    }
  }
}

export function extFromUrl(url: string): string | null {
  const path = url.split("?")[0] ?? "";
  const m = path.match(/\.([a-z0-9]{1,8})$/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/* ---------------- env factory ---------------- */

/**
 * Three providers: GENERATION_PROVIDER=byteplus (the PROD path — Seedream image /
 * Seedance video, needs BYTEPLUS_API_KEY, real money), =fal (legacy fallback,
 * needs FAL_KEY, real money), and anything else (incl. unset) is the mock —
 * safe by default so a misconfigured prod can't silently burn money, and
 * dev/tracer never touch the network.
 */
export function createGenerationProvider(): GenerationProvider {
  if (process.env.GENERATION_PROVIDER === "fal") {
    const key = process.env.FAL_KEY;
    if (!key) throw new Error("GENERATION_PROVIDER=fal but FAL_KEY is not set");
    return new FalProvider(key);
  }
  if (process.env.GENERATION_PROVIDER === "byteplus") {
    const key = process.env.BYTEPLUS_API_KEY;
    if (!key) throw new Error("GENERATION_PROVIDER=byteplus but BYTEPLUS_API_KEY is not set");
    return new BytePlusProvider(key);
  }
  return new MockProvider();
}

/** #796 — the first clock in the worker's stale/expire/reap chain. Re-exported here because
 *  `.` is this package's only export path; the invariant test reads it from the real source. */
export { VIDEO_POLL_TIMEOUT_MS } from "./byteplus.js";

/** #796 判官 r1 P1-1 — the REQUEST-level ceiling every paid provider call passes through, and the
 *  numbers the worker prints in its boot log. Exported through `.` for the same reason. */
export {
  RequestGate,
  providerRequestGate,
  providerRequestLimit,
  PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT,
  PROVIDER_MAX_CONCURRENT_REQUESTS_ENV,
  __setProviderRequestGateForTests,
} from "./provider-concurrency.js";

/** #784 素材理解的端口 —— 与生成是**两个**端口(钱的形状不同,理由见 understanding.ts)。
 *  同样只从 `.` 导出:这个包对外只有这一条路径。 */
export {
  ArkUnderstandingProvider,
  MockUnderstandingProvider,
  createUnderstandingProvider,
  emptyUnderstandingResponseError,
  isUnreadableMediaError,
  understandingErrorUsage,
  unreadableMediaError,
  type UnderstandingProvider,
  type UnderstandingRequest,
  type UnderstandingResult,
  type UnderstandingUsage,
} from "./understanding.js";
