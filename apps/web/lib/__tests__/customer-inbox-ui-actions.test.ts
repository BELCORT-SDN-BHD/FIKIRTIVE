import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@fikirtive/db";
import * as customerInboxUiActions from "../customer-inbox-ui-actions";
import { requireOwner } from "../auth-guard";

// C4b-M3 (issue #378): the wrapper sits between the client (which cannot import a
// server-only gateway module directly) and the frozen customer-inbox-gateway.ts.
// These tests prove it stays a pure pass-through — same auth wall, same result
// shapes, same intentional gaps — using the real gateway + service + Postgres,
// exactly like customer-inbox-actions.test.ts (Phase A) does for the gateway itself.
vi.mock("../auth-guard", () => ({
  requireOwner: vi.fn(async () => ({
    email: "c4b-m3-ui-owner@example.test",
    ownerId: "c4b-m3-ui-test-org-a",
  })),
}));
vi.mock("../better-auth/compat", () => ({
  isImpersonating: vi.fn(async () => false),
}));

const ORG_A = "c4b-m3-ui-test-org-a";
const USER_OWNER = "c4b-m3-ui-test-user-owner";
const OWNER = "c4b-m3-ui-test-owner";
const CONTACT_A = "c4b-m3-ui-test-contact-a";
const SCOPE_A = "c4b-m3-ui-test-scope-a";
const IDENTITY_A = "c4b-m3-ui-test-identity-a";
const CONVERSATION_A = "c4b-m3-ui-test-conversation-a";
const NOW = new Date("2026-07-21T08:00:00.000Z");

async function cleanup(): Promise<void> {
  await prisma.customerConversationDraft.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.customerConversationEvent.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.customerMessage.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.customerConversation.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.contactIdentity.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.channelScope.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.contact.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.membership.deleteMany({ where: { orgId: ORG_A } });
  await prisma.organization.deleteMany({ where: { id: ORG_A } });
  await prisma.user.deleteMany({ where: { id: USER_OWNER } });
}

async function seed(): Promise<void> {
  await prisma.organization.create({ data: { id: ORG_A } });
  await prisma.user.create({ data: { id: USER_OWNER, email: "c4b-m3-ui-owner@example.test" } });
  await prisma.membership.create({ data: { id: OWNER, userId: USER_OWNER, orgId: ORG_A, role: "owner" } });
  await prisma.contact.create({
    data: { id: CONTACT_A, ownerId: ORG_A, name: "Aisyah", source: "whatsapp", firstTouchAt: NOW, lastSeenAt: NOW },
  });
  await prisma.channelScope.create({ data: { id: SCOPE_A, ownerId: ORG_A, channel: "whatsapp", scopeKey: "waba-a" } });
  await prisma.contactIdentity.create({
    data: { id: IDENTITY_A, ownerId: ORG_A, contactId: CONTACT_A, channelScopeId: SCOPE_A, channel: "whatsapp", externalId: "+60111111111" },
  });
  await prisma.customerConversation.create({
    data: { id: CONVERSATION_A, ownerId: ORG_A, contactIdentityId: IDENTITY_A, status: "open", revision: 0, lastActivityAt: NOW },
  });
}

beforeEach(async () => {
  await cleanup();
  await seed();
  vi.clearAllMocks();
});

afterAll(cleanup);

describe("customer-inbox-ui-actions wrapper", () => {
  it("passes a read result through verbatim", async () => {
    const result = await customerInboxUiActions.listConversations({ view: "all" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.resource).toHaveLength(1);
    expect(result.resource[0]).toMatchObject({ id: CONVERSATION_A, status: "open", attention: "none" });
  });

  it("passes a successful mutation result through verbatim, including the change envelope", async () => {
    const result = await customerInboxUiActions.setConversationStatus({
      conversationId: CONVERSATION_A,
      expectedRevision: 0,
      status: "closed",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.resource.status).toBe("closed");
    expect(result.change).toMatchObject({
      revision: 1,
      kind: "closed",
      actor: { kind: "merchant_member", membershipId: OWNER },
    });
  });

  it("maps a CAS_CONFLICT error through verbatim", async () => {
    await customerInboxUiActions.setConversationStatus({
      conversationId: CONVERSATION_A,
      expectedRevision: 0,
      status: "closed",
    });
    // The conversation is now at revision 1; retrying with the stale revision 0 must
    // surface the gateway's structured CAS_CONFLICT failure unchanged.
    const stale = await customerInboxUiActions.setConversationStatus({
      conversationId: CONVERSATION_A,
      expectedRevision: 0,
      status: "open",
    });
    expect(stale).toEqual({ ok: false, error: "CAS_CONFLICT" });
  });

  it("never wraps the two hard-disabled gateway sends, under any export name", () => {
    const disabledCalls = ["submitConversationReply", "submitTemplateReview"];

    // Import-source check: the gateway import(s) in the actual .ts source must not name
    // either disabled call, aliased or not. A per-export runtime check alone is defeated by
    // `import { submitConversationReply as gatewaySend } from "./customer-inbox-gateway"` —
    // the export's own toString() only ever shows the local alias, never the real gateway
    // name it was imported under. Reading the file source (not the compiled export) is what
    // catches that. Uses matchAll, not match, so a bypass added via a *second* import
    // statement from the same module can't hide from the first (only) match.
    const srcPath = path.resolve(__dirname, "../customer-inbox-ui-actions.ts");
    const src = fs.readFileSync(srcPath, "utf8");
    const gatewayImports = [
      ...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']\.\/customer-inbox-gateway["']/g),
    ];
    expect(gatewayImports.length, "expected at least one named import from ./customer-inbox-gateway").toBeGreaterThan(0);
    const importedNames = gatewayImports.flatMap((match) =>
      match[1]!
        .split(",")
        .map((specifier) => specifier.trim())
        .filter(Boolean)
        .map((specifier) => specifier.split(/\s+as\s+/)[0]!.trim()),
    );
    for (const disabledCall of disabledCalls) {
      expect(
        importedNames.includes(disabledCall),
        `the gateway import(s) must not name "${disabledCall}", aliased or not — found: ${importedNames.join(", ")}`,
      ).toBe(false);
    }

    // Export-set check: an explicit allowlist. Any new export — for either disabled call
    // or anything else — must be consciously added here to pass, rather than silently
    // widening what this wrapper exposes.
    const APPROVED_EXPORTS = [
      "assignConversation",
      "createMessageTemplate",
      "createMessageTemplateVersion",
      "getConversation",
      "getConversationPreflight",
      "getHistory",
      "handOffConversation",
      "listConversations",
      "listTemplates",
      "requestAutomationResume",
      "saveConversationDraft",
      "searchConversations",
      "setConversationStatus",
      "takeOverConversation",
    ].sort();
    expect(Object.keys(customerInboxUiActions).sort()).toEqual(APPROVED_EXPORTS);

    // Body check (defense in depth): no export — under any name — calls through to a
    // disabled gateway function under its real name.
    for (const [exportName, exportValue] of Object.entries(customerInboxUiActions)) {
      if (typeof exportValue !== "function") continue;
      const source = exportValue.toString();
      for (const disabledCall of disabledCalls) {
        expect(
          source.includes(disabledCall),
          `export "${exportName}" must not reference disabled gateway call "${disabledCall}"`,
        ).toBe(false);
      }
    }
  });

  it("passes NOT_AUTHORIZED through when there is no session", async () => {
    vi.mocked(requireOwner).mockResolvedValueOnce({ error: "Not authorized." });
    const result = await customerInboxUiActions.listConversations({ view: "all" });
    expect(result).toEqual({ ok: false, error: "NOT_AUTHORIZED" });
  });
});
