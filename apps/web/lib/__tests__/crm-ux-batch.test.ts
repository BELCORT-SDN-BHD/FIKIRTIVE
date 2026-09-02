import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/campaign-actions", () => ({
  approveCampaignEntry: vi.fn(),
  proposeCampaignEntry: vi.fn(),
  removeCampaignEntry: vi.fn(),
  setCampaignGrouping: vi.fn(),
  updateCampaignEntry: vi.fn(),
}));
vi.mock("@/lib/campaign-view-data", () => ({ getCampaign: vi.fn() }));
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
  listConversations: vi.fn(),
  searchConversations: vi.fn(),
}));
vi.mock("@/lib/customer-workflow-ui-actions", () => ({
  getContactJourneyStates: vi.fn(),
  listRoutineRuns: vi.fn(),
}));

import { CampaignBroadcastsCard } from "@/components/campaign/campaign-detail-page";
import BroadcastDetailPage from "@/components/crm/broadcasts/broadcast-detail-page";
import BroadcastListPage from "@/components/crm/broadcasts/broadcast-list-page";
import InboxListPage from "@/components/crm/inbox/inbox-list-page";
import WorkflowMonitoring from "@/components/crm/workflows/workflow-monitoring";
import { CRM_CONSENT_LABELS, crmConsentBadge } from "@/lib/crm-consent-labels";
import type { CrmConsentState } from "@/lib/crm-view-data";
import { ottoGreetingName } from "@/lib/otto-greeting";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

function consentState(overrides: Partial<CrmConsentState>): CrmConsentState {
  return {
    state: "unknown",
    stateSourceKind: null,
    evidenceStatus: null,
    lastReceivedAt: null,
    unresolvedLegacyOptOut: false,
    ...overrides,
  };
}

const RUN = {
  id: "run-1",
  status: "draft",
  purpose: "marketing",
  channel: "whatsapp",
  createdByMembershipId: "membership-1",
  createdAt: new Date("2026-07-24T00:00:00.000Z"),
  revision: 0,
};

function broadcastDetailMarkup(reportAvailable: boolean): string {
  const props = {
    broadcastRunId: RUN.id,
    initialRun: {
      ok: true,
      resource: {
        run: RUN,
        members: [],
        campaign: { id: "campaign-1", name: "Merdeka launch" },
      },
    },
    initialPreflight: { ok: true, resource: { run: RUN, members: [] } },
    initialDirectory: {
      ok: true,
      resource: {
        self: { role: "owner" },
        members: [{ membershipId: "membership-1", displayName: "Owner" }],
      },
    },
    initialOptions: { ok: true, resource: { segments: [] } },
    initialReportAvailable: reportAvailable,
    preselectedSegmentId: null,
  } as unknown as ComponentProps<typeof BroadcastDetailPage>;
  return renderToStaticMarkup(createElement(BroadcastDetailPage, props));
}

describe("CRM consent labels", () => {
  it("enumerates every consent state with one shared plain-language label", () => {
    expect(CRM_CONSENT_LABELS).toEqual({
      unknown: "Unknown",
      verified_grant: "Verified opt-in",
      effective_revoke: "Opted out",
    });
  });

  // #752 — the two pages now share the whole badge (label AND variant), not just the label map,
  // because a state-only badge is what let them say "Unknown" about a customer the segments page
  // had already excluded. Neither page may derive its own.
  it("is imported by both the contacts list and contact detail through one shared badge", () => {
    for (const file of [
      "../../components/crm/contacts-page.tsx",
      "../../components/crm/contact-profile-page.tsx",
    ]) {
      expect(source(file)).toContain("crmConsentBadge");
      expect(source(file)).toContain('from "@/lib/crm-consent-labels"');
      expect(source(file)).not.toContain("CRM_CONSENT_LABELS[");
    }
  });

  it("gives the pre-ledger fence its own words, at the weight of an opt-out", () => {
    expect(crmConsentBadge(consentState({ unresolvedLegacyOptOut: true }))).toEqual({
      label: "Opted out before consent history",
      variant: "destructive",
    });
    // Everything else keeps the wording it already had.
    expect(crmConsentBadge(consentState({}))).toEqual({ label: "Unknown", variant: "warning" });
    expect(crmConsentBadge(consentState({ state: "verified_grant" }))).toEqual({
      label: "Verified opt-in",
      variant: "success",
    });
    expect(crmConsentBadge(consentState({ state: "effective_revoke" }))).toEqual({
      label: "Opted out",
      variant: "destructive",
    });
  });
});

describe("Otto greeting derivation", () => {
  it.each([
    ["qa.wave1.fresh@example.com", "qa.wave1.fresh"],
    ["Rosa Bloom", "Rosa"],
    ["qa.wave1.fresh", "qa.wave1.fresh"],
  ])("derives %s as %s", (userName, expected) => {
    expect(ottoGreetingName(userName)).toBe(expected);
  });
});

describe("broadcast cross-flow links", () => {
  it("shows the campaign row and View report when the owner-scoped report exists", () => {
    const markup = broadcastDetailMarkup(true);

    expect(markup).toContain('href="/campaign/campaign-1"');
    expect(markup).toContain("Merdeka launch");
    expect(markup).toContain('href="/crm/reports/run-1"');
    expect(markup).toContain("View report");
  });

  it("keeps the broadcast campaign title lookup scoped to the authenticated owner", () => {
    const service = source("../customer-broadcast-service.ts");

    expect(service).toContain(
      "where: { id: run.campaignId, ownerId: principal.ownerId, deletedAt: null }",
    );
  });

  it("hides View report when the owner-scoped report read is unavailable", () => {
    const markup = broadcastDetailMarkup(false);

    expect(markup).not.toContain('href="/crm/reports/run-1"');
    expect(markup).not.toContain("View report");
  });

  it("adds the compact list affordance only for report-backed rows", () => {
    const baseProps = {
      initialRuns: { ok: true, resource: [RUN] },
      initialChannelScopes: { ok: true, resource: [] },
      initialDirectory: {
        ok: true,
        resource: {
          self: { role: "owner" },
          members: [{ membershipId: "membership-1", displayName: "Owner" }],
        },
      },
    };
    const withReport = renderToStaticMarkup(createElement(
      BroadcastListPage,
      { ...baseProps, initialReportRunIds: [RUN.id] } as unknown as ComponentProps<typeof BroadcastListPage>,
    ));
    const withoutReport = renderToStaticMarkup(createElement(
      BroadcastListPage,
      { ...baseProps, initialReportRunIds: [] } as unknown as ComponentProps<typeof BroadcastListPage>,
    ));

    expect(withReport).toContain('href="/crm/reports/run-1"');
    expect(withoutReport).not.toContain('href="/crm/reports/run-1"');
  });
});

describe("campaign Broadcasts panel", () => {
  // W2-13(#993):这张卡原来每一行都链去 `/crm/broadcasts/{id}`。CRM 整段收起来之后那个
  // 地址只把商家弹回 Home,所以链接去掉了,事实留下 —— 断言跟着改成「事实还在、门没了」。
  it("renders grouped broadcasts with status and date, and no link into hidden CRM", () => {
    const markup = renderToStaticMarkup(createElement(CampaignBroadcastsCard, {
      broadcasts: [{
        id: RUN.id,
        purpose: RUN.purpose,
        status: "completed",
        createdAt: "2026-07-23T00:00:00.000Z",
        executedAt: "2026-07-24T00:00:00.000Z",
      }],
    }));

    expect(markup).toContain("Broadcasts");
    expect(markup).toContain("Marketing broadcast");
    expect(markup).toContain("Completed (simulated)");
    expect(markup).toContain("Sent (simulated)");
    expect(markup).not.toContain('href="/crm/broadcasts/run-1"');
  });

  it("mirrors the sibling panels' visible empty state", () => {
    const markup = renderToStaticMarkup(createElement(CampaignBroadcastsCard, { broadcasts: [] }));

    // FRONT(前端基线合并):空态改由设计系统的 `Empty` 组件画 —— 标题一行、说明一行,
    // 标题不带句号。兄弟面板同一天一起改成同一个形状(`campaign-detail-page.tsx:780/845`
    // 的 `<EmptyTitle className="text-sm">Nothing grouped yet</EmptyTitle>`),所以这一条
    // 「与兄弟面板长一样」的判据没变,变的只是那个句号。
    expect(markup).toContain("Nothing grouped yet");
    expect(markup).toContain("Broadcasts grouped into this campaign will appear here.");
  });
});

describe("workflow and Inbox links", () => {
  it("links a journey contact name to the canonical contact profile route", () => {
    const props = {
      workflowDefinitionId: "workflow-1",
      initialRuns: { ok: true, resource: { items: [], nextCursor: null } },
      initialJourneys: {
        ok: true,
        resource: {
          items: [{
            id: "journey-1",
            status: "active",
            contact: { id: "contact-1", name: "Aisha" },
            currentStepKey: null,
            nextEligibleAt: null,
            lastRoutineRun: null,
          }],
          nextCursor: null,
        },
      },
    } as unknown as ComponentProps<typeof WorkflowMonitoring>;
    const markup = renderToStaticMarkup(createElement(WorkflowMonitoring, props));

    expect(markup).toContain('href="/crm/contacts/contact-1"');
    expect(markup).toContain("Aisha");
  });

  it("keeps the Inbox no-channel explanation honest with no dead-end Connections CTA (#541)", () => {
    // #727 — the banner is derived from this read now; zero channel accounts is the state the
    // #541 copy was written for.
    const markup = renderToStaticMarkup(createElement(
      InboxListPage,
      {
        initialState: { ok: true, resource: [] },
        initialChannelScopes: { ok: true, resource: [] },
      } as unknown as ComponentProps<typeof InboxListPage>,
    ));

    // #541 — Connections has no Connect button for Messaging (WhatsApp is "Not available
    // yet"), so pointing merchants there was a dead end. The banner must say the truth
    // instead and must not link to Connections.
    expect(markup).toContain("No messaging channel is connected in this workspace yet");
    expect(markup).toContain("Messaging channels are not available to connect yet");
    expect(markup).not.toContain('href="/otto?view=connections"');
    expect(markup).not.toContain("Connect a channel");
  });

  it("keeps the workflow missing-id copy non-enumerable and reassuring", () => {
    const detail = source("../../components/crm/workflows/workflow-detail-page.tsx");

    expect(detail.match(/This workflow is not available/g)).toHaveLength(1);
    expect(detail).toContain(
      "It may not exist, or you may not have access. Nothing was changed, and no workflow data was guessed.",
    );
  });
});
