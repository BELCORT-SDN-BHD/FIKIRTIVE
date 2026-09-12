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
 *  4. SEQUENTIAL-request frame semantics for `runAsUser` across a realistic request shape.
 *     NOTE: this file is NOT the project's `enterWith` oracle — read the docblock on that case
 *     before citing it as one. The load-bearing oracle is the gateway sequential case in
 *     apps/web/lib/__tests__/principal-context.test.ts.
 *  5. Frames are frozen, so a reader cannot rewrite the identity every enclosing frame shares.
 *  6. #1379（TENANT 切片④）：`runAsStaff` builds the third frame kind — a dual-identity check
 *     pins that a `staff` frame and a `user` frame acting on the SAME `ownerId` are structurally
 *     distinct (different `kind`, no `subjectUserId`/`orgRole`/`membershipId` axis on staff) even
 *     though the guard treats their scoped case identically; see `tenant-guard-staff-slice4.test.ts`
 *     for the DB-level half of that claim (staff acting on org A cannot touch org B).
 *
 * No DB access — but packages/db's vitest setup opens the shared *_test client, so this file
 * runs under the same DATABASE_URL guard as its siblings.
 */
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { describe, expect, it } from "vitest";
import {
  getPrincipal,
  runAsSystem,
  runAsStaff,
  runAsTenant,
  runAsUser,
  type Principal,
  type StaffPrincipal,
  type UserPrincipal,
} from "../principal.js";

/**
 * The module deliberately does NOT export this symbol (exporting it would advertise the raw
 * AsyncLocalStorage as a supported handle, and with it `enterWith`/`disable`). It does not need to:
 * `Symbol.for` reads the GLOBAL symbol registry, so this recomputes the identical symbol from the
 * documented string key. This test file is the one sanctioned reach-through — it exists to pin
 * instance identity, not to establish frames.
 */
const PRINCIPAL_STORE_SYMBOL: symbol = Symbol.for("fikirtive.principal.als");

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

/**
 * The frame as STORED, given the identity a caller passed in.
 *
 * A caller hands `runAsUser` identity only; the runner stamps the frame policy (#743 r2). Spelled
 * out here rather than hidden in a loose matcher so these assertions keep failing if the stamp
 * ever goes missing — an unstamped frame reads as writable, which is the whole hazard.
 */
function storedUserFrame(p: UserPrincipal, readOnly = false) {
  return { ...p, readOnly };
}

/** A staff (back-office operator) identity, as `auth-guard.staffPrincipal()` builds it. */
function staffPrincipal(actorEmail: string, ownerId: string | null): StaffPrincipal {
  return { kind: "staff", actorEmail, ownerId };
}

/** The frame as STORED, given the identity a caller passed `runAsStaff`. */
function storedStaffFrame(p: StaffPrincipal, readOnly = false) {
  return { ...p, readOnly };
}

/**
 * Both cases below DERIVE their handle from the documented string key rather than importing a
 * symbol from the module, so the "the module pins its store under `fikirtive.principal.als`"
 * contract is pinned by them directly. (A third case used to assert
 * `PRINCIPAL_STORE_SYMBOL === Symbol.for("fikirtive.principal.als")`; with the export gone that
 * comparison is a tautology, so it was removed rather than kept as a test that cannot fail.)
 */
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
    const seen = pinned.run(
      { kind: "system", reason: "test-seed", ownerId: null, readOnly: false },
      () => getPrincipal(),
    );
    expect(seen).toEqual({ kind: "system", reason: "test-seed", ownerId: null, readOnly: false });
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
      expect(getPrincipal()).toEqual({ kind: "system", reason: "gen-reaper", ownerId: null, readOnly: false });
    });
  });

  it("survives await boundaries", async () => {
    await runAsSystem("stripe-webhook", async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getPrincipal()).toEqual({ kind: "system", reason: "stripe-webhook", ownerId: null, readOnly: false });
    });
  });
});

describe("runAsTenant — the two-phase reaper shape", () => {
  it("nested in a system frame: keeps the reason, adds the tenant", () => {
    runAsSystem("refgen-reaper", () => {
      expect(getPrincipal()).toEqual({ kind: "system", reason: "refgen-reaper", ownerId: null, readOnly: false });
      runAsTenant("org_a", () => {
        expect(getPrincipal()).toEqual({ kind: "system", reason: "refgen-reaper", ownerId: "org_a", readOnly: false });
      });
      // the scan segment is restored, still tenant-less
      expect(getPrincipal()).toEqual({ kind: "system", reason: "refgen-reaper", ownerId: null, readOnly: false });
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
      expect(getPrincipal()).toEqual({ kind: "system", reason: "tenant-direct", ownerId: "org_a", readOnly: false });
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
      expect(getPrincipal()).toEqual(storedUserFrame(p));
    });
    expect(getPrincipal()).toBeUndefined();
  });

  it("returns the callback's value", async () => {
    const seen = await runAsUser(userPrincipal("a"), async () => getPrincipal()?.ownerId);
    expect(seen).toBe("org_a");
  });

  /**
   * Sequential-request frame semantics for `store.run`.
   *
   * THIS CASE DOES NOT DISCRIMINATE `run` FROM `enterWith` — do not cite it as the oracle that
   * rules `enterWith` out. An earlier version of this docblock claimed a measurement
   * ("enterWith → ambient after each request = org_a, org_b, org_c; store.run → undefined").
   * That measurement was re-run on this exact harness and DOES NOT REPRODUCE: substituting
   * `store.enterWith(p); return fn()` for `runAsUser` leaves EVERY assertion below passing
   * (`seen=[org_a,org_b,org_c]`, every ambient check undefined, under both modes). The reason
   * is the per-request `new AsyncResource("REQ").runInAsyncScope(…)` wrapper added to make the
   * case realistic: it gives each request its own async resource, which is precisely what
   * CONTAINS the `enterWith` leak. The claim has been removed rather than repaired.
   *
   * THE LOAD-BEARING ORACLE for the seam property lives in the web package:
   * `apps/web/lib/__tests__/principal-context.test.ts`, the gateway sequential case — its call
   * shape (test body → async gateway → async runMutation → bind → service) is one that DOES
   * leak, and its `expect(getPrincipal()).toBeUndefined()` was measured to FAIL under
   * `enterWith`. If you are here to change the `runAsUser` binding strategy, that is the test
   * that must stay green.
   *
   * What this case still pins, and why it is kept: `store.run` frame semantics across a
   * realistic request shape — each request reads its OWN identity through two awaits, and the
   * frame is fully popped at both ends. That is a real regression surface (a future refactor
   * could drop the wrapper or hoist the bind) even though it is not an enterWith discriminator.
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
              expect(getPrincipal()).toEqual(storedUserFrame(principal));
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
    expect(system).toEqual({ kind: "system", reason: "worker-heartbeat", ownerId: null, readOnly: false });
    expect(none).toBeUndefined();
    expect(getPrincipal()).toBeUndefined();
  });
});

describe("runAsStaff — #1379 TENANT 切片④，第三类帧", () => {
  it("carries actorEmail + the named target tenant, and restores the caller's frame", async () => {
    const p = staffPrincipal("ops@fikirtive.test", "org_a");
    await runAsStaff(p, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getPrincipal()).toEqual(storedStaffFrame(p));
    });
    expect(getPrincipal()).toBeUndefined();
  });

  it("ownerId: null is the platform-wide shape (no single tenant — same structure as a system scan)", () => {
    runAsStaff(staffPrincipal("ops@fikirtive.test", null), () => {
      expect(getPrincipal()).toEqual({
        kind: "staff",
        actorEmail: "ops@fikirtive.test",
        ownerId: null,
        readOnly: false,
      });
    });
  });

  it("returns the callback's value", async () => {
    const seen = await runAsStaff(staffPrincipal("ops@fikirtive.test", "org_a"), async () => getPrincipal()?.ownerId);
    expect(seen).toBe("org_a");
  });

  it("is frozen — a reader cannot rewrite the operator or the target tenant", () => {
    runAsStaff(staffPrincipal("ops@fikirtive.test", "org_a"), () => {
      const staff = getPrincipal()!;
      expect(Object.isFrozen(staff)).toBe(true);
      expect(() => {
        (staff as { ownerId: string | null }).ownerId = "org_victim";
      }).toThrow(TypeError);
      expect(getPrincipal()?.ownerId).toBe("org_a");
    });
  });

  /**
   * 双身份测试（票 #1379 要求）：同一个 `ownerId` 下，一个 `staff` 帧与一个 `user`（商家）帧
   * 结构上不是同一件事 —— `kind` 不同，staff 帧没有 `subjectUserId` / `orgRole` /
   * `membershipId` 这条 membership 轴（它本来就不该有：staff 不是这家店的成员），
   * user 帧也没有 `actorEmail` 这个字段。两种帧絶不会被彼此的读者错认。
   */
  it("dual identity: a staff frame and a user frame on the SAME org are structurally distinct", () => {
    const org = "org_shared";
    let staffSeen: Principal | undefined;
    let userSeen: Principal | undefined;

    runAsStaff(staffPrincipal("ops@fikirtive.test", org), () => {
      staffSeen = getPrincipal();
    });
    runAsUser(userPrincipal("a"), () => {
      // re-point the merchant identity at the SAME org the staff frame just acted on
      userSeen = { ...getPrincipal()!, ownerId: org } as Principal;
    });

    expect(staffSeen?.kind).toBe("staff");
    expect(userSeen?.kind).toBe("user");
    expect(staffSeen).not.toHaveProperty("subjectUserId");
    expect(staffSeen).not.toHaveProperty("orgRole");
    expect(staffSeen).not.toHaveProperty("membershipId");
    expect(userSeen).not.toHaveProperty("actorEmail");
    // both name the same tenant, by construction of this test — that is the point: same
    // `ownerId`, still two irreducibly different identities.
    expect((staffSeen as { ownerId: string | null } | undefined)?.ownerId).toBe(org);
    expect((userSeen as { ownerId: string } | undefined)?.ownerId).toBe(org);
  });

  it("a staff frame nested inside a read-only system frame inherits the restriction (never sheds it)", () => {
    runAsSystem("admin:platform-read", () => {
      runAsStaff(staffPrincipal("ops@fikirtive.test", null), () => {
        expect(getPrincipal()?.readOnly).toBe(true);
      });
    });
  });
});

describe("runAsUser × runAsTenant nesting", () => {
  it("SAME tenant: the user frame passes through untouched (attribution preserved)", () => {
    const p = userPrincipal("a");
    runAsUser(p, () => {
      runAsTenant("org_a", () => {
        expect(getPrincipal()).toEqual(storedUserFrame(p));
        expect(getPrincipal()?.kind).toBe("user");
      });
      // and the user frame is intact afterwards
      expect(getPrincipal()).toEqual(storedUserFrame(p));
    });
  });

  it("DIFFERENT tenant: rejects the switch and preserves the user frame", () => {
    const p = userPrincipal("a");
    runAsUser(p, () => {
      let entered = false;
      expect(() =>
        runAsTenant("org_other", () => {
          entered = true;
        }),
      ).toThrow(/cannot switch tenant/i);
      expect(entered).toBe(false);
      expect(getPrincipal()).toEqual(storedUserFrame(p));
    });
  });

  it("a system frame nested inside a user frame still names itself, tenant-less", () => {
    runAsUser(userPrincipal("a"), () => {
      runAsSystem("gen-reaper", () => {
        expect(getPrincipal()).toEqual({ kind: "system", reason: "gen-reaper", ownerId: null, readOnly: false });
      });
      expect(getPrincipal()?.kind).toBe("user");
    });
  });
});

/**
 * #1419 判官复审 P2-3 —— `runAsTenant` used to not recognize a `kind: "staff"` outer frame at
 * all: falling through to the `system`/`"tenant-direct"` branch silently dropped `actorEmail`
 * AND let a staff frame switch tenants with no check (the `user`-frame mismatch guard above only
 * ever matched `current?.kind === "user"`). That is exactly the "降级洗白" (degrade-and-launder)
 * shape spec §1.6 names for user frames — a real identity mismatch reappearing as an unrelated,
 * unscoped system frame. These pin the same two behaviours `runAsUser × runAsTenant` pins above,
 * for the staff kind: legitimate narrowing from the scan domain, and rejection of a switch away
 * from an already-named tenant.
 */
describe("runAsStaff × runAsTenant nesting", () => {
  it("scan domain (ownerId: null) naming a tenant is a legitimate narrowing — actorEmail carries through, kind stays staff", () => {
    runAsStaff(staffPrincipal("ops@fikirtive.test", null), () => {
      runAsTenant("org_a", () => {
        expect(getPrincipal()).toEqual({
          kind: "staff",
          actorEmail: "ops@fikirtive.test",
          ownerId: "org_a",
          readOnly: false,
        });
      });
      // the scan-domain frame is restored afterwards, still tenant-less
      expect(getPrincipal()).toEqual({
        kind: "staff",
        actorEmail: "ops@fikirtive.test",
        ownerId: null,
        readOnly: false,
      });
    });
  });

  it("SAME already-named tenant: the staff frame passes through untouched (attribution preserved)", () => {
    const p = staffPrincipal("ops@fikirtive.test", "org_a");
    runAsStaff(p, () => {
      runAsTenant("org_a", () => {
        expect(getPrincipal()).toEqual(storedStaffFrame(p));
        expect(getPrincipal()?.kind).toBe("staff");
      });
      expect(getPrincipal()).toEqual(storedStaffFrame(p));
    });
  });

  it("DIFFERENT tenant: rejects the switch and preserves the staff frame — same rule as a user frame, not a system-frame fallback", () => {
    const p = staffPrincipal("ops@fikirtive.test", "org_a");
    runAsStaff(p, () => {
      let entered = false;
      expect(() =>
        runAsTenant("org_other", () => {
          entered = true;
        }),
      ).toThrow(/staff frame cannot switch tenant/i);
      expect(entered).toBe(false);
      // still a staff frame with actorEmail intact — NOT degraded into
      // { kind: "system", reason: "tenant-direct", ownerId: "org_other" }
      expect(getPrincipal()).toEqual(storedStaffFrame(p));
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

/**
 * #463 substitute-review P2-1. `getPrincipal()` hands out the LIVE frame object, and
 * `runAsTenant`'s same-tenant pass-through re-runs with that identical reference — so an
 * unfrozen frame would let a nested reader retroactively rewrite the caller's identity.
 * Harmless while nothing reads the frame; a fail-open hole the moment #464 decides from it.
 */
describe("frames are frozen", () => {
  it("every frame kind is frozen and rejects mutation (ESM = strict mode → throws)", () => {
    runAsSystem("gen-reaper", () => {
      const system = getPrincipal()!;
      expect(Object.isFrozen(system)).toBe(true);
      expect(() => {
        (system as { ownerId: string | null }).ownerId = "org_victim";
      }).toThrow(TypeError);
      expect(getPrincipal()?.ownerId).toBeNull();

      runAsTenant("org_a", () => {
        const tenant = getPrincipal()!;
        expect(Object.isFrozen(tenant)).toBe(true);
        expect(() => {
          (tenant as { ownerId: string | null }).ownerId = "org_victim";
        }).toThrow(TypeError);
        expect(getPrincipal()?.ownerId).toBe("org_a");
      });
    });

    runAsUser(userPrincipal("a"), () => {
      const user = getPrincipal()!;
      expect(Object.isFrozen(user)).toBe(true);
      expect(() => {
        (user as { ownerId: string }).ownerId = "org_victim";
      }).toThrow(TypeError);
      expect(getPrincipal()?.ownerId).toBe("org_a");
    });
  });

  it("stores a defensive COPY, so mutating the caller's own object cannot reach the frame", () => {
    const caller = userPrincipal("a");
    runAsUser(caller, () => {
      // the caller kept a mutable reference to what it built; it must be inert now
      caller.ownerId = "org_victim";
      expect(getPrincipal()?.ownerId).toBe("org_a");
    });
  });

  it("the same-tenant pass-through cannot be used to rewrite the enclosing user frame", () => {
    runAsUser(userPrincipal("a"), () => {
      runAsTenant("org_a", () => {
        expect(Object.isFrozen(getPrincipal()!)).toBe(true);
        expect(() => {
          (getPrincipal() as { ownerId: string }).ownerId = "org_victim";
        }).toThrow(TypeError);
      });
      expect(getPrincipal()?.ownerId).toBe("org_a"); // caller's frame survived intact
    });
  });
});
