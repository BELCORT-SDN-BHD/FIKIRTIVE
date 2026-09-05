import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 判官 2026-09-05 P1-1 的围栏 —— 打在 `me/adaccounts` → `hasAdAccounts` 这道**推导缝**上。
 *
 * 别的 Home 测试都手写 `hasAdAccounts`,于是「这个布尔到底从哪来」一条测试都没守着。上一轮
 * 它来自 `accounts.length`,而 `accounts` 已经被 `getAccountInsights → null` 滤掉了「这段期间
 * 没投放」的账号 —— 真有广告账号、只是停投的商家因此被告知「你还没有广告账号」。
 *
 * 所以这个文件**不 mock `meta-insights`**:mock 的是最外层的 `meta-graph`,让真的
 * `fetchOwnerInsights` 跑一遍,再把 `getAnalytics` 的结果喂给 `marketingHealthFromAnalytics`。
 * 缝里再塞回 `accounts.length`,这里就会红。
 */

const { mockRequireOwner, mockFindUnique, mockUpdate, mockGraphGet, mockAccountInsights, mockAccountSeries } =
  vi.hoisted(() => ({
    mockRequireOwner: vi.fn(),
    mockFindUnique: vi.fn(),
    mockUpdate: vi.fn(),
    mockGraphGet: vi.fn(),
    mockAccountInsights: vi.fn(),
    mockAccountSeries: vi.fn(),
  }));

vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@fikirtive/db", () => ({
  prisma: { metaConnection: { findUnique: mockFindUnique, update: mockUpdate } },
}));
vi.mock("../meta-graph", () => ({
  metaGraphGet: mockGraphGet,
  getAccountInsights: mockAccountInsights,
  getAccountInsightsSeries: mockAccountSeries,
}));

import { getAnalytics } from "../analytics-actions";
import { marketingHealthFromAnalytics } from "../home-marketing-health";

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
  const { encryptToken } = await import("../token-encryption");
  mockRequireOwner.mockResolvedValue({ ownerId: "o1", email: "a@b.co" });
  mockFindUnique.mockResolvedValue({ accessTokenEnc: encryptToken("LONGTOKEN"), status: "active" });
  mockAccountSeries.mockResolvedValue([]);
});

describe("FRONT-A3 缝:hasAdAccounts 读的是 me/adaccounts,不是「这期间有 insights 行的账号」", () => {
  it("FRONT-A3:名下有广告账号、只是这段期间零投放 —— hasAdAccounts 为真,读模型是 insufficient(换期间),不是「去接一个广告账号」", async () => {
    // Meta 认得这个账号,但这段期间它没有 insights 行 —— Graph 对零投放账号回 data: [],
    // getAccountInsights 于是回 null(见 meta-graph.ts 的注释)。
    mockGraphGet.mockResolvedValue({ data: [{ id: "act_1", account_id: "1", name: "Kaia Cafe", currency: "MYR" }] });
    mockAccountInsights.mockResolvedValue(null);

    const analytics = await getAnalytics({ range: "30d" });
    if (analytics.state !== "ready") throw new Error(`expected ready, got ${analytics.state}`);

    expect(analytics.hasAdAccounts).toBe(true); // 有账号
    expect(analytics.empty).toBe(true); // 只是没数

    expect(marketingHealthFromAnalytics(analytics, "online-sales", "30-days")).toEqual({
      state: "insufficient",
      goal: "online-sales",
      source: { id: "meta-ads", label: "Meta ads" },
    });
  });

  it("FRONT-A3:这个 Meta 登录名下一个广告账号都没有 —— hasAdAccounts 为假,读模型才是「去接一个投广告的账号」", async () => {
    mockGraphGet.mockResolvedValue({ data: [] });
    mockAccountInsights.mockResolvedValue(null);

    const analytics = await getAnalytics({ range: "30d" });
    if (analytics.state !== "ready") throw new Error(`expected ready, got ${analytics.state}`);

    expect(analytics.hasAdAccounts).toBe(false);
    expect(marketingHealthFromAnalytics(analytics, "online-sales", "30-days")).toEqual({
      state: "not-configured",
      goal: "online-sales",
      action: "connect-ad-account",
    });
  });
});
