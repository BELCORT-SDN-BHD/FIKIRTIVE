import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// #728 — CRM printed stored machine values straight at the merchant: the channel column
// (`whatsapp`), template version columns (`not_submitted`), send-readiness axis values (`risk`),
// internal design-document numbers (`D5` / `D8`) and the CAS `revision` integer. The same
// product already had the right words elsewhere (Reports says `WhatsApp`, the broadcast
// workbench maps run statuses), which is what makes this a missed connection rather than an
// open question. These tests render the real pages and read what a merchant would read.

vi.mock("@/lib/customer-broadcast-ui-actions", () => ({
  cancelBroadcastRun: vi.fn(),
  confirmBroadcastRun: vi.fn(),
  executeBroadcastRun: vi.fn(),
  freezeAudience: vi.fn(),
  getBroadcastRunLivePreflight: vi.fn(),
  listBroadcastRuns: vi.fn(),
}));
vi.mock("@/lib/customer-broadcast-report-ui-actions", () => ({
  getCustomerBroadcastReport: vi.fn(),
}));
vi.mock("@/lib/customer-inbox-ui-actions", () => ({
  assignConversation: vi.fn(),
  createMessageTemplate: vi.fn(),
  createMessageTemplateVersion: vi.fn(),
  getConversation: vi.fn(),
  getConversationPreflight: vi.fn(),
  getHistory: vi.fn(),
  handOffConversation: vi.fn(),
  listConversations: vi.fn(),
  listTemplates: vi.fn(),
  requestAutomationResume: vi.fn(),
  saveConversationDraft: vi.fn(),
  searchConversations: vi.fn(),
  setConversationStatus: vi.fn(),
}));

import BroadcastDetailPage from "@/components/crm/broadcasts/broadcast-detail-page";
import BroadcastListPage from "@/components/crm/broadcasts/broadcast-list-page";
import { skipReasonCopy } from "@/components/crm/broadcasts/broadcast-format";
import InboxConversationPage from "@/components/crm/inbox/inbox-conversation-page";
import InboxListPage from "@/components/crm/inbox/inbox-list-page";
import InboxTemplatesPage from "@/components/crm/inbox/inbox-templates-page";
import {
  axisStatusPresentation,
  channelAccountLabel,
  channelLabel,
  purposeLabel,
  templateStateLabel,
} from "@/lib/crm-labels";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

const SCOPES = [{ id: "scope-1", channel: "whatsapp", scopeKey: "60123456789" }];

const RUN = {
  id: "run-1",
  status: "draft",
  purpose: "marketing",
  channel: "whatsapp",
  createdByMembershipId: "membership-1",
  createdAt: new Date("2026-07-24T00:00:00.000Z"),
  revision: 7,
};

const DIRECTORY = {
  ok: true,
  resource: {
    self: { role: "owner", roles: ["owner"], membershipId: "membership-1" },
    members: [{ membershipId: "membership-1", displayName: "Owner", roles: ["owner"] }],
  },
};

function inboxListMarkup(): string {
  const props = {
    initialState: {
      ok: true,
      resource: [
        {
          id: "conv-1",
          status: "open",
          attention: "needs_reply",
          lastActivityAt: new Date("2026-07-24T00:00:00.000Z"),
          assigneeMembership: null,
          contactIdentity: {
            channel: "whatsapp",
            externalId: "60111111111",
            handle: "60111111111",
            label: null,
            contact: { id: "contact-1", name: "Aisyah" },
          },
          messages: [],
        },
      ],
    },
    initialChannelScopes: { ok: true, resource: SCOPES },
  } as unknown as ComponentProps<typeof InboxListPage>;
  return renderToStaticMarkup(createElement(InboxListPage, props));
}

function templatesMarkup(): string {
  const props = {
    initialState: {
      ok: true,
      resource: [
        {
          id: "tpl-1",
          name: "Order update",
          channel: "whatsapp",
          locale: "en_MY",
          archivedAt: null,
          channelScope: { id: "scope-1", channel: "whatsapp", scopeKey: "60123456789" },
          versions: [
            {
              id: "tv-1",
              revision: 1,
              definitionJson: { body: "Hello", variables: [] },
              submissionState: "draft",
              reviewState: "not_submitted",
              availabilityState: "unavailable",
              submittedAt: null,
              reviewedAt: null,
              frozenAt: null,
              createdAt: new Date("2026-07-24T00:00:00.000Z"),
            },
          ],
        },
      ],
    },
    initialScopes: { ok: true, resource: SCOPES },
  } as unknown as ComponentProps<typeof InboxTemplatesPage>;
  return renderToStaticMarkup(createElement(InboxTemplatesPage, props));
}

function broadcastListMarkup(): string {
  const props = {
    initialRuns: { ok: true, resource: [RUN] },
    initialDirectory: DIRECTORY,
    initialReportRunIds: [],
    initialChannelScopes: { ok: true, resource: SCOPES },
  } as unknown as ComponentProps<typeof BroadcastListPage>;
  return renderToStaticMarkup(createElement(BroadcastListPage, props));
}

const CONSENT_RISK_MEMBER = {
  id: "member-1",
  contactId: "contact-1",
  contact: { name: "Aisyah" },
  contactIdentity: { handle: "60111111111", label: null, externalId: "60111111111" },
  includedByMerchant: true,
  sendState: "pending",
  skipReason: null,
  frozenVerdict: {
    consentStop: { status: "risk" },
    doNotDisturb: { status: "pass" },
    providerRefusal: { status: "pass" },
    frequency: { status: "pass" },
  },
  liveVerdict: {
    consentStop: { status: "risk" },
    doNotDisturb: { status: "pass" },
    providerRefusal: { status: "pass" },
    frequency: { status: "pass" },
  },
};

function broadcastDetailMarkup(): string {
  const props = {
    broadcastRunId: RUN.id,
    initialRun: { ok: true, resource: { run: RUN, members: [CONSENT_RISK_MEMBER], campaign: null } },
    initialPreflight: { ok: true, resource: { run: RUN, members: [CONSENT_RISK_MEMBER] } },
    initialDirectory: DIRECTORY,
    initialOptions: { ok: true, resource: { segments: [], channelScopes: SCOPES } },
    initialReportAvailable: false,
    preselectedSegmentId: null,
  } as unknown as ComponentProps<typeof BroadcastDetailPage>;
  return renderToStaticMarkup(createElement(BroadcastDetailPage, props));
}

function conversationMarkup(): string {
  const preflight = {
    ok: true,
    resource: {
      checkedAt: new Date("2026-07-24T00:00:00.000Z"),
      internalCapability: { status: "pass" },
      connection: { status: "unknown" },
      d8Carrier: { status: "unavailable" },
      consentStop: { status: "risk" },
      doNotDisturb: { status: "pass" },
      providerRefusal: { status: "pass" },
      frequency: { status: "pass" },
      exactApproval: { status: "unavailable" },
      sendEligibility: { status: "unavailable" },
      freshness: {
        lastProviderEventAt: null,
        lastHealthCheckedAt: null,
        lastDataLoadedAt: new Date("2026-07-24T00:00:00.000Z"),
      },
    },
  };
  const props = {
    conversationId: "conv-1",
    initialState: {
      conversation: {
        ok: true,
        resource: {
          id: "conv-1",
          revision: 3,
          status: "open",
          automationState: "disabled",
          lastMessageAt: null,
          assigneeMembership: null,
          draft: null,
          contactIdentity: {
            channel: "whatsapp",
            externalId: "60111111111",
            handle: "60111111111",
            label: null,
            contact: { id: "contact-1", name: "Aisyah", lifecycleStage: "Active" },
          },
        },
      },
      history: { ok: true, resource: { messages: [], events: [] } },
      preflight,
    },
    initialDirectory: DIRECTORY,
  } as unknown as ComponentProps<typeof InboxConversationPage>;
  return renderToStaticMarkup(createElement(InboxConversationPage, props));
}

describe("one label authority for CRM machine values (#728)", () => {
  it("spells the channel the way Reports already did, from a single map", () => {
    expect(channelLabel("whatsapp")).toBe("WhatsApp");
    expect(channelAccountLabel({ channel: "whatsapp", scopeKey: "60123456789" }))
      .toBe("WhatsApp · 60123456789");
    // An unmapped value is still never shown with its underscores.
    expect(channelLabel("sms_gateway")).toBe("sms gateway");
  });

  it("gives template version states and axis statuses merchant wording", () => {
    expect(templateStateLabel("not_submitted")).toBe("Not submitted");
    expect(templateStateLabel("draft")).toBe("Draft");
    expect(templateStateLabel("unavailable")).toBe("Unavailable");
    expect(templateStateLabel("provider_rejected")).toBe("Provider rejected");
    expect(axisStatusPresentation("risk").label).toBe("At risk");
    expect(purposeLabel("review_request")).toBe("Review request");
  });

  it("is the only definition — the family format modules re-export instead of copying", () => {
    for (const file of [
      "../../components/crm/reports/report-format.ts",
      "../../components/crm/broadcasts/broadcast-format.ts",
    ]) {
      const src = source(file);
      expect(src).toContain('from "@/lib/crm-labels"');
      expect(src).not.toMatch(/whatsapp/i);
    }
    // The Routine authorization confirmation reads the same map rather than keeping its own.
    const facts = source("../routine-authorization-facts.ts");
    expect(facts).toContain('from "./crm-labels"');
    expect(facts).not.toContain("CHANNEL_LABELS");
  });
});

describe("no CRM screen shows a raw stored token (#728)", () => {
  it("Inbox list names the channel in words", () => {
    const markup = inboxListMarkup();
    expect(markup).toContain("WhatsApp");
    expect(markup).not.toContain("whatsapp");
  });

  it("conversation page names the channel in words in both places it appears", () => {
    const markup = conversationMarkup();
    // The header and the Contact card printed two different spellings of one channel.
    expect(markup.match(/WhatsApp/g)?.length).toBeGreaterThanOrEqual(2);
    expect(markup).not.toContain("whatsapp");
  });

  it("conversation diagnostics read as words, not axis codes, and carry no design-doc number", () => {
    const markup = conversationMarkup();
    expect(markup).toContain("Privacy carrier");
    expect(markup).not.toContain("(D8)");
    expect(markup).toContain("At risk");
    expect(markup).toContain("Unavailable");
    expect(markup).not.toMatch(/>risk</);
    expect(markup).not.toMatch(/>unavailable</);
    expect(markup).not.toMatch(/>unknown</);
  });

  it("templates page maps every version state badge", () => {
    const markup = templatesMarkup();
    expect(markup).toContain("Not submitted");
    expect(markup).not.toContain("not_submitted");
    expect(markup).toContain("WhatsApp · en_MY");
    expect(markup).not.toContain("whatsapp");
  });

  it("broadcast list names the channel in words", () => {
    const markup = broadcastListMarkup();
    expect(markup).toContain("WhatsApp");
    expect(markup).not.toContain("whatsapp");
  });

  it("broadcast detail drops the internal design number and the CAS revision", () => {
    const markup = broadcastDetailMarkup();
    expect(markup).toContain("WhatsApp");
    expect(markup).not.toContain("whatsapp");
    // D5 is an internal design-document number; a merchant has no way to look it up.
    expect(markup).not.toContain("D5");
    // `revision` is the concurrency integer, not a version a merchant chose.
    expect(markup).not.toContain("revision");
  });

  it("keeps the internal design number out of skip-reason copy too", () => {
    const copy = skipReasonCopy("consentStop:effective_revoke");
    expect(copy).toContain("opted out");
    expect(copy).not.toContain("D5");
  });

  it("no CRM component interpolates a channel column straight into the page", () => {
    for (const file of [
      "../../components/crm/inbox/inbox-list-page.tsx",
      "../../components/crm/inbox/inbox-conversation-page.tsx",
      "../../components/crm/inbox/inbox-templates-page.tsx",
      "../../components/crm/broadcasts/broadcast-list-page.tsx",
      "../../components/crm/broadcasts/broadcast-detail-page.tsx",
      "../../components/crm/broadcasts/broadcast-composer-page.tsx",
      "../../components/crm/contact-profile-page.tsx",
    ]) {
      expect(source(file)).not.toMatch(/\{[A-Za-z0-9_?.[\]]*\.channel\}/);
    }
  });
});
