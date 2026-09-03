/**
 * Named regions of the product, so a journey says WHERE it is looking.
 *
 * "Video" appears in more than one place on a signed-in page, and a journey that matched it
 * anywhere would pass on the wrong element — or go red for a change somewhere it was never about.
 * Scoping first is what keeps an assertion's failure legible a month from now.
 */
import { expect, type Page, type Locator } from "@playwright/test";

/**
 * Wait until React has taken ownership of this control — i.e. its handlers are attached — before
 * a journey drives it (#981).
 *
 * THE DEFECT THIS CLOSES, because it is not the one it looks like. A control reaches the DOM some
 * time before the client bundle hydrates it, and in that window it is inert: an event dispatched
 * at it finds no fiber, so React drops it on the floor and does NOT replay it when hydration
 * catches up. The interaction is lost PERMANENTLY, and the journey then spends its whole budget
 * waiting for an effect that can no longer happen. Measured on this suite (#981): the composer's
 * file input is in the DOM at +169 ms and hydrated at +357 ms, and the upload it kicks off — WASM
 * hasher, both server actions, the DB rows — takes 229 ms end to end. A 15-second wait was never
 * short; the event that was supposed to start the work never reached the handler.
 *
 * WHY WAITING FOR THE CONTROL TO BE *VISIBLE* IS NOT THE SAME THING, and why journey 13 is the one
 * that needs this. Playwright's actionability checks cover visible/stable/enabled — never
 * hydrated — but for most controls the two happen to coincide, because the control only gets laid
 * out when React commits the subtree. `signIn`'s own wait for the global navigation is that kind
 * of signal, and journey 12's wait for the rail toggle is another. The composer's file input has
 * NO such signal: it is `className="hidden"`, so it has no visibility to wait on and
 * `setInputFiles` skips the actionability checks entirely. It is the one control this suite drives
 * that can be driven while it is still dead.
 *
 * WHY THE PROBE IS A REACT INTERNAL, deliberately. `__reactProps$…` is the object React DOM hangs
 * on a host node once it owns it, and it is literally where the `onChange` this journey depends on
 * lives — so this asks the one question that matters ("is the handler attached yet?") instead of
 * approximating it with a sleep, a network-idle guess, or a wider timeout. If React ever renames
 * that key, this helper stops finding it and the journey fails HERE, naming this file, rather than
 * somewhere downstream as a mystery.
 *
 * WHAT IT IS NOT: extra budget. In a healthy run this returns in well under a second, and the
 * journey's own assertions keep the timeouts they always had.
 */
export async function waitUntilInteractive(locator: Locator): Promise<void> {
  await locator.waitFor({ state: "attached" });
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))), {
      message: "the page never hydrated this control, so any click or file drop on it would be discarded",
    })
    .toBe(true);
}

/** The spend history list on /billing — one row per thing that happened to the credits.
 *
 *  Anchored on the section that owns the "Spend history" heading. It used to be anchored on
 *  `[data-slot="card"]`, because the shell drew the card title as a styled <div> and
 *  `getByRole("heading")` matched nothing. 前端基线第⑦段(FRONT-A11)按已冻结的 Settings
 *  screen pattern §3.3 把 /billing 去卡片化了 —— 这一节现在是一个 <section>,标题是真的
 *  <h2>,页面上再没有 `[data-slot="card"]`。旧锚点会交回一个**空** locator,下游读起来是
 *  「产品没显示这个」而不是「journey 找错地方」,所以锚点跟着结构一起搬。 */
export function spendHistory(page: Page): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Spend history", exact: true }) });
}

/** The persistent left rail: identity, the credits figure, and the way out. */
export function globalNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Global navigation" });
}

/** The rail's credits row — the ONE balance the merchant carries with them on every screen.
 *
 *  Journey 7 needs it by name: after the shell swap it is the second place (besides
 *  /billing) that prints a balance, so it is the other half of "the two wallet surfaces
 *  agree". Anchored on the row's own data attribute rather than on the number, because a
 *  journey that matched the number anywhere would pass on the page's own balance card and
 *  prove nothing. */
export function railCredits(page: Page): Locator {
  return page.locator("[data-nav-rail-credits]");
}
