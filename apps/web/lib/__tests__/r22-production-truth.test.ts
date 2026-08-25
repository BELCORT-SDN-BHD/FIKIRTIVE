// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  getMyProfileNames: vi.fn(),
  getMetaConnection: vi.fn(),
  getMyAccount: vi.fn(),
  getAccountViewData: vi.fn(),
  listRoutines: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  routerReplace: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  usePathname: () => "/settings",
  useRouter: () => ({ push: vi.fn(), replace: mocks.routerReplace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/profile-names", () => ({ getMyProfileNames: mocks.getMyProfileNames }));
vi.mock("@/lib/meta-actions", () => ({
  getMetaConnection: mocks.getMetaConnection,
  disconnectMeta: vi.fn(),
}));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/lib/account-view-data", () => ({ getAccountViewData: mocks.getAccountViewData }));
vi.mock("@/lib/customer-workflow-gateway", () => ({ listRoutines: mocks.listRoutines }));
vi.mock("@/lib/owner-settings-actions", () => ({ setOwnerSetting: vi.fn() }));

const OnboardingPage = (await import("@/app/onboarding/page")).default;
const { R22SettingsEntry } = await import("@/components/settings/R22SettingsEntry");
const { R22SettingsShell } = await import("@/components/settings/R22SettingsShell");
const { R22RoutinesEntry } = await import("@/components/routines/R22RoutinesEntry");
const { R22RoutinesView } = await import("@/components/routines/R22RoutinesView");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.requireOwner.mockReset().mockResolvedValue({ ownerId: "org_acme", email: "owner@acme.test" });
  mocks.getMyProfileNames.mockReset().mockResolvedValue({ displayName: "Owner", workspaceName: "Acme", email: "owner@acme.test" });
  mocks.getMetaConnection.mockReset().mockResolvedValue({ connected: false });
  mocks.getMyAccount.mockReset().mockResolvedValue({
    organizationName: "Acme",
    displayName: "Owner",
    email: "owner@acme.test",
    balance: 9,
    recent: [],
  });
  mocks.getAccountViewData.mockReset().mockResolvedValue({
    settings: { spendCapCredits: 40, timezone: "Asia/Kuala_Lumpur" },
    settingsReadable: true,
    channels: [],
    shelf: { packs: [] },
    adsAutonomy: "ASK",
    canPublish: false,
    meta: { connected: false },
  });
  mocks.listRoutines.mockReset().mockResolvedValue({ ok: true, resource: { items: [], nextCursor: null } });
  mocks.redirect.mockClear();
  mocks.routerReplace.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(element: ReactElement) {
  act(() => root!.render(element));
}

function entryProps(element: ReactElement): Record<string, unknown> {
  return element.props as Record<string, unknown>;
}

function button(label: string): HTMLButtonElement {
  const match = [...container!.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (!match) throw new Error(`No button labelled ${label}`);
  return match as HTMLButtonElement;
}

describe("R22 production truth", () => {
  it("keeps onboarding read failures distinct from unnamed and disconnected states", async () => {
    mocks.getMyProfileNames.mockRejectedValueOnce(new Error("profile read failed"));
    mocks.getMetaConnection.mockRejectedValueOnce(new Error("meta read failed"));

    const page = await OnboardingPage({ searchParams: Promise.resolve({ step: "workspace" }) }) as ReactElement;
    expect(entryProps(page).initialWorkspaceName).toBe("");
    expect(entryProps(page).initialWorkspaceError).toBe("Workspace details could not be read.");
    expect(entryProps(page).initialChannelState).toBe("unknown");

    mount(page);
    expect(container!.textContent).toContain("Workspace details could not be read");
    expect(container!.querySelector('a[href="/api/meta/authorize"]')).toBeNull();
  });

  it("keeps Settings account and Meta read failures distinct from empty history and disconnected channels", async () => {
    mocks.getMyAccount.mockRejectedValueOnce(new Error("account read failed"));
    mocks.getAccountViewData.mockResolvedValueOnce({
      settings: { spendCapCredits: 40, timezone: "Asia/Kuala_Lumpur" },
      settingsReadable: true,
      channels: [
        { id: "instagram", label: "Instagram", status: "not_connected", targets: [], connectUrl: "/api/meta/authorize" },
      ],
      shelf: { packs: [] },
      adsAutonomy: "ASK",
      canPublish: false,
      meta: { error: "load-failed" },
    });

    const entry = await R22SettingsEntry({ searchParams: Promise.resolve({ section: "billing" }) }) as ReactElement;
    const data = entryProps(entry).data as {
      accountReadable: boolean;
      balance: number | null;
      recent: unknown[];
      channels: unknown[];
    };
    expect(data).toMatchObject({ accountReadable: false, balance: null, recent: [], channels: [] });

    mount(entry);
    expect(container!.textContent).toContain("Credit activity could not be loaded");
    expect(container!.textContent).not.toContain("No credit activity is available");
  });

  it("never derives a workspace URL when no workspace URL contract exists", () => {
    mount(createElement(R22SettingsShell, {
      initialSection: "workspace",
      data: {
        workspaceName: "Acme & Sons",
        displayName: "Owner",
        email: "owner@acme.test",
        balance: 9,
        recent: [],
        accountReadable: true,
        spendCapCredits: 40,
        timezone: "Asia/Kuala_Lumpur",
        channels: [],
      },
    }));

    expect(container!.textContent).toContain("No workspace URL contract");
    expect(container!.textContent).not.toMatch(/fikirtive\.(?:com|app)\//i);
  });

  it("maps live routine authority without relabelling or inventing fields", async () => {
    mocks.listRoutines.mockResolvedValueOnce({
      ok: true,
      resource: {
        items: [{
          id: "routine-1",
          routineKey: "weekday_posts",
          maxCreditsPerMonth: 24,
          status: "active",
          killSwitchEngaged: false,
          authorization: { authorized: false },
          workflowDefinition: { name: "Prepare posts" },
          scopeSummary: { channelCount: 1 },
        }],
        nextCursor: null,
      },
    });

    const entry = await R22RoutinesEntry({ searchParams: Promise.resolve({}) }) as ReactElement;
    const rows = entryProps(entry).routines as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      creditsUsed: null,
      creditsCap: 24,
      creditPeriod: "monthly",
      status: "draft",
      autoPublish: null,
    });

    mount(entry);
    expect(container!.textContent).toContain("Monthly credits");
    expect(container!.textContent).toContain("Usage unavailable · 24 cr cap");
    expect(container!.textContent).toContain("Auto-publish unknown");
    expect(container!.textContent).not.toContain("Weekly credits");
    expect(container!.textContent).not.toContain("Active");
  });

  it("shows only the routine read error, never a second empty state", async () => {
    mocks.listRoutines.mockRejectedValueOnce(new Error("workflow read failed"));
    const entry = await R22RoutinesEntry({ searchParams: Promise.resolve({}) }) as ReactElement;

    mount(entry);
    expect(container!.textContent).toContain("Routines could not be loaded");
    expect(container!.textContent).not.toContain("No routine yet");
    expect(container!.textContent).not.toContain("No posting runs are available");
    expect(container!.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it("preserves the R22 routine fixture's weekly visual state", () => {
    mount(createElement(R22RoutinesView, { routines: [], fixture: true }));
    expect(container!.textContent).toContain("Weekly credits");
    expect(container!.textContent).toContain("12 of 24 cr");
    expect(container!.textContent).toContain("Auto-publish off");
  });
});
