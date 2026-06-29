import type { GenerationProvider, GenerationRequest, GeneratedImage, VideoRequest, GeneratedVideo } from "@fikirtive/core";
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
    if (!model) throw new Error(`byteplus: no image model mapping for ${req.model}`); // pre-spend
    const conditioned = req.inputImageUrls.length > 0;
    // one request per image (count <= MAX_GEN_COUNT); each is all-or-nothing.
    const results = await Promise.allSettled(
      Array.from({ length: req.count }, async () => {
        const res = await fetch(`${ARK_BASE}/images/generations`, {
          method: "POST", headers: this.headers(),
          body: JSON.stringify({
            model, prompt: req.prompt, size: "2048x2048", response_format: "url",
            // v1 limitation: only req.inputImageUrls[0] is sent. Ark Seedream i2i accepts a
            // single source image; multi-reference conditioning is not supported in this version.
            ...(conditioned ? { image: req.inputImageUrls[0] } : {}),
          }),
        });
        if (!res.ok) throw new Error(`byteplus image → ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`); // pre-charge
        // res.ok ⇒ billed; a failure past here is a charged failure
        const data = (await res.json()) as { data?: { url: string }[] };
        const url = data.data?.[0]?.url;
        if (!url) throw new Error("byteplus image: no url in response");
        const r = await fetch(url);
        if (!r.ok) throw new Error(`image download → ${r.status}`);
        return { bytes: new Uint8Array(await r.arrayBuffer()), ext: extFromUrl(url) ?? "png" } as GeneratedImage;
      }),
    );
    const ok = results.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    if (ok.length !== req.count) throw chargedError(`byteplus image: only ${ok.length}/${req.count} usable`);
    return ok;
  }
  async generateVideo(req: VideoRequest): Promise<GeneratedVideo> {
    const model = VIDEO_MODEL_MAP[req.model];
    if (!model) throw new Error(`byteplus: no video model mapping for ${req.model}`); // pre-spend
    // BytePlus Seedance i2v takes only a START frame; first→last (end-frame) is not supported.
    // Reject it BEFORE the paid submit (no spend) rather than silently dropping it — defense in
    // depth behind GEN_VIDEO_MODEL_INFO["seedance-2-fast"].tail=false (the gate/composer won't
    // offer it). Video is always count=1 (startGen hardcodes it); the charge is flat per resolution.
    if (req.tailImageUrl) throw new Error(`byteplus: ${req.model} does not support an end frame`); // pre-spend
    const i2v = req.imageUrl.length > 0;
    // Seedance encodes controls as text flags appended to the prompt.
    // v1 limitation: req.audio is not wired to Ark Seedance. Seedance uses its own default
    // audio behaviour; the audio toggle is tracked in VideoRequest but the Ark flag is
    // unverified — do NOT invent one until confirmed in the Ark API docs.
    const flags = [`--resolution ${req.resolution ?? "720p"}`, `--duration ${req.durationSeconds}`]
      .concat(req.aspectRatio ? [`--ratio ${req.aspectRatio}`] : []).join(" ");
    const content: unknown[] = [];
    if (i2v) content.push({ type: "image_url", image_url: { url: req.imageUrl } });
    content.push({ type: "text", text: `${req.prompt} ${flags}`.trim() });

    const sub = await fetch(`${ARK_BASE}/contents/generations/tasks`, {
      method: "POST", headers: this.headers(), body: JSON.stringify({ model, content }),
    });
    if (!sub.ok) throw new Error(`byteplus video submit → ${sub.status}: ${(await sub.text().catch(() => "")).slice(0, 300)}`); // pre-charge
    const taskId = ((await sub.json()) as { id?: string }).id;
    if (!taskId) throw new Error("byteplus video: submit returned no task id");
    // task created ⇒ billed on success. Poll inside the provider (the worker just awaits).
    const startedAt = Date.now();
    const TIMEOUT_MS = 5 * 60_000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise((r) => setTimeout(r, 5_000));
      let t: { status?: string; content?: { video_url?: string } };
      try {
        const st = await fetch(`${ARK_BASE}/contents/generations/tasks/${taskId}`, { headers: this.headers() });
        if (!st.ok) {
          // Non-2xx: if timed out, surface as chargedError (task may still complete on BytePlus = COGS already committed)
          if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError(`byteplus video: poll ${st.status} after timeout`);
          continue; // transient non-2xx — retry
        }
        t = (await st.json()) as { status?: string; content?: { video_url?: string } };
      } catch (e) {
        // A chargedError thrown above must propagate (terminal); any other exception (network reset,
        // malformed body) is a transient poll failure — the task was already submitted and may still
        // succeed (and bill) on BytePlus, so re-submitting would double the COGS. Continue polling.
        if (e instanceof Error && (e as { charged?: boolean }).charged) throw e;
        if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError("byteplus video: poll exception after timeout");
        continue; // transient — poll again
      }
      if (t.status === "succeeded") {
        const url = t.content?.video_url;
        if (!url) throw chargedError("byteplus video: succeeded but no video_url");
        const r = await fetch(url);
        if (!r.ok) throw chargedError(`byteplus video download → ${r.status}`);
        return { bytes: new Uint8Array(await r.arrayBuffer()), ext: extFromUrl(url) ?? "mp4" };
      }
      if (t.status === "failed" || t.status === "cancelled" || t.status === "canceled")
        throw chargedError(`byteplus video task ${t.status}`);
      if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError("byteplus video: timed out");
    }
  }
}
