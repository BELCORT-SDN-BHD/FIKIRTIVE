import type { GenerationProvider, GenerationRequest, GeneratedImage, VideoRequest, GeneratedVideo } from "@fikirtive/core";
import { imageOutputSize } from "@fikirtive/core";
import { chargedError, extFromUrl } from "./index.js";

export const ARK_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
/** internal model id → Ark foundation-model id (verified active on the account). */
export const IMAGE_MODEL_MAP: Record<string, string> = { seedream: "seedream-5-0-260128" };
export const VIDEO_MODEL_MAP: Record<string, string> = { "seedance-2-fast": "dreamina-seedance-2-0-fast-260128" };

export class BytePlusProvider implements GenerationProvider {
  readonly name = "byteplus";
  constructor(private apiKey: string) {}

  private headers() {
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" };
  }

  async generate(req: GenerationRequest): Promise<GeneratedImage[]> {
    const model = IMAGE_MODEL_MAP[req.model];
    if (!model) throw new Error("generation provider has no image model mapping"); // pre-spend
    const conditioned = req.inputImageUrls.length > 0;
    // #642: the merchant's shape, as the exact pixels the engine will produce.
    // The WxH form is bound by the engine to total pixels ∈ [3,686,400, 16,777,216] and
    // ratio ∈ [1/16, 16]; every entry in the shared GEN_IMAGE_SIZES table satisfies both
    // (asserted per-entry in packages/core/src/gen.test.ts). An absent/unknown shape falls
    // back to the default square — never send a value the engine would reject. Price is
    // unaffected: this engine bills per image, not per size.
    const { width, height } = imageOutputSize(req.aspectRatio);
    // one request per image (count <= MAX_GEN_COUNT); each is all-or-nothing.
    const results = await Promise.allSettled(
      Array.from({ length: req.count }, async () => {
        const res = await fetch(`${ARK_BASE}/images/generations`, {
          method: "POST", headers: this.headers(),
          body: JSON.stringify({
            model, prompt: req.prompt, size: `${width}x${height}`, response_format: "url",
            // F40: Ark Seedream defaults watermark=true — paying customers must not receive
            // watermarked images, so set it false explicitly.
            watermark: false,
            // Multi-reference conditioning: Ark Seedream's `image` field accepts an array of
            // source images (verified against ark.ap-southeast; ≤14 refs, inputs+outputs ≤ 15,
            // and the worker caps at MAX_CONDITIONING_IMAGES=10 → 10+1 ≤ 15). Send the whole
            // presigned set so product+logo+character all condition. Keep the proven single-
            // string form for exactly one ref (the live-verified prod shape); array only for 2+.
            ...(conditioned ? { image: req.inputImageUrls.length === 1 ? req.inputImageUrls[0] : req.inputImageUrls } : {}),
          }),
        });
        if (!res.ok) {
          const detail = (await res.text().catch(() => "")).slice(0, 300);
          console.error("generation provider image request failed:", { model, status: res.status, detail });
          throw new Error(`generation provider image request failed (${res.status})`);
        } // pre-charge (nothing billed) — stays PLAIN so the worker can retry
        // res.ok ⇒ billed; a failure past here is a CHARGED failure (a retry would re-bill).
        const data = (await res.json()) as { data?: { url: string }[] };
        const url = data.data?.[0]?.url;
        if (!url) throw chargedError("generation provider image response had no result URL");
        const r = await fetch(url);
        if (!r.ok) throw chargedError(`image download → ${r.status}`);
        return { bytes: new Uint8Array(await r.arrayBuffer()), ext: extFromUrl(url) ?? "png" } as GeneratedImage;
      }),
    );
    const ok = results.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    if (ok.length === req.count) return ok;
    // Shortfall (F05). If ANY image was billed — a promise fulfilled (its POST succeeded and
    // billed), or a rejection is marked charged (a post-POST failure) — the batch is a CHARGED
    // failure: a retry would re-bill the already-billed ones, so fail closed as charged. But if
    // EVERY rejection is an unmarked PRE-charge failure (the POST itself 4xx/5xx'd, nothing
    // billed), rethrow the first as a PLAIN error so the worker retries and the spend audit isn't
    // polluted with phantom provider spend.
    const rejections = results.flatMap((s) => (s.status === "rejected" ? [s.reason] : []));
    const anyCharged = ok.length > 0 || rejections.some((e) => e instanceof Error && (e as { charged?: boolean }).charged);
    if (anyCharged) throw chargedError(`generation provider returned only ${ok.length}/${req.count} usable images`);
    throw rejections[0] instanceof Error ? rejections[0] : new Error(String(rejections[0]));
  }
  async generateVideo(req: VideoRequest): Promise<GeneratedVideo> {
    const model = VIDEO_MODEL_MAP[req.model];
    if (!model) throw new Error("generation provider has no video model mapping"); // pre-spend
    // BytePlus Seedance i2v takes only a START frame; first→last (end-frame) is not supported.
    // Reject it BEFORE the paid submit (no spend) rather than silently dropping it — defense in
    // depth behind GEN_VIDEO_MODEL_INFO["seedance-2-fast"].tail=false (the gate/composer won't
    // offer it). Video is always count=1 (startGen hardcodes it); the charge is flat per resolution.
    if (req.tailImageUrl) throw new Error("generation provider does not support an end frame for this video model"); // pre-spend
    const i2v = req.imageUrl.length > 0;
    // Seedance encodes controls as text flags appended to the prompt.
    // v1 limitation: req.audio is not wired to Ark Seedance. Seedance uses its own default
    // audio behaviour; the audio toggle is tracked in VideoRequest but the Ark flag is
    // unverified — do NOT invent one until confirmed in the Ark API docs.
    const flags = [`--resolution ${req.resolution ?? "720p"}`, `--duration ${req.durationSeconds}`]
      .concat(req.aspectRatio ? [`--ratio ${req.aspectRatio}`] : []).join(" ");
    const content: unknown[] = [];
    if (i2v) content.push({ type: "image_url", image_url: { url: req.imageUrl } });
    if (req.refVideoUrl) content.push({ type: "video_url", video_url: { url: req.refVideoUrl }, role: "reference_video" });
    content.push({ type: "text", text: `${req.prompt} ${flags}`.trim() });

    const sub = await fetch(`${ARK_BASE}/contents/generations/tasks`, {
      method: "POST", headers: this.headers(), body: JSON.stringify({ model, content }),
    });
    if (!sub.ok) {
      const detail = (await sub.text().catch(() => "")).slice(0, 300);
      console.error("generation provider video submit failed:", { model, status: sub.status, detail });
      throw new Error(`generation provider video submit failed (${sub.status})`);
    } // pre-charge
    const taskId = ((await sub.json()) as { id?: string }).id;
    if (!taskId) throw new Error("generation provider video submit returned no task id");
    // task created ⇒ billed on success. Poll inside the provider (the worker just awaits).
    const startedAt = Date.now();
    // F06: 15 min > realistic Seedance tail latency, so a still-running task isn't abandoned
    // (abandoning FAILs+refunds the user while BytePlus later bills the completing task = margin
    // leak). Stays safely under GEN_QUEUE_POLICY.expireInSeconds (20 min) minus download/persist
    // headroom, so the worker's own message doesn't expire mid-poll.
    const TIMEOUT_MS = 15 * 60_000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise((r) => setTimeout(r, 5_000));
      let t: { status?: string; content?: { video_url?: string } };
      try {
        const st = await fetch(`${ARK_BASE}/contents/generations/tasks/${taskId}`, { headers: this.headers() });
        if (!st.ok) {
          // Non-2xx: if timed out, surface as chargedError (task may still complete on BytePlus = COGS already committed)
          if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError(`generation provider video poll returned ${st.status} after timeout`);
          continue; // transient non-2xx — retry
        }
        t = (await st.json()) as { status?: string; content?: { video_url?: string } };
      } catch (e) {
        // A chargedError thrown above must propagate (terminal); any other exception (network reset,
        // malformed body) is a transient poll failure — the task was already submitted and may still
        // succeed (and bill) on BytePlus, so re-submitting would double the COGS. Continue polling.
        if (e instanceof Error && (e as { charged?: boolean }).charged) throw e;
        if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError("generation provider video polling failed after timeout");
        continue; // transient — poll again
      }
      if (t.status === "succeeded") {
        const url = t.content?.video_url;
        if (!url) throw chargedError("generation provider video response had no result URL");
        const r = await fetch(url);
        if (!r.ok) throw chargedError(`generation provider video download failed (${r.status})`);
        return { bytes: new Uint8Array(await r.arrayBuffer()), ext: extFromUrl(url) ?? "mp4" };
      }
      if (t.status === "failed" || t.status === "cancelled" || t.status === "canceled")
        throw chargedError(`generation provider video task ${t.status}`);
      if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError("generation provider video timed out");
    }
  }
}
