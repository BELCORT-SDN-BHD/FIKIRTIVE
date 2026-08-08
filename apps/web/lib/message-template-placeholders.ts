/**
 * #729 — a message template version is an immutable record, so a `{{placeholder}}` that does
 * not line up with the declared variables can never be corrected: the merchant can only add
 * another version and hope to pick the right one out of a dropdown where both look identical.
 *
 * The templates screen teaches the `{{name}}` convention in its own placeholder text, so this
 * is the thing that enforces it. Pure: no data access, no formatting of stored rows — it takes
 * the body and the declared keys and answers whether they agree, in the merchant's words.
 */

/** `{{ key }}` — anything but a brace between the pairs, trimmed. */
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

/** Placeholder names used in the body, in first-seen order, without duplicates. */
export function templatePlaceholders(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER)) {
    const key = match[1].trim();
    if (key) seen.add(key);
  }
  return [...seen];
}

function list(keys: string[], wrap: (key: string) => string): string {
  const shown = keys.map(wrap);
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/**
 * The refusal sentence for a body and its declared variable keys, or null when they agree.
 * Both directions are reported, because both produce a broken send: an undeclared placeholder
 * has no value to fill in, and a declared variable the body never uses is a value the merchant
 * believes is being sent when it is not.
 */
export function templateVariableMismatch(body: string, variableKeys: string[]): string | null {
  const used = templatePlaceholders(body);
  const declared = new Set(variableKeys);
  const undeclared = used.filter((key) => !declared.has(key));
  const unused = variableKeys.filter((key) => !used.includes(key));
  if (undeclared.length === 0 && unused.length === 0) return null;

  const parts: string[] = [];
  if (undeclared.length > 0) {
    parts.push(
      `The message uses ${list(undeclared, (key) => `{{${key}}}`)}, but ${undeclared.length === 1 ? "it isn't" : "they aren't"} in the variables list — add ${undeclared.length === 1 ? "it" : "each one"} as key=sample value, or take ${undeclared.length === 1 ? "it" : "them"} out of the message.`,
    );
  }
  if (unused.length > 0) {
    parts.push(
      `The variables list has ${list(unused, (key) => key)}, but the message never uses ${unused.length === 1 ? "it" : "them"} — add ${list(unused, (key) => `{{${key}}}`)} to the message, or remove ${unused.length === 1 ? "that variable" : "those variables"}.`,
    );
  }
  return parts.join(" ");
}
