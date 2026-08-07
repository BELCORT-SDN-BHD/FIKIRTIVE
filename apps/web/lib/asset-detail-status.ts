/**
 * The asset detail panel's paid controls — Regenerate / Animate / Edit (#602 r3, judge P2).
 *
 * All three are SPEND buttons: pressing one opens the confirm and then charges. Each kept its own
 * copy of "when is this button off", and the copies quietly disagreed with the label beside them —
 * a job the merchant CANCELLED rendered the word "Cancelled" inside a button that was still live,
 * so one more click fired a fresh paid generation of the thing they had just stopped.
 *
 * One predicate, asked by all three.
 */
export type AssetSpendStatus = "idle" | "running" | "done" | "failed" | "cancelled" | "timeout";

/**
 * Is this paid control off?
 *
 *   - `running`   — it is already going; a second press would be a second charge.
 *   - `timeout`   — the job may STILL be running (the worker settles late ones), and every retry
 *                   here mints a fresh idempotency key, so a press is a real second charge.
 *   - `cancelled` — the merchant stopped this on purpose. Handing them one click back into the
 *                   same spend is the same apology-shaped mistake as the red "Try again" card.
 *                   Starting again stays available — it is a deliberate act, from the normal
 *                   control, once the state clears.
 *
 * `failed` stays PRESSABLE on purpose: a failure was refunded, and "try again" is the right offer
 * for work the merchant asked for and did not get.
 */
export function assetSpendControlDisabled(status: AssetSpendStatus, readOnly: boolean): boolean {
  return readOnly || status === "running" || status === "timeout" || status === "cancelled";
}
