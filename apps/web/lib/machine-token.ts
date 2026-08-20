/**
 * machine-token — the ONE rule for turning a stored machine token into ordinary words.
 *
 * Five modules each kept their own version of this last line of defence, and the five disagreed
 * on the same input: `NEEDS_ATTENTION` came out as `NEEDS ATTENTION` (crm-labels, the admin
 * dashboard), `Needs attention` (social-labels) and `needs attention` (workflow-format,
 * routine-authorization-facts). Which words a merchant read depended on which screen printed
 * them — the same "what we say drifts from what we do" defect the label modules themselves exist
 * to end, one level down.
 *
 * Separators are shared and settled: `_`, `-` and `.` all appear inside real stored tokens
 * (`not_submitted`, `super-admin`, `rbac.deny`) and none of them is a word.
 *
 * CASE is not shared, and the two shapes below are not a style choice — each is pinned by a
 * test, and they disagree on purpose:
 *
 *   - `humanizeTokenPhrase` is for a token spliced into a sentence someone else wrote ("This
 *     workflow stopped with reason …"). It lowercases UNCONDITIONALLY, because #834's rule is
 *     that nothing recognisable as the stored value may survive into merchant copy — and
 *     `consentStop:dnd_set` keeps its camel hump through any separator-only rule. Mid-sentence
 *     capitalisation would be wrong anyway.
 *   - `humanizeToken` is for a token that stands alone as a label (a badge, a role, an audit
 *     line). It sentence-cases, and it lowercases ONLY a token with no lowercase letter of its
 *     own: `NEEDS_ATTENTION` is SCREAMING_SNAKE because that is how the column stores it, so the
 *     caps go; `edit.addSegment` carries a writer's own word boundary in its casing, and
 *     flattening it to `addsegment` would destroy the only readable thing about it.
 *
 * Pure presentation: no data access, no authority over what is true. And still the LAST resort —
 * a mapped word beats a humanised token every time.
 */

const SEPARATORS = /[._-]+/g;

/** Token → lowercase words, for splicing mid-sentence. Never leaves a recognisable token. */
export function humanizeTokenPhrase(token: string): string {
  return token.replace(SEPARATORS, " ").trim().toLowerCase();
}

/** Token → sentence-cased words, for a label that stands on its own. */
export function humanizeToken(token: string): string {
  const separated = token.replace(SEPARATORS, " ").trim();
  const words = /[a-z]/.test(separated) ? separated : separated.toLowerCase();
  return words.length === 0 ? words : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
