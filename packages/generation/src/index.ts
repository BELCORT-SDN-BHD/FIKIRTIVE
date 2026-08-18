/**
 * Generation provider port (Phase 2) — the model-neutral backend behind the
 * "Target chip". GENERATION_PROVIDER selects the implementation:
 *
 *   mock     — deterministic solid-colour PNGs, $0, no network (dev/tracer)
 *   byteplus — Ark sync/poll endpoints, Seedream/Seedance (prod; real money)
 *
 * The worker is the only caller. Providers download their outputs and return
 * bytes; the worker stores them content-addressed (same as any asset).
 *
 * ADR 0003 (docs/adr/0003-single-provider-byteplus.md): byteplus is the only
 * paid provider. `chargedError`/`permanentInputError`/`extFromUrl` below are
 * shared money-safety primitives byteplus.ts imports from this file.
 */
import { deflateSync, crc32 } from "node:zlib";
import type { GenerationProvider, GenerationRequest, GeneratedImage, VideoRequest, GeneratedVideo } from "@fikirtive/core";
import { GENERATION_ENGINE_UNAVAILABLE, imageOutputSize } from "@fikirtive/core";
import { BytePlusProvider } from "./byteplus.js";

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
    // #777:组图与散图是**不同的产出**(整组连贯 vs 各出各的),所以离线路的
    // 字节也必须不同 —— 种子相同会让两条路产出同一份内容哈希,测试与画布就再也
    // 分不出商家买的是哪一种。
    const base = hashSeed(req.prompt + "|" + req.inputImageUrls.join(",") + (req.coherentSet ? "|set" : ""));
    const real = imageOutputSize(req.aspectRatio);
    const ratio = reducedRatio(real.width, real.height);
    const w = ratio.width * MOCK_RATIO_SCALE;
    const h = ratio.height * MOCK_RATIO_SCALE;
    return Array.from({ length: req.count }, (_, i) => ({
      bytes: solidPng(base + i + 1, w, h),
      ext: "png",
    }));
  }
  async generateVideo(req: VideoRequest): Promise<GeneratedVideo> {
    // a real, decodable 1s mp4 — content is the same for every mock i2v
    // (dedup is fine for tests; the real provider returns distinct clips)
    const video: GeneratedVideo = { bytes: new Uint8Array(Buffer.from(MOCK_MP4_B64, "base64")), ext: "mp4" };
    // #782: the offline stand-in for the engine's free last frame. Seeded from the prompt +
    // source frame so each mock clip's tail is a DISTINCT picture (distinct content hash) —
    // otherwise every shot in a chained storyboard would inherit the same deduped asset and
    // the tests would pass on an artefact of the mock instead of on the wiring.
    if (req.returnLastFrame) {
      video.lastFrame = { bytes: solidPng(hashSeed(`tail|${req.prompt}|${req.imageUrl}`) + 1, 8, 8), ext: "png" };
    }
    return video;
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

/* ---------------- shared money-safety primitives ---------------- */

/** Mark an error the merchant's engine spend must be assumed to cover. The house
 *  rule (settled across the #664/#665 judge chain): a failure may stay PLAIN
 *  (retryable) ONLY where it is provable the engine never ran; anything already
 *  billed — or whose outcome is unknown — is a chargedError the worker must
 *  terminal-fail, because a retry re-POSTs and double-charges.
 *
 *  Every paid endpoint this package talks to is a SYNC or submit-then-poll shape
 *  where a request that reached the engine cannot be un-billed by a lost reply —
 *  so a network throw or a 5xx is never provably free, only a pre-engine 4xx is. */
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

export function extFromUrl(url: string): string | null {
  const path = url.split("?")[0] ?? "";
  const m = path.match(/\.([a-z0-9]{1,8})$/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/* ---------------- the deploy with no engine ---------------- */

/**
 * A provider that exists only to REFUSE, for a production deploy with no engine selected.
 *
 * It is a provider rather than a boot-time throw, and a `permanent` throw rather than a plain
 * one, for reasons spelled out on `createGenerationProvider` below. What matters at this level
 * is that it is honest twice over, to two different readers:
 *
 *   - the OPERATOR gets the actual condition, named, on the first refused job (worker stdout,
 *     and Sentry via the worker's `runHandler`). "GENERATION_PROVIDER is unset" is the whole
 *     diagnosis; nobody has to correlate a swatch with a deploy.
 *   - the MERCHANT gets `GENERATION_ENGINE_UNAVAILABLE` and nothing else. The thrown message IS
 *     that whitelisted sentence, deliberately: the worker persists the thrown message to
 *     `GenJob.error`, and `merchantGenFailureMessage` compares that string against the whitelist
 *     BYTE FOR BYTE. Putting the operator's diagnosis in the message would fail that comparison,
 *     drop the card back to the generic "you can try again", and tell the merchant to keep
 *     retrying a deployment setting. So the two audiences get two channels, not one string.
 *
 * `name` is "unconfigured", not "mock", and that is load-bearing beyond logging: the gen job
 * reads `provider.name === "mock"` to decide whether to skip its conditioning-reachability
 * gates. Calling this one "mock" would relax real gates on a production path.
 */
export class UnconfiguredProvider implements GenerationProvider {
  readonly name = "unconfigured";
  constructor(private readonly why: string) {}

  /** One shape for both entry points: say it to the operator, refuse it to the merchant. */
  private refuse(what: string): never {
    console.error(`[generation] REFUSING ${what}: ${this.why} — no engine is configured, so this deploy cannot generate. The merchant's hold is being refunded.`);
    throw permanentInputError(GENERATION_ENGINE_UNAVAILABLE);
  }

  async generate(_req: GenerationRequest): Promise<GeneratedImage[]> {
    this.refuse("an image generation");
  }

  async generateVideo(_req: VideoRequest): Promise<GeneratedVideo> {
    this.refuse("a video generation");
  }
}

/* ---------------- env factory ---------------- */

/**
 * THE PROVIDER THIS DEPLOY ACTUALLY HAS, and — since the C1b honesty pass — an
 * explicit refusal where it has none.
 *
 * Three answers, each earned by an explicit setting:
 *   byteplus — the PROD path (Seedream image / Seedance video, needs BYTEPLUS_API_KEY,
 *              real money). ADR 0003: the only paid provider; there is no fallback.
 *   mock     — deterministic solid-colour PNGs, $0, no network. Dev, CI and the tracer
 *              scripts ask for this BY NAME, and that path is untouched.
 *   neither  — unset, empty, or a typo.
 *
 * ── WHAT "NEITHER" USED TO MEAN, AND WHY IT HAD TO CHANGE ────────────────────────────────
 * It used to mean the mock, and the comment here called that "safe by default so a
 * misconfigured prod can't silently burn money". Half of that was true: nothing was spent
 * AT THE ENGINE. The other half was never true, and it is the half the merchant pays for —
 * the worker took the stand-in's 8×8 solid-colour PNG, stored it, delivered it as their
 * generation and SETTLED the hold. A production deploy that lost its provider variable did
 * not fail; it quietly began selling swatches at full price, with nothing anywhere saying so.
 * "Cannot burn money" had silently meant OUR money.
 *
 * So `neither` now refuses IN PRODUCTION, and the refusal travels the money path that already
 * exists rather than inventing a second one: `UnconfiguredProvider` throws a `permanent` error
 * on the first call, which is the same shape the engine's own permanent refusals throw, so the
 * worker's terminal branch terminal-fails the job and refunds the hold in one transaction
 * (apps/worker/src/jobs/gen.ts). No new refund code, no new idempotency key — the merchant's
 * credits come back through `refundReservation` on `refund:<jobId>` like every other pre-charge
 * failure.
 *
 * ── WHY THE REFUSAL IS PER-REQUEST AND NOT A BOOT REFUSAL ────────────────────────────────
 * Throwing here at import time would look stricter and be worse: the worker is the process
 * that performs refunds, so a worker that refuses to boot leaves every already-queued job
 * holding its reservation with nothing left running to release it, and Railway restarts the
 * corpse ten times for good measure. Refusing one job at a time keeps the refund path alive,
 * which is the only property that actually protects the merchant's balance.
 *
 * ── AND WHY NON-PRODUCTION STILL GETS THE MOCK ──────────────────────────────────────────
 * The same rule the env contract already lives by (packages/core/src/env-contract.ts): a
 * missing variable is a normal, deliberate state in dev and CI, and only production is
 * entitled to treat it as fatal. Note what this does NOT rely on: an unrecognised VALUE
 * ("byteplu", "fal") is already fatal in every environment, because the contract declares this
 * variable an enum and `bootEnvDecision` refuses the format outright. The one hole left was
 * the variable being absent in production, and that is exactly the hole closed here.
 */
export function createGenerationProvider(env: NodeJS.ProcessEnv = process.env): GenerationProvider {
  // Compared with `===`, never trimmed or lower-cased. A near-miss (" byteplus") is a typo, and
  // a typo must not be the thing that starts spending a merchant's money.
  if (env.GENERATION_PROVIDER === "byteplus") {
    const key = env.BYTEPLUS_API_KEY;
    if (!key) throw new Error("GENERATION_PROVIDER=byteplus but BYTEPLUS_API_KEY is not set");
    return new BytePlusProvider(key);
  }
  if (env.GENERATION_PROVIDER === "mock") return new MockProvider();
  if (env.NODE_ENV === "production") {
    return new UnconfiguredProvider(
      `GENERATION_PROVIDER is ${env.GENERATION_PROVIDER === undefined ? "unset" : `"${env.GENERATION_PROVIDER}"`}`,
    );
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
  classifyUnderstandingFailure,
  createUnderstandingProvider,
  emptyUnderstandingResponseError,
  isProviderConfigError,
  isUnreadableMediaError,
  providerConfigError,
  understandingErrorUsage,
  unreadableMediaError,
  type UnderstandingFailureClass,
  type UnderstandingProvider,
  type UnderstandingRequest,
  type UnderstandingResult,
  type UnderstandingUsage,
} from "./understanding.js";
