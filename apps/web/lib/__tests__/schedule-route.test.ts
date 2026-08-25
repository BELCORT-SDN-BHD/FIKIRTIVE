// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

const WEB_ROOT = path.resolve(__dirname, "../..");
const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); }),
  requireOwner: vi.fn(),
  getEntities: vi.fn(),
  getRecentGenerationThumbs: vi.fn(),
  getMyAds: vi.fn(),
  listBrandRecords: vi.fn(),
  getAnalytics: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/data", () => ({
  getEntities: mocks.getEntities,
  getRecentGenerationThumbs: mocks.getRecentGenerationThumbs,
  getMyAds: mocks.getMyAds,
}));
vi.mock("@/lib/brand-record-actions", () => ({ listBrandRecords: mocks.listBrandRecords }));
vi.mock("@/lib/analytics-actions", () => ({ getAnalytics: mocks.getAnalytics }));
vi.mock("@/lib/dto", () => ({ toEntityDTO: (entity: unknown) => entity }));

const SchedulePage = (await import("@/app/schedule/page")).default;
const AnalyticsPage = (await import("@/app/schedule/analytics/page")).default;
const { ScheduleSurface } = await import("@/components/schedule/schedule-surface");
const { AnalyticsSurface } = await import("@/components/schedule/analytics-surface");

const SIGNED_IN = { email: "nurul@warungnurul.my", ownerId: "org_nurul" };

beforeEach(() => {
  mocks.requireOwner.mockResolvedValue(SIGNED_IN);
  mocks.getEntities.mockResolvedValue([]);
  mocks.getRecentGenerationThumbs.mockResolvedValue([]);
  mocks.getMyAds.mockResolvedValue([]);
  mocks.listBrandRecords.mockResolvedValue([]);
  mocks.getAnalytics.mockResolvedValue({ state: "notConnected" });
});

afterEach(() => vi.clearAllMocks());

describe("R22 Schedule 与 Analytics route contract", () => {
  it.each([
    ["schedule", SHELL_ROUTES.schedule],
    ["analytics", SHELL_ROUTES.analytics],
  ])("%s → %s 有真实 page.tsx", (_key, href) => {
    expect(existsSync(path.join(WEB_ROOT, "app", href.replace(/^\//, ""), "page.tsx"))).toBe(true);
  });

  it("两页是 R22 顶层导航目的地，layout 不再画旧的嵌套 tabs", () => {
    const layout = readFileSync(path.join(WEB_ROOT, "app/schedule/layout.tsx"), "utf8");
    const nav = readFileSync(path.join(WEB_ROOT, "../../packages/core/src/navigation.ts"), "utf8");
    expect(layout).not.toContain("ScheduleTabs");
    expect(layout).toContain("return <>{children}</>");
    expect(nav).toContain('key: "analytics"');
    expect(nav).toContain("href: SHELL_ROUTES.analytics");
  });

  it("未登录时两条路由都 fail closed", async () => {
    mocks.requireOwner.mockResolvedValue({ error: "Not authorized." });
    await expect(SchedulePage()).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(AnalyticsPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.getEntities).not.toHaveBeenCalled();
    expect(mocks.getAnalytics).not.toHaveBeenCalled();
  });

  it("Schedule 只读取认证 owner 的真实 Library 素材", async () => {
    mocks.getRecentGenerationThumbs.mockResolvedValue([
      { id: "gen-1", projectId: "proj-1", assetId: "asset-1", src: "https://cdn.test/a.png", kind: "image", prompt: "Raya promo" },
    ]);
    const element = (await SchedulePage()) as React.ReactElement<{ stuffItems: { id: string }[] }>;
    for (const read of [mocks.getEntities, mocks.getRecentGenerationThumbs, mocks.getMyAds, mocks.listBrandRecords]) {
      expect(read).toHaveBeenCalledWith(SIGNED_IN.ownerId);
    }
    expect(element.type).toBe(ScheduleSurface);
    expect(element.props.stuffItems.map((item) => item.id)).toEqual(["gen:gen-1"]);
  });

  it("Analytics 保留 disconnected 与 transient failure 的差别", async () => {
    const disconnected = (await AnalyticsPage()) as React.ReactElement<{ initial: { state: string } }>;
    expect(disconnected.type).toBe(AnalyticsSurface);
    expect(disconnected.props.initial).toEqual({ state: "notConnected" });

    mocks.getAnalytics.mockRejectedValue(new Error("meta down"));
    const failed = (await AnalyticsPage()) as React.ReactElement<{ initial: { state: string } }>;
    expect(failed.props.initial).toEqual({ state: "transientError" });
  });

  it("显式 fixture 才能得到确定性数据，且只写入 workspace-scoped session fixture", async () => {
    const schedule = (await SchedulePage({ searchParams: Promise.resolve({ fixture: "r22", compose: "new" }) })) as React.ReactElement<{ fixture: boolean; openComposer: boolean }>;
    const analytics = (await AnalyticsPage({ searchParams: Promise.resolve({ fixture: "r22" }) })) as React.ReactElement<{ fixture: boolean; initial: { state: string } }>;
    expect(schedule.props.fixture).toBe(true);
    expect(schedule.props.openComposer).toBe(true);
    expect(analytics.props.fixture).toBe(true);
    expect(analytics.props.initial.state).toBe("ready");

    const composer = readFileSync(path.join(WEB_ROOT, "components/schedule/r22-schedule-composer.tsx"), "utf8");
    expect(composer).toContain("onFixtureUpsert(post)");
    expect(composer).toContain("scopedR22FixtureKey");
    expect(composer).toContain("R22 fixture changes stay in this browser tab");
    expect(composer).toContain("createScheduledPost(input)");
    expect(composer).toContain("updateScheduledPost(seed.post.id");
    expect(composer).toContain("approveScheduledPost(id)");
    expect(composer).toContain("cancelScheduledPost(seed.post.id)");
  });

  it("可见 R22 surface 没有旧 Schedule/Analytics 页签或 Coming soon 承诺", () => {
    const surface = readFileSync(path.join(WEB_ROOT, "components/schedule/schedule-surface.tsx"), "utf8");
    const analytics = readFileSync(path.join(WEB_ROOT, "components/schedule/analytics-surface.tsx"), "utf8");
    for (const source of [surface, analytics]) {
      expect(source).not.toContain("ScheduleTabs");
      expect(source).not.toContain("Coming soon");
    }
  });
});
