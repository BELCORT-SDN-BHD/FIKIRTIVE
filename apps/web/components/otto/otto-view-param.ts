/**
 * otto-view-param.ts — the ONE reading of `/otto?view=…`.
 *
 * The screen list and the `stuff → library` alias used to be written out twice: once in the
 * server page (app/otto/page.tsx, which seeds `initialView`) and once in the client shell
 * (components/otto/OttoApp.tsx, which follows the URL through a soft navigation). Two copies
 * of the same table is how a new screen ends up reachable from one of them and not the other.
 *
 * Deliberately NOT a "use client" module: the server page imports it too.
 */

export const OTTO_VIEW_KEYS = [
  "otto", "stuff", "library", "edit", "templates", "discover",
  "memory", "account", "connections", "schedule", "analytics",
] as const;

export type OttoViewKey = (typeof OTTO_VIEW_KEYS)[number];

const KEYS: ReadonlySet<string> = new Set(OTTO_VIEW_KEYS);

/**
 * `?view=` → the screen it names, or `undefined` when it names none. `stuff` is the old name
 * for `library` and is still linked to from outside the app, so it resolves to `library`.
 */
export function parseOptionalViewParam(raw: string | null | undefined): OttoViewKey | undefined {
  if (raw === "stuff") return "library";
  return raw && KEYS.has(raw) ? (raw as OttoViewKey) : undefined;
}

/** Same table, for callers that must land somewhere: an unknown/absent view is the conversation. */
export function parseViewParam(raw: string | null | undefined): OttoViewKey {
  return parseOptionalViewParam(raw) ?? "otto";
}
