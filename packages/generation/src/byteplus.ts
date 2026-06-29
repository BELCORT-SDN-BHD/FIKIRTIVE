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
  async generateVideo(_req: VideoRequest): Promise<GeneratedVideo> {
    throw new Error("not implemented"); // Task 3
  }
}
