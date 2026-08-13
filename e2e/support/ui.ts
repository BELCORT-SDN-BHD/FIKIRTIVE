/**
 * Named regions of the product, so a journey says WHERE it is looking.
 *
 * "Video" appears in more than one place on a signed-in page, and a journey that matched it
 * anywhere would pass on the wrong element — or go red for a change somewhere it was never about.
 * Scoping first is what keeps an assertion's failure legible a month from now.
 */
import type { Page, Locator } from "@playwright/test";

/** The spend history list on /billing — one row per thing that happened to the credits. */
export function spendHistory(page: Page): Locator {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Spend history" }) });
}

/** The persistent left rail: identity, the credits figure, and the way out. */
export function globalNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Global navigation" });
}
