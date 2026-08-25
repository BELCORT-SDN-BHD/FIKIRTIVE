import { readFileSync } from "node:fs";
import path from "node:path";
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

/**
 * 上面那一族钉的是**页面入口**(`page.tsx` / `*Entry.tsx`):fixture 参数不许绕开认证。
 * 但 fixture 还有第二类读取点 —— **客户端组件自己看地址栏**。它们跑在认证之后,绕不开
 * 登录闸,可是照样能把已登录商家的屏幕换成别人的 fixture 数据。
 *
 * 2026-08-25 判官实证:`R22DashboardShell` 缺了 `NODE_ENV` 那半边,生产上
 * `/?fixture=r22` 会把这家商家的工作区名字换成 "Batik House",工作区菜单里再多出两个
 * 不属于他的 fixture workspace。同胞两处(`global-navigation`、`OttoPanelHost`)从一开始
 * 就带着那半边 —— 漏的是这一处,不是规矩不清楚。
 *
 * 这一条只能看源码:三个组件读的是浏览器地址,渲染它们要整套 DOM 与 provider,而要证的
 * 命题("这个读取点带着生产闸")本身就是一个**源码结构**命题。围栏性质如此,断言形状
 * 跟着走 —— 但不许只查一个字符串在不在:下面数的是**每一个** fixture 读取点是否都带闸,
 * 谁新写一个不带闸的读取点,这里就红。
 */
describe("R22 client fixture reads all carry the production fence", () => {
  const WEB_ROOT = path.resolve(__dirname, "../..");
  const SURFACES = [
    "components/r22/R22DashboardShell.tsx",
    "components/global-navigation.tsx",
    "components/otto/panel/OttoPanelHost.tsx",
  ] as const;

  /** 读地址栏判 fixture 的那个表达式,不论闸在不在。 */
  const READS_FIXTURE = /new URLSearchParams\([^;]*?\.get\("fixture"\) === "r22"/g;
  /** 同一个表达式,前面钉着生产闸。 */
  const GUARDED = /process\.env\.NODE_ENV !== "production" && new URLSearchParams\([^;]*?\.get\("fixture"\) === "r22"/g;

  it.each(SURFACES)("%s reads ?fixture=r22 only outside production", (relative) => {
    const source = readFileSync(path.join(WEB_ROOT, relative), "utf8").replace(/\s+/g, " ");
    const reads = source.match(READS_FIXTURE) ?? [];
    const guarded = source.match(GUARDED) ?? [];

    // 读取点消失(改名、搬家)时这里就红 —— 一条匹配不到东西的围栏是绿的假象。
    expect(reads.length, `${relative} 里找不到 fixture 读取点 —— 围栏在核对空气`).toBeGreaterThanOrEqual(1);
    expect(
      guarded.length,
      `${relative} 有 ${reads.length} 个 fixture 读取点,只有 ${guarded.length} 个带 NODE_ENV 闸 —— 生产上 ?fixture=r22 会改已登录商家看到的东西`,
    ).toBe(reads.length);
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
