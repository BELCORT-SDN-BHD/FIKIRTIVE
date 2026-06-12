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
import type { GenerationProvider, GenerationRequest, GeneratedImage, VideoRequest, GeneratedVideo, GenVideoModel } from "@artlio/core";

/** A tiny valid 1s mp4 (256×160 solid) the mock returns for i2v — real enough
 *  for ffprobe/the editor, no network. */
const MOCK_MP4_B64 =
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAPjbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAABI8AAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAw10cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAABI8AAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAQAAAACgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAASPAAAIAAABAAAAAAKFbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAOABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACMG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAfBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAQAAoABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAL/+EAGWdkAAus2UEBWwEQAAADABAAAAMBgPFCmWABAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAGY0AAAAAAAAAGHN0dHMAAAAAAAAAAQAAAA4AAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAACAY3R0cwAAAAAAAAAOAAAAAQAACAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAAFAAAAAABAAAIAAAAAAEAAAAAAAAAAQAABAAAAAABAAAIAAAAABxzdHNjAAAAAAAAAAEAAAABAAAADgAAAAEAAABMc3RzegAAAAAAAAAAAAAADgAAAu8AAAAQAAAADQAAAA0AAAANAAAAFgAAAA8AAAANAAAADQAAABYAAAAPAAAADQAAAA0AAAAWAAAAFHN0Y28AAAAAAAAAAQAABBMAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMAAAAAhmcmVlAAADwm1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9NSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MTIgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAA5ZYiEABD//ubA+ZZafwbc99R1oDqSugXdc8hvTiAZchoeXRuHJPHxZ4eKLPkYKAAABrAIdBw/PCh5AAAADEGaJGxBD/6qVQAEDAAAAAlBnkJ4hv8AC2kAAAAJAZ5hdEM/AA3oAAAACQGeY2pDPwAN6QAAABJBmmhJqEFomUwIf//+qZYAD7kAAAALQZ6GRREsN/8AC2kAAAAJAZ6ldEM/AA3pAAAACQGep2pDPwAN6AAAABJBmqxJqEFsmUwIb//+p4QAHzAAAAALQZ7KRRUsN/8AC2kAAAAJAZ7pdEM/AA3oAAAACQGe62pDPwAN6AAAABJBmu1JqEFsmUwIZ//+nhAAekE=";

/* ---------------- mock (deterministic, offline) ---------------- */

/** Encode an 8×8 solid-colour RGB PNG — a real, decodable image with no deps
 *  beyond node:zlib. Colour derives from the seed so mock outputs are
 *  visually distinct and their hashes differ (distinct content keys). */
function solidPng(seed: number): Uint8Array {
  const w = 8;
  const h = 8;
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

export class MockProvider implements GenerationProvider {
  readonly name = "mock";
  async generate(req: GenerationRequest): Promise<GeneratedImage[]> {
    // deterministic per (prompt, conditioning, index) so a re-run is stable;
    // distinct seeds → distinct bytes → distinct content hashes
    const base = hashSeed(req.prompt + "|" + req.inputImageUrls.join(","));
    return Array.from({ length: req.count }, (_, i) => ({
      bytes: solidPng(base + i + 1),
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

/** Mark an error raised AFTER the provider has already been billed (the fal
 *  sync POST returned ok, then parsing/downloading the result failed). The
 *  worker must terminal-fail on these — a retry would POST again and double-
 *  charge. Pre-charge failures (POST !ok, network) stay unmarked and retry. */
export function chargedError(message: string): Error {
  return Object.assign(new Error(message), { charged: true as const });
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

/** Per-model fal video wiring (the model-neutral table — mirrors LTX Studio's
 *  lineup). Each model's `duration` is the fixed snap of our ~5s request to its
 *  own nearest valid value (Kling 5s, Veo 6s, Seedance 5s, LTX 6s); the price
 *  hint in @artlio/core matches. `audio` → send generate_audio. End frame (tail):
 *  Kling/Seedance take it on the same i2v endpoint via `tailParam` next to
 *  `imageParam`; Veo uses a separate first→last endpoint (first_frame_url /
 *  last_frame_url); a model with neither has no end-frame support. All return
 *  { video: { url } }. Param names verified against each model's fal API page. */
type VideoCfg = {
  t2v: string;
  i2v: string;
  firstLast?: string;
  imageParam: string;
  tailParam?: string;
  audio: boolean;
  duration: string | number;
};

const VIDEO_CFG: Record<GenVideoModel, VideoCfg> = {
  "kling": {
    t2v: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    i2v: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    imageParam: "image_url", tailParam: "tail_image_url", audio: false, duration: "5",
  },
  "veo3.1-lite": {
    t2v: "fal-ai/veo3.1/lite", i2v: "fal-ai/veo3.1/lite/image-to-video",
    imageParam: "image_url", audio: true, duration: "6s",
  },
  "ltx-2": {
    t2v: "fal-ai/ltx-2/text-to-video", i2v: "fal-ai/ltx-2/image-to-video",
    imageParam: "image_url", audio: true, duration: "6",
  },
  "kling-2.6": {
    t2v: "fal-ai/kling-video/v2.6/pro/text-to-video",
    i2v: "fal-ai/kling-video/v2.6/pro/image-to-video",
    imageParam: "start_image_url", tailParam: "end_image_url", audio: true, duration: "5",
  },
  "kling-3": {
    t2v: "fal-ai/kling-video/v3/pro/text-to-video",
    i2v: "fal-ai/kling-video/v3/pro/image-to-video",
    imageParam: "start_image_url", tailParam: "end_image_url", audio: true, duration: "5",
  },
  "veo3.1-fast": {
    t2v: "fal-ai/veo3.1/fast", i2v: "fal-ai/veo3.1/fast/image-to-video",
    firstLast: "fal-ai/veo3.1/fast/first-last-frame-to-video",
    imageParam: "image_url", audio: true, duration: "6s",
  },
  "seedance-2-fast": {
    // ByteDance's own fal namespace (no fal-ai/ prefix — unlike Seedream)
    t2v: "bytedance/seedance-2.0/fast/text-to-video",
    i2v: "bytedance/seedance-2.0/fast/image-to-video",
    imageParam: "image_url", tailParam: "end_image_url", audio: true, duration: 5,
  },
  "veo3.1": {
    t2v: "fal-ai/veo3.1", i2v: "fal-ai/veo3.1/image-to-video",
    firstLast: "fal-ai/veo3.1/first-last-frame-to-video",
    imageParam: "image_url", audio: true, duration: "6s",
  },
};

export class FalProvider implements GenerationProvider {
  readonly name = "fal:seedream";
  constructor(private apiKey: string) {}

  async generate(req: GenerationRequest): Promise<GeneratedImage[]> {
    const ids = FAL_MODELS[req.model];
    if (!ids) throw new Error(`fal: no model mapping for ${req.model}`);
    const conditioned = req.inputImageUrls.length > 0;
    const modelId = conditioned ? ids.edit : ids.t2i;

    // fal sync endpoint blocks until the images are ready — the worker job is
    // already the async boundary, so no nested queue poll needed
    const res = await fetch(`https://fal.run/${modelId}`, {
      method: "POST",
      headers: { Authorization: `Key ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: req.prompt,
        num_images: req.count,
        ...(conditioned ? { image_urls: req.inputImageUrls } : {}),
      }),
    });
    if (!res.ok) {
      // pre-charge failure (the model never ran) — safe for the worker to retry
      const detail = await res.text().catch(() => "");
      throw new Error(`fal ${modelId} → ${res.status}: ${detail.slice(0, 300)}`);
    }
    // res.ok ⇒ the sync endpoint ran the model: we've been billed. A failure
    // past here must terminal-fail (chargedError), never retry-and-re-charge.
    try {
      const data = (await res.json()) as { images?: { url: string; content_type?: string }[] };
      const images = data.images ?? [];
      if (images.length === 0) throw new Error("returned no images");
      // download each result so the worker can store it content-addressed
      return await Promise.all(
        images.map(async (img) => {
          const r = await fetch(img.url);
          if (!r.ok) throw new Error(`result download → ${r.status}`);
          const ext = EXT_BY_CONTENT_TYPE[img.content_type ?? ""] ?? extFromUrl(img.url) ?? "png";
          return { bytes: new Uint8Array(await r.arrayBuffer()), ext };
        }),
      );
    } catch (e) {
      throw chargedError(`fal ${modelId} billed but result unusable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async generateVideo(req: VideoRequest): Promise<GeneratedVideo> {
    // Resolve the model's fal wiring. Unknown model → fail BEFORE the paid POST
    // (no spend); the contract already rejects it, this is defense in depth.
    const cfg = VIDEO_CFG[req.model as GenVideoModel];
    if (!cfg) throw new Error(`fal: no video model mapping for ${req.model}`);
    // A source frame → image-to-video (Storyboard Animate); no frame →
    // text-to-video (Gen space). image_url (i2v) is a presigned R2 GET fal
    // fetches; the sync endpoint blocks until the clip is ready.
    const i2v = req.imageUrl.length > 0;
    if (req.tailImageUrl && !i2v) throw new Error("fal: an end frame needs a start image"); // pre-POST, no spend

    let modelId: string;
    const body: Record<string, unknown> = { prompt: req.prompt, duration: cfg.duration };
    if (cfg.audio) body.generate_audio = true;
    if (req.tailImageUrl) {
      // an end frame was requested — route to the model's tail mechanism
      if (cfg.firstLast) {
        // Veo: a dedicated first→last endpoint with its own param names
        modelId = cfg.firstLast;
        body.first_frame_url = req.imageUrl;
        body.last_frame_url = req.tailImageUrl;
      } else if (cfg.tailParam) {
        // Kling/Seedance: same i2v endpoint, end frame alongside the start
        modelId = cfg.i2v;
        body[cfg.imageParam] = req.imageUrl;
        body[cfg.tailParam] = req.tailImageUrl;
      } else {
        // model has no end-frame support — fail before the paid POST (no spend).
        // The contract already rejects this; defense in depth.
        throw new Error(`fal: ${req.model} does not support an end frame`);
      }
    } else if (i2v) {
      modelId = cfg.i2v;
      body[cfg.imageParam] = req.imageUrl;
    } else {
      modelId = cfg.t2v;
    }
    const res = await fetch(`https://fal.run/${modelId}`, {
      method: "POST",
      headers: { Authorization: `Key ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // pre-charge failure (the model never ran) — safe for the worker to retry
      const detail = await res.text().catch(() => "");
      throw new Error(`fal ${modelId} → ${res.status}: ${detail.slice(0, 300)}`);
    }
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
      throw chargedError(`fal ${modelId} billed but result unusable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function extFromUrl(url: string): string | null {
  const path = url.split("?")[0] ?? "";
  const m = path.match(/\.([a-z0-9]{1,8})$/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/* ---------------- env factory ---------------- */

/**
 * GENERATION_PROVIDER=fal needs FAL_KEY. Anything else (incl. unset) is the
 * mock — safe by default so a misconfigured prod can't silently burn money,
 * and dev/tracer never touch the network.
 */
export function createGenerationProvider(): GenerationProvider {
  if (process.env.GENERATION_PROVIDER === "fal") {
    const key = process.env.FAL_KEY;
    if (!key) throw new Error("GENERATION_PROVIDER=fal but FAL_KEY is not set");
    return new FalProvider(key);
  }
  return new MockProvider();
}
