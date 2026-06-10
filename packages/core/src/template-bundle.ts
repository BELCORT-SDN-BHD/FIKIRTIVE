/**
 * ComfyUI template bundle format (design doc D13 + SOP v1.1).
 * Slot binding is by exact `_meta.title` match with the ARTLIO: prefix;
 * numeric node ids are a cache only (they reshuffle on graph edits).
 */
export const ARTLIO_SLOT_PREFIX = "ARTLIO:";
export const BUNDLE_SCHEMA_VERSION = 1;

export interface SlotBinding {
  /** Exact node title, e.g. "ARTLIO:prompt" — case-sensitive, no whitespace tolerance. */
  title: string;
  /** Whether the founder declared this slot (extras are recorded but flagged). */
  declared: boolean;
  /** Cached node id — revalidated on every re-import, never authoritative. */
  nodeId: string;
  classType: string;
  /** Dot-path into the node, e.g. "inputs.text" or "inputs.image". */
  field: string;
}

export interface BundleManifest {
  bundle_schema: typeof BUNDLE_SCHEMA_VERSION;
  template_name: string;
  display_name: string;
  /** SHA-256 of the raw workflow_api.json bytes as received (no canonicalization). */
  template_version_hash: string;
  exported_at: string;
  slots: SlotBinding[];
  class_types_used: string[];
}
