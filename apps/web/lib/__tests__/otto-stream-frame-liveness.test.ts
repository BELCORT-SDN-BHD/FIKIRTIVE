/**
 * #464 B1 — the Otto SSE route's frame liveness rests on an `ai` SDK CONSTRUCTION-ORDER
 * property, so this file pins that property against the REAL SDK.
 *
 * THE DEPENDENCY. `app/api/otto/stream/route.ts` opens the user frame, builds the stream, and
 * returns the response:
 *
 *     return runAsUser(principal, async () => {
 *       …
 *       const stream = createUIMessageStream({ execute: async ({ writer }) => { …the whole turn… } });
 *       return createUIMessageStreamResponse({ stream });
 *     });
 *
 * Everything the turn actually does — the agent run, the persistence, the ledger writes — happens
 * inside `execute`, and `execute` keeps running long AFTER the `runAsUser` callback has returned
 * its Response. An AsyncLocalStorage frame is not inherited by wall-clock time; it is inherited by
 * the async resource `execute` runs on. Today `createUIMessageStream` calls `execute(...)`
 * SYNCHRONOUSLY inside its own constructor body (measured on the installed `ai@6.0.208`), i.e.
 * while the `runAsUser` frame is still the current context — so the whole turn inherits the
 * merchant's identity unconditionally and `getPrincipal()` stays live inside it.
 *
 * WHAT IS AND IS NOT CLAIMED (measured, Node v22.22.2 — do not restate this from memory, it is a
 * runtime property and it can move):
 *  - Synchronous invocation is SUFFICIENT and unconditional. That is today's state and assertion
 *    (1) below is its tripwire.
 *  - Synchronous invocation is NOT the only shape that keeps the frame. A lazy variant that
 *    invoked `execute` from the ReadableStream's `pull()` would STILL inherit, as long as the
 *    ReadableStream itself is constructed inside the frame — the pull continuation hangs off the
 *    promise chain rooted at construction, and it survives even a `setTimeout` hop. So a future
 *    `ai` release that lazifies `execute` does not by itself prove the frame is gone.
 *  - What DOES lose the frame is the callback (or the stream) being merely CREATED inside the
 *    frame and invoked later from a foreign async context — the negative control at the bottom.
 *
 * WHY PIN THE SYNCHRONOUS CONTRACT ANYWAY. Because it is the only form of the guarantee that
 * holds without depending on anyone's stream internals. While assertion (1) is green, frame
 * inheritance is a property of OUR call order and needs no further argument. The day it flips,
 * inheritance becomes contingent on where `ai` happens to construct its ReadableStream — a
 * decision made in someone else's repo, which can then change again without a signal. This test
 * turning red is that signal, and the correct response is to RE-MEASURE the new shape, not to
 * assume the frame is either fine or lost.
 *
 * THE COST OF NOT KNOWING. Under #464-B1 nothing enforces the frame, so a silent loss produces no
 * throw, no type error and no failing route test — the merchant's turn simply becomes anonymous.
 * Under B4 ("no frame ⇒ refuse") the same upgrade takes down every paid Otto turn in production.
 *
 * This file therefore does NOT mock `ai`.
 */
import { describe, it, expect } from "vitest";
import { createUIMessageStream } from "ai";
import { getPrincipal, runAsUser, type Principal, type UserPrincipal } from "@fikirtive/db/principal";

const MERCHANT: UserPrincipal = {
  kind: "user",
  subjectUserId: "usr_sse",
  subjectEmail: "merchant@fikirtive.test",
  ownerId: "org_sse",
  orgRole: "owner",
  membershipId: "mem_sse",
  impersonating: false,
  impersonatedByBaUserId: null,
};

function expectMerchantFrame(seen: Principal | undefined, at: string) {
  expect(seen, `ambient principal missing ${at}`).toBeDefined();
  expect(seen!.kind).toBe("user");
  expect(seen).toMatchObject({ kind: "user", ownerId: "org_sse", subjectEmail: "merchant@fikirtive.test" });
}

describe("#464 B1 — Otto SSE frame liveness depends on the ai SDK calling execute synchronously", () => {
  it("invokes execute during construction, so the turn inherits the caller's user frame", async () => {
    let executeInvokedDuringConstruction = false;
    let constructorReturned = false;
    /** Released only AFTER the runAsUser callback has returned — see the assertion below. */
    let releaseTurn: () => void = () => {};
    const turnReachedFirstStatement = Promise.withResolvers<void>();
    const turnFinished = Promise.withResolvers<void>();

    const seen: Record<string, Principal | undefined> = {};

    const response = await runAsUser(MERCHANT, async () => {
      createUIMessageStream({
        execute: async () => {
          // (1) THE TRIPWIRE — the SDK contract, measured rather than assumed: if this body runs
          // at all before `createUIMessageStream` returns, `constructorReturned` is still false.
          executeInvokedDuringConstruction = !constructorReturned;
          seen.atFirstStatement = getPrincipal();
          turnReachedFirstStatement.resolve();

          await Promise.resolve();
          seen.afterMicrotask = getPrincipal();

          // Park here until the route has already returned its Response, then read again: this is
          // where the real turn spends its life (agent run, persistence, ledger writes).
          await new Promise<void>((resolve) => (releaseTurn = resolve));
          seen.afterRouteReturned = getPrincipal();
          turnFinished.resolve();
        },
        onError: (error) => String(error),
      });
      constructorReturned = true;
      await turnReachedFirstStatement.promise;
      return "response-returned" as const;
    });

    expect(response).toBe("response-returned");
    // The route has returned; the enclosing frame is gone HERE...
    expect(getPrincipal()).toBeUndefined();

    releaseTurn();
    await turnFinished.promise;

    expect(
      executeInvokedDuringConstruction,
      "ai's createUIMessageStream no longer calls execute synchronously — the Otto SSE turn's frame " +
        "inheritance is no longer guaranteed by our own call order. RE-MEASURE the new shape " +
        "(see this file's docblock) before assuming it is either safe or broken.",
    ).toBe(true);
    expectMerchantFrame(seen.atFirstStatement, "at execute's first statement");
    expectMerchantFrame(seen.afterMicrotask, "after an await inside execute");
    // ...and yet still live INSIDE the turn, which is the whole point.
    expectMerchantFrame(seen.afterRouteReturned, "after the route returned its Response");
  });

  it("NEGATIVE CONTROL — a stored-and-later-invoked execute silently loses the frame", async () => {
    // The shape that actually breaks inheritance (measured; see docblock): the callback is merely
    // CREATED inside the frame and invoked afterwards from a foreign async context. Reproduced by
    // hand so the guard's value does not rest on anyone believing the prose — and so a reader can
    // see that the loss is silent: no throw, just `undefined`.
    let seenInDeferredExecute: Principal | undefined = MERCHANT;
    let deferred: (() => Promise<void>) | undefined;

    runAsUser(MERCHANT, () => {
      deferred = async () => {
        seenInDeferredExecute = getPrincipal();
      };
    });

    await deferred!();

    expect(seenInDeferredExecute).toBeUndefined();
  });
});
