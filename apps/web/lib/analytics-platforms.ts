// Analytics platform registry (pure constant). Meta reads live data via the
// existing getAnalytics Server Action; the rest are "soon" placeholders that
// render a coming-soon panel until a real channels/ adapter lands. Adding a
// platform is one row here — flip status to "live" once its adapter is wired.
// No I/O, no spend paths — a total function of its inputs so it unit-tests.

export type PlatformStatus = "live" | "soon";

export type AnalyticsPlatform = {
  id: string;
  label: string;
  status: PlatformStatus;
};

export const ANALYTICS_PLATFORMS: AnalyticsPlatform[] = [
  { id: "meta", label: "Meta (IG + FB)", status: "live" },
  { id: "tiktok", label: "TikTok", status: "soon" },
  { id: "shopee", label: "Shopee", status: "soon" },
  { id: "google", label: "Google", status: "soon" },
  { id: "whatsapp", label: "WhatsApp", status: "soon" },
];

export function platformById(id: string): AnalyticsPlatform | undefined {
  return ANALYTICS_PLATFORMS.find((p) => p.id === id);
}
