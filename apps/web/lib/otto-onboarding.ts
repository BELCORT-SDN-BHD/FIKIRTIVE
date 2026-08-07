/**
 * #679 — who still needs to see "Get Otto ready", decided from facts instead of from one
 * browser's localStorage.
 *
 * The card used to be gated on `localStorage["otto:onboarded"]` alone. That key is not the
 * merchant — it is one browser profile on one device. A shop that had been open for three
 * months met the card again the first time it signed in on a phone, and a shop that actually
 * did the two things was never told so, because nothing was tracking them.
 *
 * Every input below is a fact about the WORKSPACE, so the answer is the same on every device
 * the merchant signs in from:
 *
 *  - `dismissed`      — the merchant closed the card; stored on the org (Organization.settings)
 *  - `hasStuff`       — the shop has at least one character or product saved
 *  - `hasBrandMemory` — the shop has taught Otto at least one thing about its brand
 *  - `hasStartedWork` — this project already has a conversation in it
 *
 * `hasStartedWork` is what retires the card for an established shop that never happened to do
 * either task: the card's own promise is "two quick things BEFORE your first project", and a
 * merchant with work in flight is past that moment whatever device they are on.
 *
 * Pure on purpose — the rule is the thing worth pinning, and it should be provable without a
 * database or a page render.
 */
export type OttoOnboardingFacts = {
  dismissed: boolean;
  hasStuff: boolean;
  hasBrandMemory: boolean;
  hasStartedWork: boolean;
};

/** Both tasks done — the card has nothing left to ask for. */
export function ottoOnboardingComplete(facts: Pick<OttoOnboardingFacts, "hasStuff" | "hasBrandMemory">): boolean {
  return facts.hasStuff && facts.hasBrandMemory;
}

/** Show the card only to a workspace that is genuinely still at its first run and has not
 *  waved it away. One task done leaves the card up with that task ticked off — that is the
 *  half of #679 the old gate could not express, because it hid the card the moment either
 *  task was done and so could never show progress. */
export function shouldShowOttoOnboarding(facts: OttoOnboardingFacts): boolean {
  if (facts.dismissed) return false;
  if (facts.hasStartedWork) return false;
  return !ottoOnboardingComplete(facts);
}
