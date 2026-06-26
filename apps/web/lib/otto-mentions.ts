/**
 * Detect an in-progress "@query" at the caret position.
 * Returns the query string (the text after '@') or null.
 *
 * Rules:
 * - There must be an '@' character at or just before the caret with no whitespace between '@' and the caret.
 * - The '@' must either be at position 0 or preceded by whitespace (not mid-word).
 * - The query is the text between '@' and the caret.
 * - If there is whitespace between '@' and the caret, returns null (mention was "closed" by a space).
 */
export function activeMentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) return null;

  // '@' must be at position 0 or preceded by whitespace
  if (atIndex > 0 && !/\s/.test(before[atIndex - 1])) return null;

  const query = before.slice(atIndex + 1);

  // If there's whitespace in the query, the mention was closed
  if (/\s/.test(query)) return null;

  return query;
}

/**
 * Given the final submitted text and the set of entity ids the user explicitly picked,
 * keep only the ids whose entity name still appears verbatim as "@<name>" in the text
 * (case-insensitive). This ensures that deleting "@Sunglasses" from the composer also
 * removes its binding.
 */
export function resolveSentEntityIds(
  text: string,
  picked: { id: string; name: string }[]
): string[] {
  const lower = text.toLowerCase();
  return picked
    .filter(({ name }) => lower.includes(`@${name.toLowerCase()}`))
    .map(({ id }) => id);
}
