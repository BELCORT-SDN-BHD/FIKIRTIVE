import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  requireOwner: vi.fn(),
  getMyAccount: vi.fn(),
  getAccountViewData: vi.fn(),
  getOrCreateDefaultProject: vi.fn(),
  getCoworkThreads: vi.fn(),
  getEntities: vi.fn(),
  getProjects: vi.fn(),
  toEntityDTO: vi.fn((value) => value),
  getMyProfileNames: vi.fn(),
  getMetaConnection: vi.fn(),
  listRoutines: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/lib/account-view-data", () => ({ getAccountViewData: mocks.getAccountViewData }));
vi.mock("@/lib/actions", () => ({ getOrCreateDefaultProject: mocks.getOrCreateDefaultProject }));
vi.mock("@/lib/data", () => ({
  getCoworkThreads: mocks.getCoworkThreads,
  getEntities: mocks.getEntities,
  getProjects: mocks.getProjects,
}));
vi.mock("@/lib/dto", () => ({ toEntityDTO: mocks.toEntityDTO }));
vi.mock("@/lib/profile-names", () => ({ getMyProfileNames: mocks.getMyProfileNames }));
vi.mock("@/lib/meta-actions", () => ({ getMetaConnection: mocks.getMetaConnection }));
vi.mock("@/lib/customer-workflow-gateway", () => ({ listRoutines: mocks.listRoutines }));
vi.mock("@/components/canvas/NorthstarCanvasWorkspace", () => ({ NorthstarCanvasWorkspace: vi.fn(() => null) }));
vi.mock("@/components/onboarding/R22Onboarding", () => ({ R22Onboarding: vi.fn(() => null) }));
vi.mock("@/components/settings/R22SettingsShell", () => ({ R22SettingsShell: vi.fn(() => null) }));
vi.mock("@/components/routines/R22RoutinesView", () => ({ R22RoutinesView: vi.fn(() => null) }));

import OnboardingPage from "@/app/onboarding/page";
import { ImmersiveCanvasEntry } from "@/components/canvas/ImmersiveCanvasEntry";
import { R22RoutinesEntry } from "@/components/routines/R22RoutinesEntry";
import { R22SettingsEntry } from "@/components/settings/R22SettingsEntry";

function elementProps<T>(value: unknown): T {
  return (value as ReactElement<T>).props;
}

describe("R22 production fixture fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    mocks.requireOwner.mockResolvedValue({ error: "Not authorized." });
    mocks.redirect.mockImplementation((href: string) => {
      throw new Error(`NEXT_REDIRECT:${href}`);
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["Canvas", () => ImmersiveCanvasEntry({ searchParams: Promise.resolve({ fixture: "r22" }) })],
    ["Onboarding", () => OnboardingPage({ searchParams: Promise.resolve({ fixture: "r22", step: "workspace" }) })],
    ["Settings", () => R22SettingsEntry({ searchParams: Promise.resolve({ fixture: "r22" }) })],
    ["Routines", () => R22RoutinesEntry({ searchParams: Promise.resolve({ fixture: "r22" }) })],
  ])("does not let %s fixture bypass authentication", async (_name, render) => {
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:");
    expect(mocks.requireOwner).toHaveBeenCalledTimes(1);
    expect(mocks.getMyAccount).not.toHaveBeenCalled();
    expect(mocks.getMyProfileNames).not.toHaveBeenCalled();
    expect(mocks.getAccountViewData).not.toHaveBeenCalled();
    expect(mocks.listRoutines).not.toHaveBeenCalled();
  });
});

describe("R22 entry truthful-state contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    mocks.requireOwner.mockResolvedValue({ ownerId: "owner-1", email: "owner@example.test" });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("passes an unknown Canvas balance through as null instead of zero", async () => {
    mocks.getOrCreateDefaultProject.mockResolvedValue({ id: "project-1" });
    mocks.getProjects.mockResolvedValue([{ id: "project-1", name: "Launch" }]);
    mocks.getCoworkThreads.mockResolvedValue([]);
    mocks.getEntities.mockResolvedValue([]);
    mocks.getMyAccount.mockResolvedValue({ error: "account unavailable" });

    const element = await ImmersiveCanvasEntry({ searchParams: Promise.resolve({}) });
    const props = elementProps<{ runtimeContext: { initialBalance: number | null; visualFixture: string | null } }>(element);

    expect(props.runtimeContext.initialBalance).toBeNull();
    expect(props.runtimeContext.visualFixture).toBeNull();
  });

  it("keeps Onboarding profile and channel read failures unknown", async () => {
    mocks.getMyProfileNames.mockResolvedValue({ error: "profile unavailable" });
    mocks.getMetaConnection.mockResolvedValue({ error: "Meta status unavailable" });

    const element = await OnboardingPage({ searchParams: Promise.resolve({ step: "workspace" }) });
    const props = elementProps<{
      initialWorkspaceName: string;
      initialWorkspaceError?: string;
      initialChannelState: string;
    }>(element);

    expect(props.initialWorkspaceName).toBe("");
    expect(props.initialWorkspaceError).toBe("profile unavailable");
    expect(props.initialChannelState).toBe("unknown");
  });

  it("keeps unreadable Settings money and ledger distinct from zero and empty", async () => {
    mocks.getMyAccount.mockResolvedValue({ error: "account unavailable" });
    mocks.getAccountViewData.mockResolvedValue({ error: "settings unavailable" });

    const element = await R22SettingsEntry({ searchParams: Promise.resolve({ section: "billing" }) });
    const props = elementProps<{
      data: { balance: number | null; recent: unknown[]; accountReadable: boolean; spendCapCredits: number | null; dataError?: string };
    }>(element);

    expect(props.data).toMatchObject({
      balance: null,
      recent: [],
      accountReadable: false,
      spendCapCredits: null,
      dataError: "account",
    });
  });

  it("maps unknown Routine usage as monthly unknown data and never authorizes an unsafe row", async () => {
    mocks.listRoutines.mockResolvedValue({
      ok: true,
      resource: {
        items: [{
          id: "routine-1",
          routineKey: "weekday-mornings",
          workflowDefinition: { name: "Market posts" },
          scopeSummary: { channelCount: 1 },
          maxCreditsPerMonth: 120,
          status: "active",
          killSwitchEngaged: false,
          authorization: { authorized: false },
        }],
      },
    });

    const element = await R22RoutinesEntry({ searchParams: Promise.resolve({}) });
    const props = elementProps<{ routines: Array<Record<string, unknown>> }>(element);

    expect(props.routines[0]).toMatchObject({
      creditsUsed: null,
      creditsCap: 120,
      creditPeriod: "monthly",
      autoPublish: null,
      status: "draft",
    });
  });
});
