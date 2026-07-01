/** Composer attach: allowed file types. Images (existing) + videos (抽帧, browser-extracted). */
export const ACCEPT_ATTACH =
  "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm";

/** Longest-side cap (px) for an extracted frame — bounds the exported JPEG size. No upscale. */
export const FRAME_MAX_SIDE = 1600;

/** JPEG quality for the exported frame. */
export const FRAME_JPEG_QUALITY = 0.92;

export function isVideoFile(file: { type: string }): boolean {
  return file.type.startsWith("video/");
}

/** Default scrubber position: 10% into the clip (avoids common black first frames),
 *  clamped to [0, duration]. Invalid/tiny durations → 0. */
export function defaultFrameTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(duration * 0.1, 0), duration);
}

/** File name for an extracted frame, e.g. frame-1.50.jpg. */
export function frameFileName(seconds: number): string {
  const s = Number.isFinite(seconds) ? seconds : 0;
  return `frame-${s.toFixed(2)}.jpg`;
}
