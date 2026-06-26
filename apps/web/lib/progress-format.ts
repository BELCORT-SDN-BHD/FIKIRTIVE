/** Seconds → "m:ss" (e.g. 5 → "0:05", 83 → "1:23"). Negatives/NaN clamp to "0:00". */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Rough "usually takes ~Ns" estimate by media kind (for user expectation only). */
export function usualSeconds(isVideo: boolean): number {
  return isVideo ? 45 : 20;
}
