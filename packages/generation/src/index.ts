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
import type { GenerationProvider, GenerationRequest, GeneratedImage } from "@artlio/core";

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
      const detail = await res.text().catch(() => "");
      throw new Error(`fal ${modelId} → ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as { images?: { url: string; content_type?: string }[] };
    const images = data.images ?? [];
    if (images.length === 0) throw new Error(`fal ${modelId} returned no images`);

    // download each result so the worker can store it content-addressed
    return Promise.all(
      images.map(async (img) => {
        const r = await fetch(img.url);
        if (!r.ok) throw new Error(`fal result download → ${r.status}`);
        const ext = EXT_BY_CONTENT_TYPE[img.content_type ?? ""] ?? extFromUrl(img.url) ?? "png";
        return { bytes: new Uint8Array(await r.arrayBuffer()), ext };
      }),
    );
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
