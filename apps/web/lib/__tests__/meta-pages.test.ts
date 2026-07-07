import { describe, it, expect, vi, beforeEach } from "vitest";

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
