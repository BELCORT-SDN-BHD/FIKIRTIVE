/**
 * nextActiveThreadId — pure helper for optimistic thread deletion.
 *
 * Returns the activeThreadId that should be set after removing `deletedId`
 * from `threads`:
 *   - If `currentActive` is not the deleted thread, return it unchanged.
 *   - If `currentActive` equals `deletedId`, return the first remaining
 *     thread's id (after removal), or null if none remain.
 */
export function nextActiveThreadId(
  threads: { id: string }[],
  deletedId: string,
  currentActive: string | null,
): string | null {
  if (currentActive !== deletedId) return currentActive;
  const remaining = threads.filter((t) => t.id !== deletedId);
  return remaining[0]?.id ?? null;
}
