export function ottoGreetingName(userName: string): string {
  const trimmed = userName.trim();
  if (/^[^\s@]+@[^\s@]+$/.test(trimmed)) return trimmed.slice(0, trimmed.indexOf("@"));
  return trimmed.split(/\s+/)[0] ?? "";
}

/** What Otto calls a merchant who has given it nothing to go on. Reads as a complete
 *  greeting ("Hi there — what should we make today?") — never a blank where a name
 *  should be, and never anything derived from an email address. */
export const OTTO_GENERIC_GREETING_NAME = "there";

/** A candidate is usable only if it is non-empty after trimming AND carries no "@".
 *
 *  The "@" test is the whole point of #542 (F-07). Two real shapes would otherwise leak an
 *  address into the greeting: a pre-#543 `Organization.name`, which IS the merchant's full
 *  email address (bootstrapPersonalOrg falls back to `email` when no shop name was
 *  collected), and a `User.name` a merchant typed their own address into. Neither may reach
 *  {@link ottoGreetingName}, because that function's email branch would hand back the LOCAL
 *  PART — "Hi tools" — which is exactly the degraded greeting this ticket exists to remove. */
function usableGreetingName(candidate: string | null | undefined): string | null {
  const trimmed = (candidate ?? "").trim();
  if (!trimmed || trimmed.includes("@")) return null;
  return trimmed;
}

/** #542 — pick WHICH name Otto greets the merchant by. Pure, so the fallback chain is
 *  testable without a database or a page render.
 *
 *  Order: the merchant's own display name → their shop/workspace name → a generic greeting.
 *  `null` means the profile read failed or the session could not be resolved; that is not a
 *  reason to guess at a name, so it lands on the generic greeting like any other miss.
 *
 *  NO PATH RETURNS AN EMAIL ADDRESS OR ANY PART OF ONE — that is the invariant, and it is
 *  what `otto-greeting.test.ts` pins. The caller passes the result to {@link ottoGreetingName},
 *  which shortens a multi-word name to its first word ("Aisha Rahman" → "Aisha", "Kopi
 *  Corner" → "Kopi"); that shortening is pre-existing and unchanged. */
export function resolveOttoGreetingName(
  names: { displayName?: string | null; workspaceName?: string | null } | null | undefined,
): string {
  return (
    usableGreetingName(names?.displayName) ??
    usableGreetingName(names?.workspaceName) ??
    OTTO_GENERIC_GREETING_NAME
  );
}
