import { it, expect, vi, beforeEach } from "vitest";

const { mockFindUnique, mockUpdate, mockListPages } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockListPages: vi.fn(),
}));

vi.mock("../meta-graph", () => ({
  listPages: mockListPages,
}));
vi.mock("../token-encryption", () => ({ decryptToken: () => "tok" }));
vi.mock("@fikirtive/db", () => ({
  prisma: { metaConnection: { findUnique: mockFindUnique, update: mockUpdate } },
}));

import { fetchOwnerPages } from "../meta-pages";

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({});
});

it("returns notConnected when no MetaConnection", async () => {
  mockFindUnique.mockResolvedValue(null);
  expect(await fetchOwnerPages("org1")).toEqual({ notConnected: true });
});

it("returns needsPageScope when canManagePages is false", async () => {
  mockFindUnique.mockResolvedValue({ accessTokenEnc: "e", canManagePages: false });
  expect(await fetchOwnerPages("org1")).toEqual({ needsPageScope: true });
});

it("maps pages from listPages", async () => {
  mockFindUnique.mockResolvedValue({ accessTokenEnc: "e", canManagePages: true });
  mockListPages.mockResolvedValue([
    { id: "p1", name: "Page One" },
    { id: "p2", name: "Page Two" },
  ]);
  const res = await fetchOwnerPages("org1");
  expect(res).toEqual({ pages: [{ id: "p1", name: "Page One" }, { id: "p2", name: "Page Two" }] });
});

it("returns needsReconnect on code-190", async () => {
  mockFindUnique.mockResolvedValue({ accessTokenEnc: "e", canManagePages: true });
  mockListPages.mockRejectedValue({ metaError: { code: 190 } });
  expect(await fetchOwnerPages("org1")).toEqual({ needsReconnect: true });
});

it("returns transientError (F37) on a non-auth Graph error — never a false reconnect", async () => {
  mockFindUnique.mockResolvedValue({ accessTokenEnc: "e", canManagePages: true });
  mockListPages.mockRejectedValue(new Error("network down"));
  expect(await fetchOwnerPages("org1")).toEqual({ transientError: true });
  expect(mockUpdate).not.toHaveBeenCalled();
});

// #741 判官 r5 [P1] —— 第一个 Prisma 读在 try/catch 之外:数据库抽风时这个函数**抛异常**,
// 而它的每一个调用方(渠道适配器、批准路径、Otto 端口)都只准备好接住一个返回值形状。
// 读不到连接行 = 我们没查到,如实报 transientError,由上层决定怎么如实说。
it("连接行本身读不出来(Prisma 抛错)不许把异常抛出去 —— 如实报 transientError", async () => {
  mockFindUnique.mockRejectedValue(new Error("db unavailable"));
  await expect(fetchOwnerPages("org1")).resolves.toEqual({ transientError: true });
});
