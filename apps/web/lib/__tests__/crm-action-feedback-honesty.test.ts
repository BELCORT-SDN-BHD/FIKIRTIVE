// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #724 / #725 / #720 / #721 — four QA走查 findings whose common shape is "the screen says
 * something the server never said". Each case below drives the REAL client event path
 * (jsdom + react-dom/client + act) rather than asserting on static markup, because every
 * one of these bugs lives in what happens AFTER a click.
 */

vi.mock("@/lib/customer-broadcast-ui-actions", () => ({
  cancelBroadcastRun: vi.fn(),
  confirmBroadcastRun: vi.fn(),
  executeBroadcastRun: vi.fn(),
  freezeAudience: vi.fn(),
  getBroadcastRunLivePreflight: vi.fn(),
}));
vi.mock("@/lib/customer-broadcast-report-ui-actions", () => ({
  getCustomerBroadcastReport: vi.fn(),
}));
vi.mock("@/lib/customer-workflow-ui-actions", () => ({
  activateRoutine: vi.fn(),
  archiveWorkflowDefinition: vi.fn(),
  createRoutineDraft: vi.fn(),
  getBusinessHoursPolicy: vi.fn(),
  getContactJourneyStates: vi.fn(),
  getRoutine: vi.fn(),
  getWorkflowDefinition: vi.fn(),
  killRoutine: vi.fn(),
  listBusinessHoursPolicies: vi.fn(),
  listRoutineRuns: vi.fn(),
  listRoutines: vi.fn(),
  listWorkflowRevisions: vi.fn(),
  publishWorkflowRevision: vi.fn(),
  reauthorizeRoutine: vi.fn(),
  saveWorkflowRevision: vi.fn(),
  validateWorkflowRules: vi.fn(),
}));
vi.mock("@/lib/customer-inbox-ui-actions", () => ({
  assignConversation: vi.fn(),
  getConversation: vi.fn(),
  getConversationPreflight: vi.fn(),
  getHistory: vi.fn(),
  handOffConversation: vi.fn(),
  requestAutomationResume: vi.fn(),
  saveConversationDraft: vi.fn(),
  setConversationStatus: vi.fn(),
  takeOverConversation: vi.fn(),
}));

import BroadcastDetailPage from "@/components/crm/broadcasts/broadcast-detail-page";
import InboxConversationPage from "@/components/crm/inbox/inbox-conversation-page";
import WorkflowDetailPage from "@/components/crm/workflows/workflow-detail-page";
import RoutineAuthorizationPanel from "@/components/crm/workflows/routine-authorization-panel";
import {
  activateRoutine,
  getContactJourneyStates,
  getWorkflowDefinition,
  listBusinessHoursPolicies,
  listRoutineRuns,
  listRoutines,
  listWorkflowRevisions,
} from "@/lib/customer-workflow-ui-actions";
import {
  cancelBroadcastRun,
  confirmBroadcastRun,
  executeBroadcastRun,
  freezeAudience,
  getBroadcastRunLivePreflight,
} from "@/lib/customer-broadcast-ui-actions";
import { getCustomerBroadcastReport } from "@/lib/customer-broadcast-report-ui-actions";
import {
  assignConversation,
  getConversation,
  getConversationPreflight,
  getHistory,
} from "@/lib/customer-inbox-ui-actions";

// React refuses act() outside a configured act environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- interactive harness (jsdom + react-dom/client; the real client event path) ---

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

async function rerender(element: ReactElement) {
  await act(async () => root!.render(element));
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// React tracks the last value it set on a controlled element and drops events whose value
// "didn't change" — write through the NATIVE prototype setter so the event is respected.
function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
}

async function chooseOption(select: HTMLSelectElement, value: string) {
  await act(async () => {
    setNativeValue(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function buttonWithText(dom: HTMLElement, text: string): HTMLButtonElement {
  const match = Array.from(dom.querySelectorAll("button")).find((button) =>
    (button.textContent ?? "").includes(text),
  );
  expect(match, `expected a button containing "${text}"`).toBeTruthy();
  return match!;
}

// ---------------------------------------------------------------------------
// #724 — broadcast lifecycle actions must keep a rejected action's copy on screen
// ---------------------------------------------------------------------------

const RUN_BASE = {
  id: "run-1",
  revision: 3,
  purpose: "marketing",
  channel: "whatsapp",
  createdAt: "2026-08-01T00:00:00.000Z",
  createdByMembershipId: "mem-owner",
};

function broadcastProps(status: string): ComponentProps<typeof BroadcastDetailPage> {
  const run = { ...RUN_BASE, status };
  return {
    broadcastRunId: "run-1",
    initialRun: { ok: true, resource: { run, campaign: null } },
    initialPreflight: { ok: true, resource: { run, members: [] } },
    initialDirectory: {
      ok: true,
      resource: { self: { membershipId: "mem-owner", role: "owner", roles: ["owner"] }, members: [] },
    },
    initialOptions: { ok: true, resource: { segments: [{ id: "seg-1", name: "All customers" }] } },
    initialReportAvailable: false,
    preselectedSegmentId: null,
  } as unknown as ComponentProps<typeof BroadcastDetailPage>;
}

/** The refresh that runs in runMutation's finally succeeds — exactly the走查 scenario. */
function stubBroadcastRefresh(status: string) {
  const run = { ...RUN_BASE, status };
  vi.mocked(getBroadcastRunLivePreflight).mockResolvedValue({
    ok: true,
    resource: { run, members: [] },
  } as never);
  vi.mocked(getCustomerBroadcastReport).mockResolvedValue({ ok: false, error: "RESOURCE_NOT_FOUND" } as never);
}

const REJECTED_ACTIONS: Array<{
  label: string;
  status: string;
  action: () => ReturnType<typeof vi.fn>;
  code: string;
  copy: string;
}> = [
  {
    label: "Freeze audience",
    status: "draft",
    action: () => vi.mocked(freezeAudience),
    code: "INVALID_ARGUMENT",
    copy: "That request wasn't valid. Please check the values and try again.",
  },
  {
    label: "Confirm audience",
    status: "audience_frozen",
    action: () => vi.mocked(confirmBroadcastRun),
    code: "AUDIENCE_STATE_CONFLICT",
    copy: "This broadcast's audience is in an unexpected state — reload before re-freezing.",
  },
  {
    label: "Run simulated send",
    status: "confirmed",
    action: () => vi.mocked(executeBroadcastRun),
    code: "PROVIDER_CONNECTION_CONFLICT",
    copy: "Broadcast eligibility could not be verified because more than one active channel connection matched.",
  },
  {
    label: "Cancel broadcast",
    status: "draft",
    action: () => vi.mocked(cancelBroadcastRun),
    code: "CAS_CONFLICT",
    copy: "This changed since you last loaded it — reload to see the latest.",
  },
];

describe("broadcast lifecycle actions report their own rejection (#724)", () => {
  for (const testCase of REJECTED_ACTIONS) {
    it(`${testCase.label}: a rejected action leaves its reason on screen after the forced re-read`, async () => {
      stubBroadcastRefresh(testCase.status);
      testCase.action().mockResolvedValue({ ok: false, error: testCase.code } as never);

      const dom = await render(createElement(BroadcastDetailPage, broadcastProps(testCase.status)));
      if (testCase.label === "Freeze audience") {
        await chooseOption(dom.querySelector<HTMLSelectElement>("select")!, "seg-1");
      }
      await click(buttonWithText(dom, testCase.label));

      // The server rejected it and the page re-read the latest revision — both are true, and
      // the merchant must still be told why nothing happened.
      expect(testCase.action()).toHaveBeenCalledTimes(1);
      expect(getBroadcastRunLivePreflight).toHaveBeenCalled();
      expect(dom.textContent).toContain(testCase.copy);
    });
  }

  it("a successful action clears the previous error, and so does the manual Refresh button", async () => {
    stubBroadcastRefresh("draft");
    vi.mocked(freezeAudience)
      .mockResolvedValueOnce({ ok: false, error: "INVALID_ARGUMENT" } as never)
      .mockResolvedValueOnce({ ok: true } as never);

    const dom = await render(createElement(BroadcastDetailPage, broadcastProps("draft")));
    await chooseOption(dom.querySelector<HTMLSelectElement>("select")!, "seg-1");

    await click(buttonWithText(dom, "Freeze audience"));
    expect(dom.textContent).toContain("That request wasn't valid");

    await click(buttonWithText(dom, "Freeze audience"));
    expect(dom.textContent).not.toContain("That request wasn't valid");

    // And a rejected action followed by an explicit Refresh resets the banner too.
    vi.mocked(freezeAudience).mockResolvedValue({ ok: false, error: "INVALID_ARGUMENT" } as never);
    await click(buttonWithText(dom, "Freeze audience"));
    expect(dom.textContent).toContain("That request wasn't valid");
    await click(buttonWithText(dom, "Refresh"));
    expect(dom.textContent).not.toContain("That request wasn't valid");
  });
});

// ---------------------------------------------------------------------------
// #725 — Inbox assignment picks a teammate by name, never a hand-typed ULID
// ---------------------------------------------------------------------------

const MEMBER_SELF = { membershipId: "01KZEKBC0TBG2E8NM5MMV3NJRM", displayName: "Aisyah Rahman", role: "owner", roles: ["owner"], isSelf: true };
const MEMBER_OTHER = { membershipId: "01KZEKBC0TBG2E8NM5MMV3NJXX", displayName: "Farid Hassan", role: "member", roles: ["member"], isSelf: false };

const CONVERSATION = {
  id: "conv-1",
  revision: 7,
  status: "open",
  automationState: "merchant_controlled",
  lastMessageAt: "2026-08-01T00:00:00.000Z",
  draft: null,
  assigneeMembership: null,
  contactIdentity: {
    channel: "whatsapp",
    externalId: "60123456789",
    handle: null,
    label: null,
    contact: { id: "contact-1", name: "Siti", lifecycleStage: "lead" },
  },
};

const PREFLIGHT_PASS = {
  ok: true,
  resource: {
    checkedAt: "2026-08-01T00:00:00.000Z",
    internalCapability: { status: "pass" },
    connection: { status: "unknown" },
    d8Carrier: { status: "unknown" },
    consentStop: { status: "unknown" },
    doNotDisturb: { status: "unknown" },
    providerRefusal: { status: "unknown" },
    frequency: { status: "unknown" },
    exactApproval: { status: "unknown" },
    sendEligibility: { status: "unknown" },
    freshness: {
      lastProviderEventAt: null,
      lastHealthCheckedAt: null,
      lastDataLoadedAt: "2026-08-01T00:00:00.000Z",
    },
  },
};

function inboxProps(assignee: { id: string; role: string } | null): ComponentProps<typeof InboxConversationPage> {
  return {
    conversationId: "conv-1",
    initialState: {
      conversation: { ok: true, resource: { ...CONVERSATION, assigneeMembership: assignee } },
      history: {
        ok: true,
        resource: {
          messages: [],
          events: assignee
            ? [{
                id: "evt-1",
                kind: "assigned",
                fromAssigneeMembershipId: null,
                toAssigneeMembershipId: assignee.id,
                fromAutomationState: null,
                toAutomationState: null,
                note: null,
                createdAt: "2026-08-01T00:00:00.000Z",
              }]
            : [],
        },
      },
      preflight: PREFLIGHT_PASS,
    },
    initialDirectory: { ok: true, resource: { self: MEMBER_SELF, members: [MEMBER_SELF, MEMBER_OTHER] } },
  } as unknown as ComponentProps<typeof InboxConversationPage>;
}

describe("Inbox assignment names teammates instead of demanding an internal id (#725)", () => {
  it("lists real member names in an Assign to picker and assigns by the id behind the chosen name", async () => {
    vi.mocked(assignConversation).mockResolvedValue({ ok: true } as never);
    vi.mocked(getConversation).mockResolvedValue({ ok: true, resource: CONVERSATION } as never);
    vi.mocked(getHistory).mockResolvedValue({ ok: true, resource: { messages: [], events: [] } } as never);
    vi.mocked(getConversationPreflight).mockResolvedValue(PREFLIGHT_PASS as never);

    const dom = await render(createElement(InboxConversationPage, inboxProps(null)));

    const picker = dom.querySelector<HTMLSelectElement>('select[aria-label="Assign to"]');
    expect(picker, "assignment must offer a member picker, not a free-text id field").toBeTruthy();
    const optionLabels = Array.from(picker!.options).map((option) => option.textContent ?? "");
    expect(optionLabels.some((label) => label.includes("Farid Hassan"))).toBe(true);
    expect(optionLabels.some((label) => label.includes("Aisyah Rahman"))).toBe(true);

    await chooseOption(picker!, MEMBER_OTHER.membershipId);
    await click(buttonWithText(dom, "Assign"));

    expect(assignConversation).toHaveBeenCalledWith({
      conversationId: "conv-1",
      expectedRevision: 7,
      targetMembershipId: MEMBER_OTHER.membershipId,
    });
    // The false "lookup isn't available yet" copy is gone.
    expect(dom.textContent).not.toContain("Team-member lookup isn");
  });

  it("shows the assignee's name — never a raw membership id — in the panel and the timeline", async () => {
    const dom = await render(
      createElement(InboxConversationPage, inboxProps({ id: MEMBER_OTHER.membershipId, role: "member" })),
    );

    expect(dom.textContent).toContain("Farid Hassan");
    // No ULID anywhere on screen: 26 chars of Crockford base32 is the shape the走查 hit.
    expect(dom.textContent).not.toMatch(/\b[0-9A-HJKMNP-TV-Z]{26}\b/);
    expect(dom.textContent).not.toContain("Assigned to membership 01KZ");
  });
});

// ---------------------------------------------------------------------------
// #720 / #721 — Routine authorization reads server truth; archived tells the truth
// ---------------------------------------------------------------------------

const DEFINITION = {
  id: "wf-1",
  slug: "outside-hours-reply",
  name: "Outside hours reply",
  definitionKind: "rule",
  status: "published",
  currentRevision: 1,
  rowRevision: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const REVISION = {
  id: "rev-1",
  revision: 1,
  validationState: "valid",
  validationErrorsJson: null,
  rulesSource: "version: fikirtive-workflow/v1\nname: Outside hours reply\n",
  createdAt: "2026-08-01T00:00:00.000Z",
};

function persistedRoutine(status: string) {
  return {
    id: "routine-1",
    routineKey: "outside-hours-reply-routine",
    supersedesRoutineId: null,
    status,
    workflowDefinition: { id: DEFINITION.id, slug: DEFINITION.slug, name: DEFINITION.name },
    workflowRevision: { id: REVISION.id, revision: 1, validationState: "valid" },
    authorization: {
      revision: 1,
      authorized: status === "active",
      authorizedAt: status === "active" ? "2026-08-01T00:00:00.000Z" : null,
      expiresAt: "2026-12-31T00:00:00.000Z",
    },
    scopeSummary: {
      actionKinds: ["complete"],
      channelCount: 0,
      contactCount: 0,
      segmentCount: 0,
      maxActions: 1,
      maxRecipients: 1,
    },
    maxCreditsPerRun: 0,
    maxCreditsPerMonth: 0,
    summaryPolicy: { afterEachRun: "workflow_activity" },
    killSwitchEngaged: false,
    killedAt: null,
    killReasonCode: null,
    rowRevision: status === "active" ? 1 : 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function workflowProps(options: {
  status?: string;
  routines?: ReturnType<typeof persistedRoutine>[];
  routinesFailed?: boolean;
}): ComponentProps<typeof WorkflowDetailPage> {
  return {
    workflowDefinitionId: DEFINITION.id,
    initialDefinition: { ok: true, resource: { ...DEFINITION, status: options.status ?? "published" } },
    initialRevisions: { ok: true, resource: [REVISION] },
    initialRoutines: options.routinesFailed
      ? { ok: false, error: "AUTHORITY_UNAVAILABLE" }
      : { ok: true, resource: { items: options.routines ?? [], nextCursor: null } },
    initialRuns: { ok: true, resource: { items: [], nextCursor: null } },
    initialJourneys: { ok: true, resource: { items: [], nextCursor: null } },
    initialPolicies: { ok: true, resource: { items: [], nextCursor: null } },
  } as unknown as ComponentProps<typeof WorkflowDetailPage>;
}

function statusSummaryText(dom: HTMLElement): string {
  const heading = Array.from(dom.querySelectorAll("dt")).find((dt) => dt.textContent === "Status");
  expect(heading, "the rule summary must carry a Status cell").toBeTruthy();
  return heading!.parentElement?.querySelector("dd")?.textContent ?? "";
}

describe("Routine authorization is driven by the server read, not by this page load (#720)", () => {
  it("activates a Routine draft that only exists on the server, and shows the switch once it is active", async () => {
    vi.mocked(activateRoutine).mockResolvedValue({ ok: true, resource: { id: "routine-1" } } as never);
    vi.mocked(listRoutines).mockResolvedValue({
      ok: true,
      resource: { items: [persistedRoutine("active")], nextCursor: null },
    } as never);

    // Exactly the走查 state: a draft Routine read back from the database on a fresh page load.
    const dom = await render(
      createElement(WorkflowDetailPage, workflowProps({ routines: [persistedRoutine("draft")] })),
    );

    // Before activation there is nothing to switch on — but there IS a way in.
    expect(dom.querySelector('[role="switch"][aria-checked="true"]')).toBeNull();
    await click(buttonWithText(dom, "Review activation"));

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog, "activation opens the human confirmation dialog").toBeTruthy();
    const acknowledgement = dialog!.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(acknowledgement, "activation still requires the human confirmation checkbox").toBeTruthy();
    await click(acknowledgement!);
    await click(buttonWithText(dialog!, "Activate Routine"));

    // The row read from the server is what gets activated — its id and its row revision.
    expect(activateRoutine).toHaveBeenCalledWith({ routineId: "routine-1", expectedRowRevision: 0 });
    // …and the re-read (not this session's memory) is what puts the on/off switch on screen.
    expect(listRoutines).toHaveBeenCalled();
    const knob = dom.querySelector('[role="switch"]');
    expect(knob, "an active Routine must expose its on/off switch").toBeTruthy();
    expect(knob!.getAttribute("aria-checked")).toBe("true");
  });

  it("renders the switch from props alone — no remount and no in-session envelope required", async () => {
    function panelProps(status: string): ComponentProps<typeof RoutineAuthorizationPanel> {
      return {
        workflowDefinitionId: DEFINITION.id,
        workflowSlug: DEFINITION.slug,
        revisions: [REVISION],
        routines: [persistedRoutine(status)],
        routineReadError: null,
        onRoutinesChanged: () => {},
        disabled: false,
      } as unknown as ComponentProps<typeof RoutineAuthorizationPanel>;
    }

    const dom = await render(createElement(RoutineAuthorizationPanel, panelProps("draft")));
    expect(dom.querySelector('[role="switch"][aria-checked="true"]')).toBeNull();

    // Same mounted component (same element type, no key change): the switch appears purely
    // because the server read says the Routine is active — no remount, no session envelope.
    await rerender(createElement(RoutineAuthorizationPanel, panelProps("active")));
    expect(dom.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps the setup form the merchant is filling in across a Routine re-read", async () => {
    vi.mocked(getWorkflowDefinition).mockResolvedValue({ ok: true, resource: DEFINITION } as never);
    vi.mocked(listWorkflowRevisions).mockResolvedValue({ ok: true, resource: [REVISION] } as never);
    vi.mocked(listRoutines).mockResolvedValue({ ok: true, resource: { items: [], nextCursor: null } } as never);
    vi.mocked(listRoutineRuns).mockResolvedValue({ ok: true, resource: { items: [], nextCursor: null } } as never);
    vi.mocked(getContactJourneyStates).mockResolvedValue({ ok: true, resource: { items: [], nextCursor: null } } as never);
    vi.mocked(listBusinessHoursPolicies).mockResolvedValue({ ok: true, resource: { items: [], nextCursor: null } } as never);

    const dom = await render(createElement(WorkflowDetailPage, workflowProps({})));
    await click(buttonWithText(dom, "Set up a new Routine"));
    expect(dom.textContent).toContain("Define this authorization");

    await click(buttonWithText(dom, "Refresh"));
    // The panel used to be keyed on the read counter, so a refresh mid-setup wiped the form.
    expect(dom.textContent).toContain("Define this authorization");
  });
});
