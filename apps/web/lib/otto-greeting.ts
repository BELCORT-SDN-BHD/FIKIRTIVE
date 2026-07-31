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
export type ProfileNamesRead =
  | { displayName?: string | null; workspaceName?: string | null }
  | { error: string }
  | null
  | undefined;

export function resolveOttoGreetingName(names: ProfileNamesRead): string {
  if (!names || "error" in names) return OTTO_GENERIC_GREETING_NAME;
  return (
    usableGreetingName(names.displayName) ??
    usableGreetingName(names.workspaceName) ??
    OTTO_GENERIC_GREETING_NAME
  );
}

/** The page's ENTIRE greeting-name step, in one testable place: run the profile read, survive
 *  it however it ends, and pick the name.
 *
 *  THE `.catch` IS THE POINT. `getMyProfileNames` fails in two different ways and only one of
 *  them is a value: a refused session returns `{error}`, but a Prisma/connection fault REJECTS.
 *  An un-caught rejection inside the page's `Promise.all` takes the whole page down — so
 *  "a failed read falls back to the generic greeting" was only true for the first kind until
 *  this wrapper existed. Both kinds now land on {@link resolveOttoGreetingName}'s miss path.
 *
 *  Takes the reader as a function rather than a promise so a test can hand it a rejecting stub
 *  and exercise the real catch, instead of re-implementing it. */
export async function ottoGreetingNameFromProfile(
  read: () => Promise<ProfileNamesRead>,
): Promise<string> {
  const names = await read().catch(() => null);
  return resolveOttoGreetingName(names);
}

/** THE greeting sentence — the single source of the words a merchant reads on the front door.
 *
 *  Lives here, not inline in OttoFrontDoor, so that the component and its tests consume the
 *  SAME string. A test that re-typed this template would stay green while production regressed
 *  (round-2 review P2): it would be asserting against its own copy, not against the product. */
export function ottoGreeting(userName: string): string {
  return `Hi ${ottoGreetingName(userName)} — what should we make today?`;
}
