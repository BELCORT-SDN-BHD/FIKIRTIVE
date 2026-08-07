export const AUTO_PUBLISH_GATE_HINT =
  "Connect Instagram or Facebook first — auto-publish unlocks once Meta approves publishing.";

const META_PUBLISH_CHANNEL_IDS = new Set(["instagram", "facebook"]);

export function canAutoPublish(
  connectedChannelIds: readonly string[],
  canPublish: boolean,
): boolean {
  return canPublish && connectedChannelIds.some((id) => META_PUBLISH_CHANNEL_IDS.has(id));
}
