import type { RowDiff } from "@fikirtive/core/memory-sections";
import type { BrandRecordRow } from "./brand-record-actions";
import type { MemoryRow } from "./memory-actions";

type UndoResult = { ok: true; id?: string } | { error: string };

export type BrandMemoryUndoActions = {
  deleteMemory: (input: { id: string }) => Promise<UndoResult>;
  updateMemory: (input: { id: string; content: string }) => Promise<UndoResult>;
  restoreMemory: (input: { id: string }) => Promise<UndoResult>;
  deleteBrandRecord: (input: { id: string }) => Promise<UndoResult>;
  saveBrandRecord: (input: unknown) => Promise<UndoResult>;
  restoreBrandRecord: (input: { id: string }) => Promise<UndoResult>;
};

export type BrandMemoryUndoDiff = {
  facts: RowDiff<MemoryRow>;
  records: RowDiff<BrandRecordRow>;
};

function isoDay(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * Reverse one Otto update and wait for every operation to settle before reporting.
 * Each action is retry-safe: removed rows restore their original id, while deletes
 * accept an already-deleted row. That makes a partial transport failure safe to retry.
 */
export async function undoBrandMemoryDiff(
  diff: BrandMemoryUndoDiff,
  actions: BrandMemoryUndoActions,
): Promise<string | null> {
  const { facts, records } = diff;
  const operations: Promise<UndoResult>[] = [
    ...facts.added.map((row) => actions.deleteMemory({ id: row.id })),
    ...facts.changed.map((change) => actions.updateMemory({
      id: change.before.id,
      content: change.before.content,
    })),
    ...facts.removed.map((row) => actions.restoreMemory({ id: row.id })),
    ...records.added.map((row) => actions.deleteBrandRecord({ id: row.id })),
    ...records.changed.map((change) => actions.saveBrandRecord({
      id: change.before.id,
      kind: change.before.kind,
      data: change.before.data,
      status: change.before.status,
      startsAt: isoDay(change.before.startsAt),
      endsAt: isoDay(change.before.endsAt),
    })),
    ...records.removed.map((row) => actions.restoreBrandRecord({ id: row.id })),
  ];

  const settled = await Promise.allSettled(operations);
  const failures = settled.flatMap((result) => {
    if (result.status === "rejected") {
      return ["A connection failed while restoring a change."];
    }
    return "error" in result.value ? [result.value.error] : [];
  });

  if (failures.length === 0) return null;

  const uniqueMessages = [...new Set(failures)];
  if (failures.length === 1) return uniqueMessages[0]!;
  return `${failures.length} changes couldn't be restored. ${uniqueMessages.join(" ")}`;
}
