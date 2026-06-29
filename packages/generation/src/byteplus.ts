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

  async generate(_req: GenerationRequest): Promise<GeneratedImage[]> {
    throw new Error("not implemented"); // Task 2
  }
  async generateVideo(_req: VideoRequest): Promise<GeneratedVideo> {
    throw new Error("not implemented"); // Task 3
  }
}
