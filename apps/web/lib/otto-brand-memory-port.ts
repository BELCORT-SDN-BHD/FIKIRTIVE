/**
 * makeOttoBrandMemoryPort — the ctx.brandMemory port factory (W-B3-D, debt-31/32/51, $0).
 *
 * Wraps the SAME owner-gated brand-memory lifecycle actions the human Brand memory UI uses
 * (brand-record-actions.deleteBrandRecord / restoreBrandRecord, memory-actions.deleteMemory). Each
 * action validates its `{ id }` shape and is owner-scoped + fail-closed ("Record/Memory not found.")
 * inside requireOwner(). All deletes are SOFT (deletedAt). $0 by construction.
 *
 * NOT an action surface: no "use server", not *-actions — the parity scanner must not discover it.
 */
import { deleteBrandRecord, restoreBrandRecord } from "./brand-record-actions";
import { deleteMemory } from "./memory-actions";

export function makeOttoBrandMemoryPort() {
  return {
    deleteRecord: (id: string) => deleteBrandRecord({ id }),
    restoreRecord: (id: string) => restoreBrandRecord({ id }),
    deleteFact: (id: string) => deleteMemory({ id }),
  };
}
