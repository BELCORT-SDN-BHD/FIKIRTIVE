/** Owner-scoped preferences. The definition lives in @fikirtive/core so the publish
 *  worker reads the same `autoPublish` switch this app writes (#791-2). Re-exported
 *  here because every web caller already imports from this path. */
export {
  type OwnerSettings,
  DEFAULT_SETTINGS,
  mergeSettings,
  autoPublishEnabled,
} from "@fikirtive/core";
