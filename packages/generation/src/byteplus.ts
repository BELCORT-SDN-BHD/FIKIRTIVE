import type { GenerationProvider, GenerationRequest, GeneratedImage, VideoRequest, GeneratedVideo } from "@fikirtive/core";
import { imageOutputSize, REFERENCE_IMAGE_PERSON_REJECTED, referenceImagePersonRejected } from "@fikirtive/core";
import { chargedError, permanentInputError, extFromUrl } from "./index.js";
import { providerRequestGate } from "./provider-concurrency.js";

export const ARK_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
/** internal model id → Ark foundation-model id (verified active on the account). */
export const IMAGE_MODEL_MAP: Record<string, string> = { seedream: "seedream-5-0-260128" };
/** #769(Founder 已裁 2026-08-08):战役视频引擎从 2.0 Fast 换 2.0 mini。
 *  版本化 id 取自 ModelArk 模型档案(只读核实):`arkcli models get dreamina-seedance-2-0-mini`
 *  → `id` / `primary_version` = `dreamina-seedance-2-0-mini-260615`;
 *  `arkcli models versions dreamina-seedance-2-0-mini` 只回这一个版本 260615。 */
export const VIDEO_MODEL_MAP: Record<string, string> = { "seedance-2-mini": "dreamina-seedance-2-0-mini-260615" };

/**
 * How long this client keeps polling one video task before it gives up (F06 — the full
 * reasoning lives at the poll loop below; do not change this number without reading it).
 *
 * Exported because it is the FIRST clock in the worker's chain: provider timeout <
 * stale cutoff < queue expiry < reaper cutoff. apps/worker/src/jobs/clock-invariants.test.ts
 * asserts that ordering against this exact constant, so the chain can no longer be broken by
 * editing one end of it (#796).
 */
export const VIDEO_POLL_TIMEOUT_MS = 15 * 60_000;

/**
 * #782 r2 — how long the FREE last frame may hold the paid clip hostage.
 *
 * The clip is already downloaded and already billed by the time this runs; the still is a
 * by-product. "Best-effort" therefore has to cover the slow case as well as the failing one:
 * an unbounded `await` on a stalled TOS connection would keep the job GENERATING for as long
 * as the socket stayed open, and every minute of that is a minute closer to the queue expiry
 * that would REDELIVER a clip we already paid for. Eight seconds is far past a real 1–2 MB
 * PNG fetch and far short of any of the worker's clocks, so it can only ever fire on a hang.
 * On timeout we drop the still and return the clip — the pre-#782 outcome.
 */
export const LAST_FRAME_FETCH_TIMEOUT_MS = 8_000;

export class BytePlusProvider implements GenerationProvider {
  readonly name = "byteplus";
  constructor(private apiKey: string) {}

  private headers() {
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" };
  }

  /** #672 — the one paid POST each Ark path makes, with the charge boundary applied
   *  to EVERY way it can die. House rule (settled across the #664/#665 judge chain):
   *  a failure may stay PLAIN (retryable) ONLY where it is provable the engine never
   *  spent; anything already billed — or whose outcome is unknown — is a chargedError
   *  the worker must terminal-fail, because a retry POSTs again and pays twice.
   *
   *  The two Ark paths buy different things with a 2xx (the image endpoint bills
   *  synchronously and returns the picture; the video endpoint accepts an order that
   *  bills on completion), but what a FAILED POST can PROVE is identical on both, so
   *  one yardstick serves both. Callers must not re-inspect the status: the
   *  classification lives here and nowhere else. */
  private async paidPost(what: "image request" | "video submit", url: string, model: string, body: unknown): Promise<Response> {
    const res = await fetch(url, { method: "POST", headers: this.headers(), body: JSON.stringify(body) }).catch((e: unknown) => {
      // No response at all (connection reset, DNS, socket closed mid-flight). The
      // request may already have reached the engine — and been billed (image) or
      // turned into a task (video) — with only the reply lost. Outcome unknown ⇒
      // treated as billed, the same yardstick as "submit returned 2xx but the
      // receipt was unreadable" below (#664). PLAIN here would requeue and POST a
      // SECOND time against the same merchant request.
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`generation provider ${what} got no response:`, { model, error: detail });
      throw chargedError(`generation provider ${what} got no response (${detail}); outcome unknown, treated as billed`);
    });
    if (res.ok) return res;
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    console.error(`generation provider ${what} failed:`, { model, status: res.status, detail });
    // 4xx — rejected BEFORE the engine spent anything (rate limit, validation, auth).
    // The only provably-free failure, so the only one that stays PLAIN and retries.
    if (res.status >= 400 && res.status < 500) {
      // #765 — one 4xx the MERCHANT can act on, and the only one this adapter translates.
      // Retrying a rate limit or a gateway wobble is right; retrying this is not. The engine
      // looked at the reference image, saw a face it reads as a real person, and refused the
      // task — and it refuses the same picture identically every time. Left on the generic
      // route the merchant waits out the whole retry budget and is then told "it didn't go
      // through", with the reason and the way out never spoken. So it becomes terminal here,
      // carrying the sentence they read on both surfaces.
      //
      // Still NOT charged: this is a task-create rejection, provably free, so the hold is
      // refunded and no spend is recorded. `permanent` changes only when the worker gives up.
      //
      // FAIL CLOSED twice over. `referenceImagePersonRejected` recognises only the measured
      // shape, so any other 4xx falls through to the generic line below; and only the VIDEO
      // submit is asked, because the video task-create endpoint is where that shape was
      // measured (2026-08-08, 4 refusals of 4 face shapes). The image endpoint has never been
      // seen to return it, and a refusal we invented would be worse than a generic one.
      if (what === "video submit" && referenceImagePersonRejected(detail)) {
        throw permanentInputError(REFERENCE_IMAGE_PERSON_REJECTED);
      }
      throw new Error(`generation provider ${what} failed (${res.status})`);
    }
    // 5xx (and any other non-2xx) — a server-side error cannot prove the engine didn't
    // run/accept: a gateway timeout or upstream 500 can land AFTER that happened.
    // Fail closed: what we cannot prove was free is treated as spent.
    throw chargedError(`generation provider ${what} failed (${res.status}); outcome unknown, treated as billed`);
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
    //
    // #796 判官 r1 P1-1 — THIS is where a "job" stops being one request. A single image job
    // fans out `count` paid POSTs at once, so N concurrent jobs are N×count concurrent requests
    // against an account whose ceiling is 10. Every POST therefore goes through the shared
    // process-wide gate (gen and refgen spend the SAME account budget); over-budget requests
    // WAIT instead of coming back as a 429, which a merchant reads as "generation failed".
    // The gate is held around the POST only — the result download afterwards is not a call
    // against the generation API.
    const gate = providerRequestGate();
    const results = await Promise.allSettled(
      Array.from({ length: req.count }, async () => {
        // #672: this POST IS the billing event on a sync endpoint. paidPost() owns the
        // whole charge boundary for it — only a 4xx (rejected before the model ran) comes
        // back PLAIN; a network throw or a 5xx is "outcome unknown" ⇒ charged. Do not
        // re-inspect the status here.
        const res = await gate.run(() => this.paidPost("image request", `${ARK_BASE}/images/generations`, model, {
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
        }));
        // res.ok ⇒ billed; a failure past here is a CHARGED failure (a retry would re-bill).
        // EVERY way of dying past this line is wrapped, not just the ones with a status code:
        // a malformed receipt (`res.json()` throwing), a download whose connection drops
        // (`fetch` rejecting outright), a body that stops mid-stream (`arrayBuffer()` throwing).
        // An unmarked escape here reads to the batch logic below as a pre-charge failure and
        // gets retried — re-billing an image we already paid for.
        try {
          const data = (await res.json()) as { data?: { url: string }[] };
          const url = data.data?.[0]?.url;
          if (!url) throw chargedError("generation provider image response had no result URL");
          const r = await fetch(url);
          if (!r.ok) throw chargedError(`image download → ${r.status}`);
          return { bytes: new Uint8Array(await r.arrayBuffer()), ext: extFromUrl(url) ?? "png" } as GeneratedImage;
        } catch (e) {
          if (e instanceof Error && (e as { charged?: boolean }).charged) throw e; // already marked
          throw chargedError(`generation provider billed but the image result was unusable (${e instanceof Error ? e.message : String(e)})`);
        }
      }),
    );
    const ok = results.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    if (ok.length === req.count) return ok;
    // Shortfall (F05). If ANY image was billed — a promise fulfilled (its POST succeeded and
    // billed), or a rejection is marked charged (a post-POST failure, or a POST whose outcome is
    // unknown) — the batch is a CHARGED failure: a retry would re-bill, so fail closed as charged.
    // Only when EVERY rejection is a provably-free failure does the batch rethrow the first as a
    // PLAIN error, so the worker retries and the spend audit isn't polluted with phantom spend.
    // #672 narrowed what "provably free" means at the per-image level (a POST 4xx — nothing ran),
    // which narrows the batch by construction: a network throw or a 5xx on any single POST now
    // arrives here already marked charged and flips the whole batch closed. The previous reading
    // ("the POST itself 4xx/5xx'd, nothing billed") was the P0 hole — count images all throwing
    // produced zero marks, so the batch went PLAIN and the worker re-POSTed a batch that may
    // already have reached the engine.
    const rejections = results.flatMap((s) => (s.status === "rejected" ? [s.reason] : []));
    const anyCharged = ok.length > 0 || rejections.some((e) => e instanceof Error && (e as { charged?: boolean }).charged);
    if (anyCharged) throw chargedError(`generation provider returned only ${ok.length}/${req.count} usable images`);
    throw rejections[0] instanceof Error ? rejections[0] : new Error(String(rejections[0]));
  }
  /**
   * #796 判官 r1 P1-1 — a video task holds ONE account slot for its WHOLE life (submit through
   * the last poll), not just for the submit. The account's video ceiling is about tasks the
   * engine is running, and a task stays running until it succeeds or is terminated. Choosing
   * the conservative reading costs us a little unused headroom; the other reading costs 429s,
   * which the merchant reads as a failed generation.
   *
   * The gate is taken HERE and never again inside — `#videoTask` must not re-enter it (a
   * second acquire on the same call chain is how a semaphore deadlocks itself).
   */
  async generateVideo(req: VideoRequest): Promise<GeneratedVideo> {
    return providerRequestGate().run(() => this.#videoTask(req));
  }

  async #videoTask(req: VideoRequest): Promise<GeneratedVideo> {
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

    // #672: the paid submit. paidPost() owns its charge boundary — a 4xx (rate limit /
    // validation / auth, rejected before the engine took the order) is the only provably-free
    // failure and stays PLAIN; the fetch throwing outright, or a 5xx, cannot prove no task was
    // created, so they land as chargedError for exactly the reason spelled out below the call:
    // a retry would submit a SECOND task against the same merchant request.
    const sub = await this.paidPost("video submit", `${ARK_BASE}/contents/generations/tasks`, model, {
      // #646 T5: STRICT top-level parameters, not the legacy `--flag` suffix on the prompt text.
      // The two transports differ in exactly the way that costs money: the legacy suffix is
      // loosely validated — a wrong value is silently replaced by the engine default and the
      // clip is produced and BILLED at a spec the merchant never approved. Top-level fields are
      // strictly validated: a wrong value is an error, before anything is billed.
      // Deliberately NOT sent (this model rejects all three under strict validation):
      // seed, camera_fixed, frames.
      model, content,
      resolution: req.resolution ?? "720p",
      duration: req.durationSeconds,
      // absent shape ⇒ omit the field and let the engine pick (adaptive), matching the
      // pre-#646 behaviour of not appending a ratio flag. Never send an invented value.
      ...(req.aspectRatio ? { ratio: req.aspectRatio } : {}),
      // the merchant's sound choice, finally wired. Default true = the engine default and
      // videoDefaults()'s audio for this model, so an unset toggle changes nothing.
      generate_audio: req.audio ?? true,
      // #782 — ask for the clip's LAST FRAME as a still, so shot N+1 can literally start
      // where shot N ended. FREE: the engine bills the clip (token formula above: output
      // seconds × pixels × fps), and the still is a by-product of a render already paid
      // for — no new price tier, no new charge, nothing added to the merchant's quote.
      // Sent ONLY when the caller asked, so a plain Gen-space clip's request body is
      // byte-identical to what it was before this ticket.
      ...(req.returnLastFrame ? { return_last_frame: true } : {}),
      // F40 (same rule as the image path): paying merchants must not receive watermarked
      // output. Video defaults to false today; declare it so a default drift can't undo that.
      watermark: false,
      // F06 reconciliation window, below. 3600s is the engine's minimum.
      execution_expires_after: 3600,
    });
    // submit returned 2xx ⇒ the engine ACCEPTED the order. From here on we can no longer prove
    // the task was never created, so an unreadable receipt is "outcome unknown", not "nothing
    // happened" (#657). PLAIN here would requeue and submit a SECOND task against the same
    // merchant request — two tasks, two charges. Charged ⇒ terminal, no retry.
    let taskId: string | undefined;
    try {
      taskId = ((await sub.json()) as { id?: string }).id;
    } catch (e) {
      throw chargedError(`generation provider video submit receipt was unreadable (${e instanceof Error ? e.message : String(e)})`);
    }
    if (!taskId) throw chargedError("generation provider video submit returned no task id");
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
    const TIMEOUT_MS = VIDEO_POLL_TIMEOUT_MS;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise((r) => setTimeout(r, 5_000));
      let t: { status?: string; content?: { video_url?: string; last_frame_url?: string } };
      try {
        const st = await fetch(`${ARK_BASE}/contents/generations/tasks/${taskId}`, { headers: this.headers() });
        if (!st.ok) {
          // Non-2xx: if timed out, surface as chargedError (task may still complete on BytePlus = COGS already committed)
          if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError(`generation provider video poll returned ${st.status} after timeout`);
          continue; // transient non-2xx — retry
        }
        t = (await st.json()) as { status?: string; content?: { video_url?: string; last_frame_url?: string } };
      } catch (e) {
        // A chargedError thrown above must propagate (terminal); any other exception (network reset,
        // malformed body) is a transient poll failure — the task was already submitted and may still
        // succeed (and bill) on BytePlus, so re-submitting would double the COGS. Continue polling.
        if (e instanceof Error && (e as { charged?: boolean }).charged) throw e;
        if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError("generation provider video polling failed after timeout");
        continue; // transient — poll again
      }
      if (t.status === "succeeded") {
        // The clip exists and IS billed. Every way of failing to get it into our hands past this
        // line is a charged failure — including the ones that never produce a status code:
        // a download whose connection drops (`fetch` rejecting), a body that stops mid-stream
        // (`arrayBuffer()` throwing). PLAIN here would requeue and generate a SECOND paid clip.
        const url = t.content?.video_url;
        if (!url) throw chargedError("generation provider video response had no result URL");
        let video: GeneratedVideo;
        try {
          const r = await fetch(url);
          if (!r.ok) throw chargedError(`generation provider video download failed (${r.status})`);
          video = { bytes: new Uint8Array(await r.arrayBuffer()), ext: extFromUrl(url) ?? "mp4" };
        } catch (e) {
          if (e instanceof Error && (e as { charged?: boolean }).charged) throw e; // already marked
          throw chargedError(`generation provider video download failed (${e instanceof Error ? e.message : String(e)})`);
        }
        // #782 — the clip's last frame, and why it is the ONLY thing in this method that
        // cannot fail the job. The paid product is the CLIP, and it is already in hand and
        // already billed. The still is a free by-product used to start the next shot; if it
        // is missing or won't download, the correct outcome is "no automatic continuation
        // this time", never a charged failure on a clip we successfully produced. So every
        // failure here is swallowed, deliberately, and the video returns exactly as it did
        // before this ticket.
        //
        // UNVERIFIED RESPONSE KEY (#782, stated rather than hidden): the REQUEST field
        // `return_last_frame` was measured against this model on 2026-08-08 (accepted and
        // effective, alongside resolution/duration/ratio/generate_audio/priority). The
        // RESPONSE key was NOT — `last_frame_url` is read as the symmetric sibling of
        // `video_url`. If the engine spells it differently, this reads undefined and the
        // feature degrades to today's behaviour (shot N+1 simply has no inherited frame and
        // the merchant generates one as before) — it does not break, mis-bill, or lie. The
        // warning below prints the key NAMES the receipt actually carried (names only — a
        // value would be a signed URL), so the first production clip settles the question
        // instead of another round of guessing.
        if (req.returnLastFrame) {
          const tailUrl = t.content?.last_frame_url;
          if (!tailUrl) {
            console.warn("generation provider returned no last frame for a clip that asked for one:", {
              model, contentKeys: Object.keys(t.content ?? {}),
            });
          } else {
            // BOUNDED, and by an abort rather than a bare race: aborting the request also
            // errors its body stream, so the budget covers `arrayBuffer()` (a body that stops
            // mid-transfer) and not just a connect that never answers.
            const ctl = new AbortController();
            const stop = setTimeout(() => ctl.abort(), LAST_FRAME_FETCH_TIMEOUT_MS);
            try {
              const r = await fetch(tailUrl, { signal: ctl.signal });
              if (r.ok) video.lastFrame = { bytes: new Uint8Array(await r.arrayBuffer()), ext: extFromUrl(tailUrl) ?? "png" };
              else console.warn(`generation provider last-frame download failed (${r.status}); clip delivered without it`);
            } catch (e) {
              // NAME ONLY — never the message. `tailUrl` is a signed URL carrying a live
              // X-Amz-Signature, and Node hands the input straight back to you inside the
              // failure text: a malformed URL rejects with a TypeError whose message quotes
              // the whole thing, signature and all. Printing it would put a working download
              // credential for merchant media into the worker log. The class name is all this
              // branch can act on anyway — the outcome is identical either way (no automatic
              // continuation this time), and the open question about #782 (what the engine
              // actually calls the key) is answered by the names-only warning above, not here.
              console.warn(`generation provider last-frame download failed (${e instanceof Error ? e.name : typeof e}); clip delivered without it`);
            } finally {
              clearTimeout(stop);
            }
          }
        }
        return video;
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
