/** Per-run context the caller (web route / worker) supplies to `run(otto, input, { context })`.
 *  It is re-derived FRESH every run from the verified session — it is NOT persisted in RunState,
 *  so identity/config can never go stale. Tools read identity/scope from HERE, never from model args. */
export interface OttoContext {
  /** = ownerId under org-as-tenant. Ledger key + ownership scope. From the verified session, NEVER the model. */
  orgId: string;
  /** Verified user id (audit). */
  userId: string;
  /** The active, owned project. */
  projectId: string;
  /** The existing chat thread Otto is operating in. */
  threadId: string;
  /** Admin-disabled model ids the caller resolved via resolveDisabledModels() (passed as an array; the tool builds a Set). */
  disabledModels: string[];
  /** "Animate this result": a server-validated i2v source frame, if the turn carries one. */
  sourceGenerationId?: string | null;
}
