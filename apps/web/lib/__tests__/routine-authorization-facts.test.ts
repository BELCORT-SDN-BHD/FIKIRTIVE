import { describe, expect, it } from "vitest";
import { createRoutineAuthorizationSnapshot } from "@fikirtive/db";
import {
  COVERED_AUTHORIZATION_FIELDS,
  describeAuthorization,
  summaryPolicyFact,
  type ResolvedAuthorizationNames,
} from "@/lib/routine-authorization-facts";

/**
 * PINBOARD (#720 判官 r2) — **hash face == card face.**
 *
 * The rule: every fact that goes into a Routine's authorization hash must be on the
 * confirmation page in plain language, and nothing on that page may be outside that set.
 *
 * The snapshot below is built by `createRoutineAuthorizationSnapshot` — the SAME function the
 * authorization hash is computed over — so these tests read the hash's own input set rather
 * than a hand-copied list of field names. Two properties together pin the invariant:
 *
 *   1. TOTALITY — every key of a real snapshot is claimed by a row. Add a field to the
 *      snapshot without giving it a row and this goes red.
 *   2. SENSITIVITY — changing any one hashed field changes the rendered text. Claim a field in
 *      a row's `fields` list but never actually print it and this goes red.
 *
 * Sensitivity is what stops the concrete bug the judge found: two authorizations differing only
 * in their customers, segments, or channel accounts rendering identically.
 */

const MATERIAL = {
  ownerId: "org-alpha",
  routineKey: "outside-hours-reply",
  workflowDefinitionId: "wf-1",
  workflowRevisionId: "rev-1",
  workflowRevision: 3,
  workflowContentHash: "content-hash-aaaaaaaaaaaaaaaa",
  dependencyHash: "dependency-hash-bbbbbbbbbbbbbbbb",
  scopeJson: {
    actionKinds: ["conversation_reply"],
    channelScopes: [{ channel: "whatsapp", providerConnectionId: "conn-1" }],
    contactIds: ["contact-1"],
    segmentIds: ["segment-1"],
    maxActions: 2,
    maxRecipients: 5,
  },
  maxCreditsPerRun: 0,
  maxCreditsPerMonth: 0,
  expiresAt: new Date("2026-12-31T00:00:00.000Z"),
  summaryPolicyJson: { afterEachRun: "workflow_activity" } as Record<string, unknown>,
  authorizationRevision: 1,
};

const NAMES: ResolvedAuthorizationNames = {
  workspaceName: "Kedai Kopi Alpha",
  workflowName: "Outside hours reply",
  contacts: [{ id: "contact-1", name: "Siti" }],
  segments: [{ id: "segment-1", name: "Regulars" }],
  channels: [{ channel: "whatsapp", providerConnectionId: "conn-1", accountName: "Kopi Alpha WhatsApp" }],
};

function snapshotOf(overrides: Partial<typeof MATERIAL> = {}) {
  return createRoutineAuthorizationSnapshot({ ...MATERIAL, ...overrides }) as unknown as Record<string, unknown>;
}

function render(snapshot: Record<string, unknown>, names: ResolvedAuthorizationNames = NAMES): string {
  const facts = describeAuthorization(snapshot, names);
  return facts.rows.map((row) => `${row.label}: ${row.value}`).join("\n");
}

describe("hash face == card face (#720 pinboard)", () => {
  it("claims every field the authorization hash is computed over", () => {
    const snapshot = snapshotOf();
    const hashedFields = Object.keys(snapshot).sort();
    const claimed = [...COVERED_AUTHORIZATION_FIELDS].sort();
    // Read as: anything the hash signs, the merchant is shown. Adding a snapshot field without
    // a row here is the failure this catches.
    expect(claimed).toEqual(hashedFields);
    expect(describeAuthorization(snapshot, NAMES).unexplained).toEqual([]);
  });

  it("renders differently when ANY hashed field changes", () => {
    const baseline = render(snapshotOf());
    const mutations: Array<[string, Partial<typeof MATERIAL>]> = [
      ["ownerId", { ownerId: "org-beta" }],
      ["routineKey", { routineKey: "night-shift-reply" }],
      ["workflowDefinitionId", { workflowDefinitionId: "wf-2" }],
      ["workflowRevisionId", { workflowRevisionId: "rev-2" }],
      ["workflowRevision", { workflowRevision: 4 }],
      ["workflowContentHash", { workflowContentHash: "content-hash-cccccccccccccccc" }],
      ["dependencyHash", { dependencyHash: "dependency-hash-dddddddddddddddd" }],
      ["maxCreditsPerRun", { maxCreditsPerRun: 1 }],
      ["maxCreditsPerMonth", { maxCreditsPerMonth: 2 }],
      ["expiresAt", { expiresAt: new Date("2027-01-31T00:00:00.000Z") }],
      ["summaryPolicyJson", { summaryPolicyJson: { mode: "counts_only" } }],
      ["authorizationRevision", { authorizationRevision: 2 }],
      ["scopeJson.actionKinds", { scopeJson: { ...MATERIAL.scopeJson, actionKinds: ["complete"] } }],
      ["scopeJson.maxActions", { scopeJson: { ...MATERIAL.scopeJson, maxActions: 9 } }],
      ["scopeJson.maxRecipients", { scopeJson: { ...MATERIAL.scopeJson, maxRecipients: 9 } }],
    ];
    for (const [field, override] of mutations) {
      expect(render(snapshotOf(override)), `changing ${field} must change what the merchant reads`).not.toBe(baseline);
    }
  });

  // The three the judge caught: these live inside scopeJson, so they are hashed, and they are
  // exactly the ones the old confirmation page reduced to a count.
  it("renders differently for different customers, segments, and channel accounts", () => {
    const snapshot = snapshotOf();
    const baseline = render(snapshot);

    const otherContact = render(
      snapshotOf({ scopeJson: { ...MATERIAL.scopeJson, contactIds: ["contact-2"] } }),
      { ...NAMES, contacts: [{ id: "contact-2", name: "Farid" }] },
    );
    const otherSegment = render(
      snapshotOf({ scopeJson: { ...MATERIAL.scopeJson, segmentIds: ["segment-2"] } }),
      { ...NAMES, segments: [{ id: "segment-2", name: "Lapsed" }] },
    );
    const otherAccount = render(snapshot, {
      ...NAMES,
      channels: [{ channel: "whatsapp", providerConnectionId: "conn-2", accountName: "Kopi Alpha Backup" }],
    });

    expect(otherContact).not.toBe(baseline);
    expect(otherSegment).not.toBe(baseline);
    expect(otherAccount).not.toBe(baseline);
    expect(baseline).toContain("Siti");
    expect(baseline).toContain("Regulars");
    expect(baseline).toContain("Kopi Alpha WhatsApp");
  });

  // 判官 r3 P1-2 — the equivalence classes the previous version collapsed. Nothing in the
  // schema makes a customer name, a segment name or a channel account's displayName unique, so
  // "same name" must not mean "same confirmation page". With the hash bound server-side these
  // are no longer a security hole, but the merchant is still entitled to see the difference.
  it("distinguishes same-named customers, same-named channel accounts, and different unresolved sets", () => {
    const sameNameContacts = (ids: [string, string]) =>
      render(snapshotOf({ scopeJson: { ...MATERIAL.scopeJson, contactIds: ids } }), {
        ...NAMES,
        contacts: ids.map((id) => ({ id, name: "Ali" })),
      });
    expect(sameNameContacts(["contact-1", "contact-2"])).not.toBe(sameNameContacts(["contact-1", "contact-3"]));

    const sameNameAccount = (connectionId: string) =>
      render(snapshotOf({ scopeJson: { ...MATERIAL.scopeJson, channelScopes: [{ channel: "whatsapp", providerConnectionId: connectionId }] } }), {
        ...NAMES,
        channels: [{ channel: "whatsapp", providerConnectionId: connectionId, accountName: "Front desk" }],
      });
    // Two connections that a merchant named identically must still read differently…
    expect(sameNameAccount("conn-1")).not.toBe(sameNameAccount("conn-2"));

    const unresolvedContacts = (ids: [string, string]) =>
      render(snapshotOf({ scopeJson: { ...MATERIAL.scopeJson, contactIds: ids } }), {
        ...NAMES,
        contacts: ids.map((id) => ({ id, name: null })),
      });
    // …and two equally sized sets of unresolvable references are not interchangeable either.
    expect(unresolvedContacts(["gone-1", "gone-2"])).not.toBe(unresolvedContacts(["gone-3", "gone-4"]));
  });

  it("shows the whole expiry instant, not a rounded minute", () => {
    const atMinute = render(snapshotOf({ expiresAt: new Date("2026-12-31T10:30:00.000Z") }));
    const sameMinuteLaterSecond = render(snapshotOf({ expiresAt: new Date("2026-12-31T10:30:45.000Z") }));
    expect(sameMinuteLaterSecond).not.toBe(atMinute);
  });

  it("counts references it cannot resolve instead of dropping them", () => {
    const text = render(
      snapshotOf({ scopeJson: { ...MATERIAL.scopeJson, contactIds: ["contact-1", "contact-gone"] } }),
      { ...NAMES, contacts: [{ id: "contact-1", name: "Siti" }, { id: "contact-gone", name: null }] },
    );
    expect(text).toContain("Siti");
    expect(text).toContain("1 customer reference we could not resolve to a name");
  });
});

describe("summary policy is read as wide as it is written (#720 P1-2)", () => {
  // The write path accepts ANY non-empty JSON object and hashes it whole, so the reader must be
  // able to say something true about any of them — never "no summary policy is recorded".
  it("never reports a stored policy as absent, whatever its shape", () => {
    for (const stored of [
      { policy: "x" },
      { schemaVersion: 2, mode: "counts_only" },
      { mode: "counts_only", somethingNew: "later-feature" },
      { afterEachRun: { destination: "nested" } },
      { mode: 7 },
    ]) {
      const fact = summaryPolicyFact(stored);
      expect(fact.text, `stored ${JSON.stringify(stored)}`).not.toContain("No summary policy is recorded");
    }
  });

  it("marks a shape it cannot explain as unexplained, so the caller can fail closed", () => {
    expect(summaryPolicyFact({ policy: "x" }).explained).toBe(false);
    expect(summaryPolicyFact({ mode: "counts_only", somethingNew: "later" }).explained).toBe(false);
    expect(summaryPolicyFact({ afterEachRun: "workflow_activity" }).explained).toBe(true);
    expect(summaryPolicyFact({ mode: "counts_only" }).explained).toBe(true);
    // schemaVersion is a recognized key and a number is a value we can state plainly.
    expect(summaryPolicyFact({ schemaVersion: 1, mode: "counts_only" }).explained).toBe(true);
  });

  it("puts an unexplainable policy into the facts' unexplained list", () => {
    const facts = describeAuthorization(snapshotOf({ summaryPolicyJson: { policy: "x" } }), NAMES);
    expect(facts.unexplained).toContain("summaryPolicyJson");
    const summaryRow = facts.rows.find((row) => row.label === "Summary");
    expect(summaryRow?.value).toContain("cannot explain in plain language");
    expect(summaryRow?.value).not.toContain("No summary policy is recorded");
  });
});
