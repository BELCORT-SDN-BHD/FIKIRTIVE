export const DEFAULT_CANVAS_NODE_LOCK_REASON = "Start with Otto first.";

export function getCanvasNodeWriteLock(data: {
  directToolsLocked?: boolean;
  directToolsLockedReason?: string | null;
}): { locked: boolean; reason: string } {
  return {
    locked: data.directToolsLocked === true,
    reason: data.directToolsLockedReason?.trim() || DEFAULT_CANVAS_NODE_LOCK_REASON,
  };
}
