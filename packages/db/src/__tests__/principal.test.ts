/**
 * #463 — principal store semantics.
 *
 * These tests pin the three properties the pipeline silently depends on:
 *  1. ONE store instance, pinned on globalThis. A second AsyncLocalStorage object (bundled
 *     copy vs. dist copy) would make getPrincipal() return undefined forever — a fail-open
 *     bug with no other symptom.
 *  2. The two-phase system→tenant nesting the reapers use (scan under a named system reason,
 *     per-row writes under the same reason plus that row's tenant).
 *  3. Async isolation: concurrent chains never see each other's principal.
 *  4. SEQUENTIAL-request isolation for `runAsUser` — the regression that killed the original
 *     design. See the als-probe3 block below: this is the property an `enterWith`-based seam
 *     silently does NOT have, and the reason the seam is a wrapper instead.
 *
 * No DB access — but packages/db's vitest setup opens the shared *_test client, so this file
 * runs under the same DATABASE_URL guard as its siblings.
 */
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { describe, expect, it } from "vitest";
import {
  PRINCIPAL_STORE_SYMBOL,
  getPrincipal,
  runAsSystem,
  runAsTenant,
  runAsUser,
  type Principal,
  type UserPrincipal,
} from "../principal.js";

/** A resolved merchant identity, as the CRM gateways build it (design contract §2-v2). */
function userPrincipal(suffix: string): UserPrincipal {
  return {
    kind: "user",
    subjectUserId: `usr_${suffix}`,
    subjectEmail: `${suffix}@example.test`,
    ownerId: `org_${suffix}`,
    orgRole: "owner",
    membershipId: `mem_${suffix}`,
    impersonating: false,
    impersonatedByBaUserId: null,
  };
}

describe("principal store instance identity", () => {
  it("is pinned on globalThis under the well-known symbol", () => {
    const pinned = (globalThis as unknown as Record<symbol, unknown>)[PRINCIPAL_STORE_SYMBOL];
    expect(pinned).toBeInstanceOf(AsyncLocalStorage);
  });

  it("READS the globalThis-pinned instance (a private second store would fail this)", () => {
    const pinned = (globalThis as unknown as Record<symbol, AsyncLocalStorage<Principal>>)[
      PRINCIPAL_STORE_SYMBOL
    ] as AsyncLocalStorage<Principal>;
    // Enter through the raw pinned store; read through the module's public API.
    const seen = pinned.run({ kind: "system", reason: "test-seed", ownerId: null }, () =>
      getPrincipal(),
    );
    expect(seen).toEqual({ kind: "system", reason: "test-seed", ownerId: null });
  });

  it("the symbol is the documented well-known key", () => {
    expect(PRINCIPAL_STORE_SYMBOL).toBe(Symbol.for("fikirtive.principal.als"));
  });
});

describe("no ambient context", () => {
  it("getPrincipal() is undefined outside any frame", () => {
    expect(getPrincipal()).toBeUndefined();
  });

  it("leaves nothing behind after a frame closes", () => {
    runAsSystem("worker-reaper-tick", () => {
      expect(getPrincipal()?.kind).toBe("system");
    });
    expect(getPrincipal()).toBeUndefined();
  });
});

describe("runAsSystem", () => {
  it("carries the reason with no tenant scope", () => {
    runAsSystem("gen-reaper", () => {
      expect(getPrincipal()).toEqual({ kind: "system", reason: "gen-reaper", ownerId: null });
    });
  });

  it("survives await boundaries", async () => {
    await runAsSystem("stripe-webhook", async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getPrincipal()).toEqual({ kind: "system", reason: "stripe-webhook", ownerId: null });
    });
  });
});

describe("runAsTenant — the two-phase reaper shape", () => {
  it("nested in a system frame: keeps the reason, adds the tenant", () => {
    runAsSystem("refgen-reaper", () => {
      expect(getPrincipal()).toEqual({ kind: "system", reason: "refgen-reaper", ownerId: null });
      runAsTenant("org_a", () => {
        expect(getPrincipal()).toEqual({ kind: "system", reason: "refgen-reaper", ownerId: "org_a" });
      });
      // the scan segment is restored, still tenant-less
      expect(getPrincipal()).toEqual({ kind: "system", reason: "refgen-reaper", ownerId: null });
    });
  });

  it("two sibling rows do not leak into each other", () => {
    runAsSystem("research-reaper", () => {
      runAsTenant("org_a", () => {
        expect(getPrincipal()?.ownerId).toBe("org_a");
      });
      runAsTenant("org_b", () => {
        expect(getPrincipal()?.ownerId).toBe("org_b");
      });
    });
  });

  it("with no ambient frame it names itself tenant-direct", () => {
    runAsTenant("org_a", () => {
      expect(getPrincipal()).toEqual({ kind: "system", reason: "tenant-direct", ownerId: "org_a" });
    });
  });

  it("returns the callback's value", async () => {
    const result = await runAsSystem("publish-reaper", async () =>
      runAsTenant("org_a", async () => getPrincipal()?.ownerId),
    );
    expect(result).toBe("org_a");
  });
});

describe("runAsUser", () => {
  it("carries the whole resolved identity and restores the caller's frame", async () => {
    const p = userPrincipal("a");
    await runAsUser(p, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getPrincipal()).toEqual(p);
    });
    expect(getPrincipal()).toBeUndefined();
  });

  it("returns the callback's value", async () => {
    const seen = await runAsUser(userPrincipal("a"), async () => getPrincipal()?.ownerId);
    expect(seen).toBe("org_a");
  });

  /**
   * THE regression test for #463 (adversarial review P0-1).
   *
   * The shape of `als-probe3.mjs`: each "request" enters its own `AsyncResource`, AWAITS
   * (session + membership lookups) before an identity can exist, then reads the ambient
   * principal after a FURTHER await — three times, sequentially, on one process.
   *
   * WHICH ASSERTION DISCRIMINATES — read this before "simplifying" the case. Substituting
   * `store.enterWith(p); return fn()` for the wrapper and re-running gives:
   *
   *     enterWith: seen=[org_a, org_b, org_c]  ambient AFTER each request = org_a, org_b, org_c
   *     store.run: seen=[org_a, org_b, org_c]  ambient AFTER each request = undefined
   *
   * i.e. `seen` alone is a WEAK oracle — a wrapper-shaped call site reads back its own value
   * either way, because the bind happens immediately before the continuation that reads it. The
   * property that actually separates the two is the ESCAPE: after `enterWith`, request A's
   * identity outlives request A and sits on the process context that request B starts from.
   * That is why `expectNoAmbient()` runs BEFORE and AFTER every request — under `enterWith` the
   * check fails at request B, and again at the top level. Delete those and the case proves
   * nothing.
   */
  it("three SEQUENTIAL requests each read their own identity, and none escapes", async () => {
    const seen: Array<string | null | undefined> = [];
    const expectNoAmbient = () => expect(getPrincipal()).toBeUndefined();

    const simulatedRequest = (suffix: string): Promise<void> =>
      new Promise<void>((settle, fail) => {
        // a fresh async resource per request, exactly as the probe simulates one HTTP request
        new AsyncResource("REQ").runInAsyncScope(() => {
          void (async () => {
            // resolve phase: auth() + prisma — the awaits that make enterWith unsafe
            await new Promise((resolve) => setTimeout(resolve, 1));
            const principal = userPrincipal(suffix);
            await runAsUser(principal, async () => {
              // service phase: more awaits before anyone reads the identity
              await new Promise((resolve) => setTimeout(resolve, 1));
              seen.push(getPrincipal()?.ownerId);
              expect(getPrincipal()).toEqual(principal);
            });
          })().then(settle, fail);
        });
      });

    for (const suffix of ["a", "b", "c"]) {
      expectNoAmbient(); // no residue from the previous request may be visible to this one
      await simulatedRequest(suffix);
      expectNoAmbient(); // and this request leaves none behind for the next
    }

    expect(seen).toEqual(["org_a", "org_b", "org_c"]);
  });

  it("concurrent user requests never observe each other's identity", async () => {
    const observe = async (delayMs: number): Promise<Principal | undefined> => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return getPrincipal();
    };

    const [a, b, system, none] = await Promise.all([
      runAsUser(userPrincipal("a"), async () => observe(5)),
      runAsUser(userPrincipal("b"), async () => observe(1)),
      runAsSystem("worker-heartbeat", async () => observe(4)),
      observe(3),
    ]);

    expect(a).toMatchObject({ kind: "user", ownerId: "org_a" });
    expect(b).toMatchObject({ kind: "user", ownerId: "org_b" });
    expect(system).toEqual({ kind: "system", reason: "worker-heartbeat", ownerId: null });
    expect(none).toBeUndefined();
    expect(getPrincipal()).toBeUndefined();
  });
});

describe("runAsUser × runAsTenant nesting", () => {
  it("SAME tenant: the user frame passes through untouched (attribution preserved)", () => {
    const p = userPrincipal("a");
    runAsUser(p, () => {
      runAsTenant("org_a", () => {
        expect(getPrincipal()).toEqual(p);
        expect(getPrincipal()?.kind).toBe("user");
      });
      // and the user frame is intact afterwards
      expect(getPrincipal()).toEqual(p);
    });
  });

  it("DIFFERENT tenant: degrades to tenant-direct and LOSES the actor (documented trade)", () => {
    const p = userPrincipal("a");
    runAsUser(p, () => {
      runAsTenant("org_other", () => {
        expect(getPrincipal()).toEqual({
          kind: "system",
          reason: "tenant-direct",
          ownerId: "org_other",
        });
      });
      // the user frame is restored — the degradation is scoped to the nested call
      expect(getPrincipal()).toEqual(p);
    });
  });

  it("never throws on the different-tenant path (#463 carries, it does not enforce)", () => {
    expect(() =>
      runAsUser(userPrincipal("a"), () => runAsTenant("org_other", () => undefined)),
    ).not.toThrow();
  });

  it("a system frame nested inside a user frame still names itself, tenant-less", () => {
    runAsUser(userPrincipal("a"), () => {
      runAsSystem("gen-reaper", () => {
        expect(getPrincipal()).toEqual({ kind: "system", reason: "gen-reaper", ownerId: null });
      });
      expect(getPrincipal()?.kind).toBe("user");
    });
  });
});

describe("async isolation", () => {
  it("concurrent chains never observe each other's principal", async () => {
    const observe = async (ownerId: string, delayMs: number): Promise<string | null> => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return getPrincipal()?.ownerId ?? null;
    };

    const [a, b, none] = await Promise.all([
      runAsSystem("gen-reaper", async () => runAsTenant("org_a", async () => observe("org_a", 5))),
      runAsSystem("gen-reaper", async () => runAsTenant("org_b", async () => observe("org_b", 1))),
      observe("none", 3),
    ]);

    expect(a).toBe("org_a");
    expect(b).toBe("org_b");
    expect(none).toBeNull();
  });
});
