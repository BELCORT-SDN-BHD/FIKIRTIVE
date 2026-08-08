import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  evaluateSendEligibility,
  expireProviderRefusal,
  prisma,
  recordConsentEvent,
  recordContactDndEvent,
  recordProviderRefusalEvent,
  recordSendFrequencyEvent,
  recordUnqualifiedStop,
  SEND_FREQUENCY_POLICY,
  SendEligibilityError,
  type EligibilityAxis,
  type Prisma,
  type SendEligibilityDb,
  type SendEligibilityResult,
} from "./index.js";

const ORG_A = "eligibility-org-a";
const ORG_B = "eligibility-org-b";
const CONTACT_A = "eligibility-contact-a";
const CONTACT_A2 = "eligibility-contact-a2";
const CONTACT_B = "eligibility-contact-b";
const CONNECTION_A = "eligibility-connection-a";
const IDENTITY_A = "eligibility-identity-a";
const IDENTITY_A2 = "eligibility-identity-a2";
const IDENTITY_B = "eligibility-identity-b";
const NOW = new Date("2026-07-21T00:00:00.000Z");

beforeEach(async () => {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.contact.createMany({
    data: [
      { id: CONTACT_A, ownerId: ORG_A, name: "Aisyah", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW },
      { id: CONTACT_A2, ownerId: ORG_A, name: "Bakri", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW },
      { id: CONTACT_B, ownerId: ORG_B, name: "Mei", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW },
    ],
  });
  await prisma.channelConnection.createMany({
    data: [
      { id: CONNECTION_A, ownerId: ORG_A, kind: "whatsapp", externalId: "wa-business-a", accessTokenEnc: "ciphertext-a" },
    ],
  });
  await prisma.contactIdentity.createMany({
    data: [
      { id: IDENTITY_A, ownerId: ORG_A, contactId: CONTACT_A, channel: "whatsapp", externalId: "+60111111111" },
      { id: IDENTITY_A2, ownerId: ORG_A, contactId: CONTACT_A2, channel: "whatsapp", externalId: "+60111111112" },
      { id: IDENTITY_B, ownerId: ORG_B, contactId: CONTACT_B, channel: "whatsapp", externalId: "+60222222222" },
    ],
  });
});

function baseInput(overrides: Partial<Parameters<typeof evaluateSendEligibility>[1]> = {}) {
  return {
    ownerId: ORG_A,
    contactId: CONTACT_A,
    contactIdentityId: IDENTITY_A,
    channel: "whatsapp",
    purpose: "marketing" as const,
    providerConnectionId: CONNECTION_A,
    callerClass: "merchant_manual" as const,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createFrequencyP2002RaceDb(idempotencyKey: string) {
  const bothInitialReadsFinished = deferred<void>();
  let initialReadCount = 0;
  let p2002Count = 0;

  const db = new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
          try {
            return await target.$transaction(async (tx) => {
              const frequencyDelegate = tx.contactSendFrequencyEvent;
              const proxiedFrequencyDelegate = new Proxy(frequencyDelegate, {
                get(delegateTarget, delegateProp, delegateReceiver) {
                  const value = Reflect.get(delegateTarget, delegateProp, delegateReceiver);
                  if (delegateProp === "findFirst" && typeof value === "function") {
                    return async (...args: unknown[]) => {
                      const result = await Reflect.apply(value, delegateTarget, args);
                      const where = (
                        args[0] as { where?: { idempotencyKey?: string } } | undefined
                      )?.where;
                      if (
                        where?.idempotencyKey === idempotencyKey &&
                        result === null &&
                        initialReadCount < 2
                      ) {
                        initialReadCount += 1;
                        if (initialReadCount === 2) bothInitialReadsFinished.resolve();
                        await bothInitialReadsFinished.promise;
                      }
                      return result;
                    };
                  }
                  return typeof value === "function" ? value.bind(delegateTarget) : value;
                },
              });
              const proxiedTx = new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp === "contactSendFrequencyEvent") return proxiedFrequencyDelegate;
                  if (txProp === "$executeRaw") {
                    // The production advisory lock makes same-payload P2002 unreachable. This
                    // harness removes only that lock while keeping two real PostgreSQL
                    // transactions, forcing both initial reads to see no row and one INSERT to
                    // lose at the unique constraint. The recovery path therefore sees genuine
                    // PostgreSQL aborted-transaction semantics.
                    return async () => 0;
                  }
                  const value = Reflect.get(txTarget, txProp, txReceiver);
                  return typeof value === "function" ? value.bind(txTarget) : value;
                },
              }) as Prisma.TransactionClient;
              return callback(proxiedTx);
            });
          } catch (error) {
            if (
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "P2002"
            ) {
              p2002Count += 1;
            }
            throw error;
          }
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as typeof prisma;

  return { db, p2002Count: () => p2002Count };
}

// A db proxy that throws on one model's read methods — the only way to exercise the
// "projection/state physically unreadable" branch (§4.2.1's unavailable row), since every
// other axis outcome comes from real, legitimately-absent rows rather than a read error.
function unreadable(model: "consentStateProjection" | "contact" | "providerRefusalState" | "contactSendFrequencyEvent"): SendEligibilityDb {
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === model) {
        const real = Reflect.get(target, prop, receiver) as unknown as Record<string, unknown>;
        return new Proxy(real, {
          get(mtarget, mprop) {
            if (mprop === "findUnique" || mprop === "findFirst" || mprop === "count") {
              return async () => {
                throw new Error("forced unreadable for test");
              };
            }
            return Reflect.get(mtarget, mprop, mtarget);
          },
        });
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as SendEligibilityDb;
}

describe("C5-M2 consentStop axis — §4.2.1 3x2 matrix + unreadable", () => {
  beforeEach(async () => {
    // marketing tuple: customer-interactive verified revoke -> effective_revoke
    await recordConsentEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purpose: "marketing",
      sourceKind: "unsubscribe_link",
      action: "revoke",
      evidenceRef: "evidence:unsub",
      idempotencyKey: "eligibility-test:unsub",
    });
    // review_request tuple: customer-interactive verified grant -> verified_grant
    await recordConsentEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purpose: "review_request",
      sourceKind: "explicit_inbox_optin",
      action: "grant",
      evidenceRef: "evidence:optin",
      idempotencyKey: "eligibility-test:optin",
    });
    // transactional tuple: no events at all -> fold-null -> consent state "unknown"
  });

  it("verified_grant -> pass for both callerClasses", async () => {
    for (const callerClass of ["merchant_manual", "unconfirmed_automatic"] as const) {
      const result = await evaluateSendEligibility(prisma, baseInput({ purpose: "review_request", callerClass }));
      expect(result.consentStop).toMatchObject({ status: "pass", source: "consent_state_projection" });
    }
  });

  it("unknown (fold-null) -> risk for merchant_manual, block for unconfirmed_automatic", async () => {
    const risk = await evaluateSendEligibility(
      prisma,
      baseInput({ purpose: "transactional", callerClass: "merchant_manual" }),
    );
    expect(risk.consentStop).toMatchObject({ status: "risk", reason: "consent_unknown_d5_eligible" });
    const block = await evaluateSendEligibility(
      prisma,
      baseInput({ purpose: "transactional", callerClass: "unconfirmed_automatic" }),
    );
    expect(block.consentStop).toMatchObject({ status: "block" });
  });

  it("effective_revoke -> block for both callerClasses (D5-eligible only via merchant_manual)", async () => {
    for (const callerClass of ["merchant_manual", "unconfirmed_automatic"] as const) {
      const result = await evaluateSendEligibility(prisma, baseInput({ purpose: "marketing", callerClass }));
      expect(result.consentStop).toMatchObject({ status: "block", reason: "effective_revoke" });
    }
  });

  it("D4 unqualified STOP hits both marketing and review_request tuples simultaneously", async () => {
    await recordUnqualifiedStop({
      ownerId: ORG_A,
      contactId: CONTACT_A2,
      channel: "whatsapp",
      sourceKind: "stop_keyword",
      channelEventRef: "wa-webhook-1",
      opaqueMessageId: "msg-1",
    });
    for (const purpose of ["marketing", "review_request"] as const) {
      const result = await evaluateSendEligibility(
        prisma,
        baseInput({ contactId: CONTACT_A2, contactIdentityId: IDENTITY_A2, purpose, callerClass: "merchant_manual" }),
      );
      expect(result.consentStop).toMatchObject({ status: "block", reason: "effective_revoke" });
    }
  });

  it("physically-unreadable projection -> unavailable for both callerClasses (never axis-unknown for a resolved state)", async () => {
    for (const callerClass of ["merchant_manual", "unconfirmed_automatic"] as const) {
      const result = await evaluateSendEligibility(
        unreadable("consentStateProjection"),
        baseInput({ purpose: "marketing", callerClass }),
      );
      expect(result.consentStop.status).toBe("unavailable");
    }
  });

  it("reactive_service_reply is an independent send class: consent-STOP always pass, not consent-purpose-gated", async () => {
    const result = await evaluateSendEligibility(
      prisma,
      baseInput({ purpose: "reactive_service_reply", callerClass: "unconfirmed_automatic" }),
    );
    expect(result.consentStop).toEqual({
      status: "pass",
      source: "reactive_service_reply_not_consent_gated",
      checkedAt: result.consentStop.checkedAt,
    });
  });
});

/**
 * #806 — the projection is not the whole consent authority. A customer whose only opt-out record
 * is the pre-ledger `Contact.marketingConsent` column has no projection row at all, so this axis
 * called an audience-wide known opt-out "consent unknown" and handed `merchant_manual` — which is
 * what a broadcast and the inbox both are — the D5-overridable `risk` tier.
 */
describe("C5 consentStop axis — the pre-ledger fence is part of the authority (#806)", () => {
  const FENCED_A = "eligibility-contact-fenced-a";
  const FENCED_IDENTITY_A = "eligibility-identity-fenced-a";
  const FENCED_B = "eligibility-contact-fenced-b";
  const FENCED_IDENTITY_B = "eligibility-identity-fenced-b";

  beforeEach(async () => {
    await prisma.contact.createMany({
      data: [
        { id: FENCED_A, ownerId: ORG_A, name: "Chandra", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW, marketingConsent: "opt_out" },
        { id: FENCED_B, ownerId: ORG_B, name: "Siti", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW, marketingConsent: "opt_out" },
      ],
    });
    await prisma.contactIdentity.createMany({
      data: [
        { id: FENCED_IDENTITY_A, ownerId: ORG_A, contactId: FENCED_A, channel: "whatsapp", externalId: "+60111111119" },
        { id: FENCED_IDENTITY_B, ownerId: ORG_B, contactId: FENCED_B, channel: "whatsapp", externalId: "+60222222229" },
      ],
    });
  });

  function fencedInput(overrides: Partial<Parameters<typeof evaluateSendEligibility>[1]> = {}) {
    return baseInput({ contactId: FENCED_A, contactIdentityId: FENCED_IDENTITY_A, ...overrides });
  }

  it("blocks a pre-ledger opt-out for BOTH callerClasses — never the D5-overridable risk tier", async () => {
    for (const callerClass of ["merchant_manual", "unconfirmed_automatic"] as const) {
      const result = await evaluateSendEligibility(prisma, fencedInput({ callerClass }));
      expect(result.consentStop).toMatchObject({
        status: "block",
        source: "consent_legacy_mirror",
        reason: "unresolved_legacy_opt_out",
      });
    }
  });

  it("leaves a contact with no legacy record on the unchanged 3x2 mapping", async () => {
    const merchant = await evaluateSendEligibility(prisma, baseInput({ contactId: CONTACT_A2, contactIdentityId: IDENTITY_A2 }));
    expect(merchant.consentStop).toMatchObject({ status: "risk", reason: "consent_unknown_d5_eligible" });
    const automatic = await evaluateSendEligibility(
      prisma,
      baseInput({ contactId: CONTACT_A2, contactIdentityId: IDENTITY_A2, callerClass: "unconfirmed_automatic" }),
    );
    expect(automatic.consentStop).toMatchObject({
      status: "block",
      reason: "consent_unknown_unconfirmed_automatic_hard_block",
    });
  });

  it("reads the legacy column only in the one scope it mirrors (R-010 §4.6.1)", async () => {
    const otherPurpose = await evaluateSendEligibility(prisma, fencedInput({ purpose: "review_request" }));
    expect(otherPurpose.consentStop).toMatchObject({ status: "risk", reason: "consent_unknown_d5_eligible" });
    const otherChannel = await evaluateSendEligibility(prisma, fencedInput({ channel: "instagram" }));
    expect(otherChannel.consentStop).toMatchObject({ status: "risk", reason: "consent_unknown_d5_eligible" });
  });

  it("lifts the fence only on the customer's own verified evidence, never on the stale byte alone", async () => {
    await prisma.consentStateProjection.create({
      data: {
        ownerId: ORG_A,
        contactId: FENCED_A,
        channel: "whatsapp",
        purpose: "marketing",
        state: "verified_grant",
        lastEventId: "eligibility-test:fence-optin",
        lastReceivedAt: NOW,
        stateActorKind: "customer",
        stateSourceKind: "explicit_inbox_optin",
        evidenceStatus: "verified",
      },
    });
    const contact = await prisma.contact.findFirstOrThrow({ where: { id: FENCED_A, ownerId: ORG_A } });
    expect(contact.marketingConsent).toBe("opt_out"); // the stale byte is still there
    const result = await evaluateSendEligibility(prisma, fencedInput());
    expect(result.consentStop).toMatchObject({ status: "pass", source: "consent_state_projection" });
  });

  it("still answers a verified revoke from the projection, not from the mirror", async () => {
    await prisma.consentStateProjection.create({
      data: {
        ownerId: ORG_A,
        contactId: FENCED_A,
        channel: "whatsapp",
        purpose: "marketing",
        state: "effective_revoke",
        lastEventId: "eligibility-test:fence-revoke",
        lastReceivedAt: NOW,
        stateActorKind: "customer",
        stateSourceKind: "stop_keyword",
        evidenceStatus: "verified",
      },
    });
    const result = await evaluateSendEligibility(prisma, fencedInput());
    expect(result.consentStop).toMatchObject({ status: "block", reason: "effective_revoke" });
  });

  it("fails closed when the legacy mirror is physically unreadable", async () => {
    const result = await evaluateSendEligibility(unreadable("contact"), fencedInput());
    expect(result.consentStop).toMatchObject({ status: "unavailable", reason: "legacy_mirror_unreadable" });
  });

  it("never lets one tenant's legacy column decide another tenant's send", async () => {
    // ORG_B's fenced contact read under ORG_A does not exist, so its opt-out cannot be borrowed
    // and no other row is substituted for it. The DND axis is what reports the missing contact.
    const crossed = await evaluateSendEligibility(
      prisma,
      fencedInput({ contactId: FENCED_B, contactIdentityId: FENCED_IDENTITY_B }),
    );
    expect(crossed.consentStop).toMatchObject({ status: "risk", reason: "consent_unknown_d5_eligible" });
    expect(crossed.doNotDisturb).toMatchObject({ status: "unavailable", reason: "contact_not_found_in_tenant" });

    const own = await evaluateSendEligibility(prisma, {
      ...fencedInput({ contactId: FENCED_B, contactIdentityId: FENCED_IDENTITY_B }),
      ownerId: ORG_B,
    });
    expect(own.consentStop).toMatchObject({ status: "block", reason: "unresolved_legacy_opt_out" });
  });
});

describe("C5-M2 doNotDisturb axis — Contact-wide, no risk tier, not D5-bypassable", () => {
  it("no DND fact -> pass", async () => {
    const result = await evaluateSendEligibility(prisma, baseInput());
    expect(result.doNotDisturb).toMatchObject({ status: "pass", source: "contact_dnd_fold" });
  });

  it("DND set -> block for BOTH callerClasses identically (no D5 override exists for this axis)", async () => {
    await recordContactDndEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      sourceKind: "crm_ui",
      action: "set",
      idempotencyKey: "eligibility-test:dnd-set",
    });
    for (const callerClass of ["merchant_manual", "unconfirmed_automatic"] as const) {
      const result = await evaluateSendEligibility(prisma, baseInput({ callerClass }));
      expect(result.doNotDisturb).toMatchObject({ status: "block", reason: "dnd_set" });
    }
  });

  it("DND clear does not manufacture grant, only lifts the block", async () => {
    await recordContactDndEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      sourceKind: "crm_ui",
      action: "set",
      idempotencyKey: "eligibility-test:dnd-set-2",
    });
    await recordContactDndEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      sourceKind: "crm_ui",
      action: "clear",
      idempotencyKey: "eligibility-test:dnd-clear",
    });
    const result = await evaluateSendEligibility(prisma, baseInput());
    expect(result.doNotDisturb).toMatchObject({ status: "pass" });
    // Clearing DND must never touch consent state.
    expect(["risk", "block"]).toContain(result.consentStop.status);
  });

  it("physically-unreadable fold -> unavailable", async () => {
    const result = await evaluateSendEligibility(unreadable("contact"), baseInput());
    expect(result.doNotDisturb.status).toBe("unavailable");
  });

  it("cross-tenant contactId under the wrong ownerId fails closed (unavailable), never leaks or falsely passes", async () => {
    const result = await evaluateSendEligibility(
      prisma,
      baseInput({ contactId: CONTACT_B, contactIdentityId: IDENTITY_B }),
    );
    expect(result.doNotDisturb).toMatchObject({ status: "unavailable", reason: "contact_not_found_in_tenant" });
  });
});

describe("C5-M2 providerRefusal axis — recipient/account scope, transient never blocks", () => {
  it("no provider connection resolved -> pass (empty state, never a fabricated unavailable)", async () => {
    const result = await evaluateSendEligibility(prisma, baseInput({ providerConnectionId: null }));
    expect(result.providerRefusal).toMatchObject({ status: "pass", reason: "no_provider_connection" });
  });

  it("empty ProviderRefusalState scope (never refused) -> pass", async () => {
    const result = await evaluateSendEligibility(prisma, baseInput());
    expect(result.providerRefusal).toMatchObject({ status: "pass", source: "provider_refusal_state" });
  });

  it("permanent_recipient block -> block, scoped only to that recipient (isolation)", async () => {
    await recordProviderRefusalEvent({
      ownerId: ORG_A,
      providerConnectionId: CONNECTION_A,
      channel: "whatsapp",
      contactIdentityId: IDENTITY_A,
      kind: "permanent_recipient",
      action: "block",
      providerCode: "recipient_unavailable",
      receiptRef: "receipt:1",
      idempotencyKey: "eligibility-test:refusal-block",
    });
    const blocked = await evaluateSendEligibility(prisma, baseInput());
    expect(blocked.providerRefusal).toMatchObject({ status: "block", reason: "permanent_recipient_block" });
    // A different recipient on the same connection is untouched.
    const other = await evaluateSendEligibility(
      prisma,
      baseInput({ contactId: CONTACT_A2, contactIdentityId: IDENTITY_A2 }),
    );
    expect(other.providerRefusal).toMatchObject({ status: "pass" });
  });

  it("account_level block stays blocked past a claimed expiresAt until an explicit system expire event is appended", async () => {
    const past = new Date(Date.now() - 60_000);
    const blockResult = await recordProviderRefusalEvent({
      ownerId: ORG_A,
      providerConnectionId: CONNECTION_A,
      kind: "account_level",
      action: "block",
      providerCode: "account_suspended",
      receiptRef: "receipt:account-1",
      idempotencyKey: "eligibility-test:account-block",
      expiresAt: past,
    });
    const stillBlocked = await evaluateSendEligibility(prisma, baseInput());
    // Wall clock has already passed `past`, but no expire event has been appended — must
    // still read block (§4.3: no implicit lifting by wall clock alone).
    expect(stillBlocked.providerRefusal).toMatchObject({ status: "block", reason: "account_level_block" });

    await expireProviderRefusal({ ownerId: ORG_A, blockEventId: blockResult.eventIds[0]! });
    const lifted = await evaluateSendEligibility(prisma, baseInput());
    expect(lifted.providerRefusal).toMatchObject({ status: "pass" });
  });

  it("transient refusal never enters the block projection", async () => {
    await recordProviderRefusalEvent({
      ownerId: ORG_A,
      providerConnectionId: CONNECTION_A,
      kind: "transient",
      action: "observe",
      channel: "whatsapp",
      contactIdentityId: IDENTITY_A,
      providerCode: "rate_limited",
      receiptRef: "receipt:transient-1",
      idempotencyKey: "eligibility-test:transient",
    });
    const result = await evaluateSendEligibility(prisma, baseInput());
    expect(result.providerRefusal).toMatchObject({ status: "pass" });
  });

  it("physically-unreadable state -> unavailable", async () => {
    const result = await evaluateSendEligibility(unreadable("providerRefusalState"), baseInput());
    expect(result.providerRefusal.status).toBe("unavailable");
  });
});

describe("C5-M2 frequency axis — rolling window, proactive-only, missing config fails closed", () => {
  it("transactional and reactive_service_reply are never counted or gated", async () => {
    for (const purpose of ["transactional", "reactive_service_reply"] as const) {
      const result = await evaluateSendEligibility(prisma, baseInput({ purpose }));
      expect(result.frequency).toMatchObject({ status: "pass", reason: "not_proactive_not_counted" });
    }
  });

  it("under cap -> pass; at/over cap -> block", async () => {
    const before = await evaluateSendEligibility(prisma, baseInput());
    expect(before.frequency).toMatchObject({ status: "pass" });

    await recordSendFrequencyEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purposeClass: "proactive_non_transactional",
      sourceKind: "broadcast_run",
      sendRef: "run-1:member-1",
      simulated: true,
      idempotencyKey: "freq:eligibility-test:run-1:identity-a:whatsapp:proactive_non_transactional",
    });
    const after = await evaluateSendEligibility(prisma, baseInput());
    expect(after.frequency).toMatchObject({ status: "block", reason: "frequency_cap_reached" });
  });

  it("a row outside the rolling window does not count against the cap", async () => {
    await prisma.contactSendFrequencyEvent.create({
      data: {
        id: "eligibility-test-stale-freq-row",
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purposeClass: "proactive_non_transactional",
        sourceKind: "broadcast_run",
        sendRef: "stale-run:member-1",
        simulated: true,
        idempotencyKey: "freq:eligibility-test:stale-run:identity-a:whatsapp:proactive_non_transactional",
        countedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // outside the 24h whatsapp window
      },
    });
    const result = await evaluateSendEligibility(prisma, baseInput());
    expect(result.frequency).toMatchObject({ status: "pass" });
  });

  it("missing channel policy fails closed to unavailable, never optimistically pass", async () => {
    expect(SEND_FREQUENCY_POLICY.instagram).toBeUndefined();
    const result = await evaluateSendEligibility(prisma, baseInput({ channel: "instagram" }));
    expect(result.frequency).toMatchObject({ status: "unavailable", reason: "missing_channel_policy" });
  });

  it("physically-unreadable counter -> unavailable", async () => {
    const result = await evaluateSendEligibility(unreadable("contactSendFrequencyEvent"), baseInput());
    expect(result.frequency.status).toBe("unavailable");
  });
});

describe("C5-M2 aggregate stays the M1-M3 unavailable branch", () => {
  it("never returns AggregateDisposition regardless of axis outcomes", async () => {
    const result = await evaluateSendEligibility(prisma, baseInput());
    expect(result.aggregate).toEqual({ status: "unavailable", reason: "SEND_PATH_UNAVAILABLE" });
  });
});

describe("C5-M2 §11.2 four axes stay independently named, never merged (ledger review round)", () => {
  it("SendEligibilityResult keeps the four axes as separate named fields, each shaped as EligibilityAxis (§11.2, §3.2: no merged suppression/allow list, no single boolean)", () => {
    // Type-shape assertion (checked by `tsc`/typecheck, not by the JS runtime): the result's
    // key set is EXACTLY the four axes plus aggregate/checkedAt. Collapsing the four axes into
    // one boolean, one merged list, or a fifth field would change this key union and fail
    // typecheck.
    expectTypeOf<keyof SendEligibilityResult>().toEqualTypeOf<
      "consentStop" | "doNotDisturb" | "providerRefusal" | "frequency" | "aggregate" | "checkedAt"
    >();
    // Each of the four axes independently keeps the full {status, source, reason?, checkedAt}
    // shape — not a bare boolean, not a shared/merged object.
    expectTypeOf<SendEligibilityResult["consentStop"]>().toEqualTypeOf<EligibilityAxis>();
    expectTypeOf<SendEligibilityResult["doNotDisturb"]>().toEqualTypeOf<EligibilityAxis>();
    expectTypeOf<SendEligibilityResult["providerRefusal"]>().toEqualTypeOf<EligibilityAxis>();
    expectTypeOf<SendEligibilityResult["frequency"]>().toEqualTypeOf<EligibilityAxis>();
    // aggregate stays the fixed M1-M3 unavailable literal (§4.4) — never a general boolean and
    // never widened into whatever the merged-axis verdict would be.
    expectTypeOf<SendEligibilityResult["aggregate"]>().toEqualTypeOf<{
      status: "unavailable";
      reason: "SEND_PATH_UNAVAILABLE";
    }>();

    // Static source-text scan: neither the evaluator nor the one caller that folds these axes
    // into a broadcast-member verdict may fold the four axes into a single boolean or a merged
    // suppression/block list identifier.
    const dbSource = readFileSync(path.join(__dirname, "send-eligibility.ts"), "utf8");
    const webSource = readFileSync(
      path.join(__dirname, "../../../apps/web/lib/customer-broadcast-service.ts"),
      "utf8",
    );
    const collapsePatterns = [/\bsuppressionList\b/i, /\bsuppressionSet\b/i, /\bblocklist\b/i, /\bmergedEligibility\b/i];
    for (const source of [dbSource, webSource]) {
      for (const pattern of collapsePatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
    // aggregate's literal in the evaluator itself is always the M1-M3 unavailable branch —
    // never a computed/merged verdict over the four axes.
    expect(dbSource).toContain('aggregate: { status: "unavailable", reason: "SEND_PATH_UNAVAILABLE" }');
  });
});

describe("C5-M2 frozen-verdict-cannot-authorize (evaluator has no caching, always live-reads)", () => {
  it("a later evaluate() reflects a consent flip that happened after an earlier pass read", async () => {
    await recordConsentEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purpose: "marketing",
      sourceKind: "explicit_inbox_optin",
      action: "grant",
      evidenceRef: "evidence:frozen-verdict-grant",
      idempotencyKey: "eligibility-test:frozen-verdict-grant",
    });
    const frozenMoment = await evaluateSendEligibility(prisma, baseInput());
    expect(frozenMoment.consentStop).toMatchObject({ status: "pass" });

    // Simulates the contact revoking between "freeze" time and a later re-read at execution
    // time — §6.2 requires execution to RE-READ live authority, never trust the frozen PASS.
    await recordConsentEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purpose: "marketing",
      sourceKind: "unsubscribe_link",
      action: "revoke",
      evidenceRef: "evidence:frozen-verdict-revoke",
      idempotencyKey: "eligibility-test:frozen-verdict-revoke",
    });
    const liveReread = await evaluateSendEligibility(prisma, baseInput());
    expect(liveReread.consentStop).toMatchObject({ status: "block", reason: "effective_revoke" });
    // The earlier snapshot is untouched (it really was a point-in-time read, not a live view).
    expect(frozenMoment.consentStop).toMatchObject({ status: "pass" });
  });
});

describe("C5-M2 recordSendFrequencyEvent — exactly-once writer", () => {
  async function countRows(contactId: string) {
    return prisma.contactSendFrequencyEvent.count({ where: { ownerId: ORG_A, contactId } });
  }

  it("writes exactly one row and returns it on retry with the same idempotencyKey", async () => {
    const input = {
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purposeClass: "proactive_non_transactional" as const,
      sourceKind: "broadcast_run" as const,
      sendRef: "run-2:member-1",
      simulated: true,
      idempotencyKey: "freq:eligibility-test:run-2:identity-a:whatsapp:proactive_non_transactional",
    };
    const first = await recordSendFrequencyEvent(input);
    const retry = await recordSendFrequencyEvent(input);
    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(retry.id).toBe(first.id);
    expect(await countRows(CONTACT_A)).toBe(1);
  });

  it("unwinds a genuine concurrent P2002 before re-reading the same semantic event as a replay", async () => {
    const idempotencyKey =
      "freq:eligibility-test:p2002-same:identity-a:whatsapp:proactive_non_transactional";
    const input = {
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purposeClass: "proactive_non_transactional" as const,
      sourceKind: "broadcast_run" as const,
      sendRef: "run-p2002-same:member-1",
      simulated: true,
      idempotencyKey,
    };
    const race = createFrequencyP2002RaceDb(idempotencyKey);
    const settled = await Promise.allSettled([
      recordSendFrequencyEvent(input, race.db),
      recordSendFrequencyEvent(input, race.db),
    ]);

    expect(race.p2002Count()).toBe(1);
    expect(settled.every((result) => result.status === "fulfilled")).toBe(true);
    const fulfilled = settled.map((result) => {
      if (result.status !== "fulfilled") throw result.reason;
      return result.value;
    });
    expect(fulfilled.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(new Set(fulfilled.map((result) => result.id)).size).toBe(1);

    const winner = await prisma.contactSendFrequencyEvent.findFirstOrThrow({
      where: { ownerId: ORG_A, idempotencyKey },
    });
    expect(winner).toMatchObject({
      contactId: CONTACT_A,
      channel: "whatsapp",
      purposeClass: "proactive_non_transactional",
      sourceKind: "broadcast_run",
      sendRef: input.sendRef,
      simulated: true,
    });
    expect(await countRows(CONTACT_A)).toBe(1);
  });

  it("turns a genuine concurrent P2002 with a different semantic payload into a typed conflict", async () => {
    const idempotencyKey =
      "freq:eligibility-test:p2002-conflict:identity-a:whatsapp:proactive_non_transactional";
    const inputs = [
      {
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purposeClass: "proactive_non_transactional" as const,
        sourceKind: "broadcast_run" as const,
        sendRef: "run-p2002-conflict:member-a",
        simulated: true,
        idempotencyKey,
      },
      {
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purposeClass: "proactive_non_transactional" as const,
        sourceKind: "broadcast_run" as const,
        sendRef: "run-p2002-conflict:member-b",
        simulated: true,
        idempotencyKey,
      },
    ];
    const race = createFrequencyP2002RaceDb(idempotencyKey);
    const settled = await Promise.allSettled(
      inputs.map((input) => recordSendFrequencyEvent(input, race.db)),
    );

    expect(race.p2002Count()).toBe(1);
    const fulfilledIndexes = settled.flatMap((result, index) =>
      result.status === "fulfilled" ? [index] : [],
    );
    const rejected = settled.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilledIndexes).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as SendEligibilityError).code).toBe("IDEMPOTENCY_CONFLICT");

    const winner = await prisma.contactSendFrequencyEvent.findFirstOrThrow({
      where: { ownerId: ORG_A, idempotencyKey },
    });
    expect(winner.sendRef).toBe(inputs[fulfilledIndexes[0]!]!.sendRef);
    expect(await countRows(CONTACT_A)).toBe(1);
  });

  it("throws MISSING_CHANNEL_POLICY and writes nothing for an unconfigured channel", async () => {
    await expect(
      recordSendFrequencyEvent({
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "instagram",
        purposeClass: "proactive_non_transactional",
        sourceKind: "broadcast_run",
        sendRef: "run-instagram:member-1",
        simulated: true,
        idempotencyKey: "freq:eligibility-test:run-instagram:identity-a:instagram:proactive_non_transactional",
      }),
    ).rejects.toMatchObject({ code: "MISSING_CHANNEL_POLICY" });
    expect(await countRows(CONTACT_A)).toBe(0);
  });

  it("scoped-lock atomic count-and-insert: N concurrent distinct sends racing for the last cap slot -> exactly one counts", async () => {
    expect(SEND_FREQUENCY_POLICY.whatsapp?.maxProactiveSends).toBe(1);
    // A local Postgres round-trip is sub-millisecond, so a plain 2-way race rarely lands both
    // legs inside the same "count sees 0" window — it would pass even without the lock most
    // runs, which is not a real regression guard. Fanning out to 20 concurrent distinct sends
    // makes the overlap near-certain every run without slowing production code with an
    // artificial delay (verified: this reliably goes red with the lock removed, green with it
    // restored — see the M2 worker report's mutation-check section).
    const attempt = (n: number) =>
      recordSendFrequencyEvent({
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purposeClass: "proactive_non_transactional",
        sourceKind: "broadcast_run",
        sendRef: `run-race:member-${n}`,
        simulated: true,
        idempotencyKey: `freq:eligibility-test:run-race:identity-a:whatsapp:proactive_non_transactional:${n}`,
      });
    const attemptCount = 20;
    const settled = await Promise.allSettled(
      Array.from({ length: attemptCount }, (_, i) => attempt(i)),
    );
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(attemptCount - 1);
    for (const loss of rejected) {
      expect((loss.reason as SendEligibilityError).code).toBe("FREQUENCY_CAP_REACHED");
    }
    expect(await countRows(CONTACT_A)).toBe(1);
  });

  it("same-conversation two proactive replies each write their OWN row (never collapsed to conversationId)", async () => {
    const conversationId = "eligibility-test-conversation-1";
    const reply1 = await recordSendFrequencyEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purposeClass: "proactive_non_transactional",
      sourceKind: "conversation_reply",
      sendRef: `${conversationId}:message-1`,
      simulated: true,
      idempotencyKey: `freq:conv:${ORG_A}:${conversationId}-message-1`,
    });
    expect(reply1.duplicate).toBe(false);
    // The second reply is a DISTINCT logical send (its own idempotencyKey) — with
    // maxProactiveSends=1 for whatsapp it must hit the cap, proving the window is real and
    // the key derivation never collapses two sends in the same conversation into one slot.
    await expect(
      recordSendFrequencyEvent({
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purposeClass: "proactive_non_transactional",
        sourceKind: "conversation_reply",
        sendRef: `${conversationId}:message-2`,
        simulated: true,
        idempotencyKey: `freq:conv:${ORG_A}:${conversationId}-message-2`,
      }),
    ).rejects.toMatchObject({ code: "FREQUENCY_CAP_REACHED" });
    expect(await countRows(CONTACT_A)).toBe(1);
  });

  it("the simulated/real era filter never lets a real-era row phantom-block a simulated attempt (or vice versa)", async () => {
    // A hypothetical M4 real-send row (bypassing the writer directly, since M2 never
    // produces simulated=false rows on any reachable path).
    await prisma.contactSendFrequencyEvent.create({
      data: {
        id: "eligibility-test-real-era-row",
        ownerId: ORG_A,
        contactId: CONTACT_A,
        channel: "whatsapp",
        purposeClass: "proactive_non_transactional",
        sourceKind: "broadcast_run",
        sendRef: "real-run:member-1",
        simulated: false,
        idempotencyKey: "freq:eligibility-test:real-run:identity-a:whatsapp:proactive_non_transactional",
        countedAt: new Date(),
      },
    });
    const simulatedAttempt = await recordSendFrequencyEvent({
      ownerId: ORG_A,
      contactId: CONTACT_A,
      channel: "whatsapp",
      purposeClass: "proactive_non_transactional",
      sourceKind: "broadcast_run",
      sendRef: "sim-run:member-1",
      simulated: true,
      idempotencyKey: "freq:eligibility-test:sim-run:identity-a:whatsapp:proactive_non_transactional",
    });
    expect(simulatedAttempt.duplicate).toBe(false);
    expect(await countRows(CONTACT_A)).toBe(2);
  });
});
