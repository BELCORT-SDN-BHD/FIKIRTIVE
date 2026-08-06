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
    // #646 T5. First+last frames, single first frame, and whole-clip reference video are three
    // MUTUALLY EXCLUSIVE scenarios — they cannot be mixed in one task. Refuse the mixed shape
    // BEFORE the paid submit (no spend) rather than let the engine reject it after billing.
    // Video is always count=1 (startGen hardcodes it); the charge is flat per resolution.
    if (req.tailImageUrl && req.refVideoUrl) throw new Error("generation provider can't combine an end frame with a reference video"); // pre-spend
    const i2v = req.imageUrl.length > 0;
    // An end frame with no start frame isn't a scenario the engine has — and silently dropping it
    // would deliver (and bill for) a clip the merchant never asked for. Same guard the fallback
    // adapter keeps. Unreachable from the worker (it only resolves a tail alongside a source), so
    // this is defense in depth.
    if (req.tailImageUrl && !i2v) throw new Error("generation provider needs a start image for an end frame"); // pre-spend
    const content: unknown[] = [];
    if (req.tailImageUrl && i2v) {
      // first+last frames: BOTH parts carry an explicit role — that pair IS what selects the
      // scenario. A roleless pair would read as the single-frame scenario instead.
      // Mismatched shapes: the first frame wins and the end frame is cropped to it.
      content.push({ type: "image_url", image_url: { url: req.imageUrl }, role: "first_frame" });
      content.push({ type: "image_url", image_url: { url: req.tailImageUrl }, role: "last_frame" });
    } else if (i2v) {
      // single source frame — role may be omitted (the engine reads it as the first frame).
      content.push({ type: "image_url", image_url: { url: req.imageUrl } });
    }
    if (req.refVideoUrl) content.push({ type: "video_url", video_url: { url: req.refVideoUrl }, role: "reference_video" });
    // The text part is the merchant's prompt ONLY — every control is a top-level field below.
    content.push({ type: "text", text: req.prompt.trim() });

    const sub = await fetch(`${ARK_BASE}/contents/generations/tasks`, {
      method: "POST", headers: this.headers(),
      // #646 T5: STRICT top-level parameters, not the legacy `--flag` suffix on the prompt text.
      // The two transports differ in exactly the way that costs money: the legacy suffix is
      // loosely validated — a wrong value is silently replaced by the engine default and the
      // clip is produced and BILLED at a spec the merchant never approved. Top-level fields are
      // strictly validated: a wrong value is an error, before anything is billed.
      // Deliberately NOT sent (this model rejects all three under strict validation):
      // seed, camera_fixed, frames.
      body: JSON.stringify({
        model, content,
        resolution: req.resolution ?? "720p",
        duration: req.durationSeconds,
        // absent shape ⇒ omit the field and let the engine pick (adaptive), matching the
        // pre-#646 behaviour of not appending a ratio flag. Never send an invented value.
        ...(req.aspectRatio ? { ratio: req.aspectRatio } : {}),
        // the merchant's sound choice, finally wired. Default true = the engine default and
        // videoDefaults()'s audio for this model, so an unset toggle changes nothing.
        generate_audio: req.audio ?? true,
        // F40 (same rule as the image path): paying merchants must not receive watermarked
        // output. Video defaults to false today; declare it so a default drift can't undo that.
        watermark: false,
        // F06 reconciliation window, below. 3600s is the engine's minimum.
        execution_expires_after: 3600,
      }),
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
    // F06 — the reconciliation window, and why it is the size it is.
    //
    // Two clocks run on one task. OURS: this client gives up after 15 min, because the worker's
    // own message expires at GEN_QUEUE_POLICY.expireInSeconds (20 min) and we need the remaining
    // minutes to download and persist. THE ENGINE'S: it keeps working on an abandoned task and
    // bills it when it completes. Whatever falls between the two clocks is the ambiguous window:
    // we told the merchant "failed" (and refunded) while the engine still charged us.
    //
    // 15 min is well past realistic latency, so abandoning is already rare — and when it does
    // happen, giving up EARLIER would be worse (a still-running task refunded mid-flight is a
    // guaranteed margin leak, not a possible one). So the client side stays 15 min and keeps its
    // charged semantics: an abandoned task is treated as billed.
    //
    // What #646 T5 fixes is the OTHER end. The engine's own limit defaulted to 48h, so the window
    // was [15 min, 48h]. `execution_expires_after: 3600` (the minimum it accepts) shrinks it to
    // [15 min, 1h]: past one hour the engine terminates the task itself as `expired` — no output,
    // nothing billed — so an abandoned task can no longer quietly complete a day later.
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
      // #661 — the three terminal statuses in which the ENGINE ITSELF reports that no video was
      // produced. Official pricing page (docs.byteplus.com/en/docs/ModelArk/1544106, last updated
      // 2026-08-01): "You are only charged for successfully generated videos. No fee is charged if
      // generation fails due to reasons such as content moderation." So nothing was billed here.
      //   `expired`   = terminated at execution_expires_after before producing anything.
      //   `failed`    = the engine ran and rejected/aborted it (content moderation, bad input…).
      //   `cancelled` = cancelled while still queued (spelled both ways by the API).
      // PLAIN (no `charged` marker) ⇒ the worker keeps its existing retry policy and requeues.
      // That is safe and intended: officially nothing was billed, so a retry cannot double-charge
      // COGS. A moderation failure will very likely fail again — what that burns is retry
      // attempts, not money — and the final terminal FAIL refunds the merchant while recording
      // NO spend, which is the whole point of this ticket (no phantom COGS in the spend audit).
      //
      // BOUNDARY (#657, deliberately untouched): every "outcome unknown" path stays chargedError —
      // the three abandon-timeouts, the download failure, a succeeded task with no result URL.
      // Not knowing whether the engine produced a clip is not the same as the engine telling us it
      // didn't; only an explicit no-output terminal status may go PLAIN.
      if (t.status === "expired") throw new Error("generation provider video task expired");
      if (t.status === "failed" || t.status === "cancelled" || t.status === "canceled")
        throw new Error(`generation provider video task ${t.status}`);
      if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError("generation provider video timed out");
    }
  }
}
