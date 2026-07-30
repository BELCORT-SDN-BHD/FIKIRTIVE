import { it, expect, vi } from "vitest";
import { readSpendingSkill, executeReadSpending, summariseSpending } from "./read-spending.js";

const ENTRIES = [
  { category: "chat", label: "Chat", credits: -3.3, at: "2026-07-30T13:15:20.000Z", pending: false },
  { category: "review", label: "Review", credits: -0.7, at: "2026-07-30T13:19:20.000Z", pending: false },
  { category: "image", label: "Image", credits: -1, at: "2026-07-30T13:18:40.000Z", pending: false },
  { category: "chat", label: "Chat", credits: -4.5, at: "2026-07-30T13:25:00.000Z", pending: false },
  // A hold that has NOT settled — its 12 credits are reserved, not spent (round-2 P1②).
  { category: "video", label: "Video", credits: -12, at: "2026-07-30T13:26:00.000Z", pending: true },
  { category: "topup", label: "Top-up", credits: 100, at: "2026-07-30T12:00:00.000Z", pending: false },
];

type Overview = {
  balance: number;
  reserved: number;
  window: { taskLimit: number; returned: number; hasMore: boolean };
  entries: typeof ENTRIES;
};

function port(over: Partial<Overview> = {}) {
  return {
    overview: vi.fn(async () => ({
      ok: true as const,
      balance: 78.5,
      reserved: 0,
      window: { taskLimit: 50, returned: ENTRIES.length, hasMore: false },
      entries: ENTRIES,
      ...over,
    })),
  };
}

it("gate: free/read/internal → ungated, and it can never spend", () => {
  expect(readSpendingSkill.cost).toBe("free");
  expect(readSpendingSkill.effect).toBe("read");
  expect(readSpendingSkill.reach).toBe("internal");
  expect(readSpendingSkill.needsApproval).toBe(false);
});

it("is registered under a name the instructions can point at", () => {
  expect(readSpendingSkill.name).toBe("readSpending");
  expect(readSpendingSkill.requires).toEqual([]);
});

it("returns the balance, the window, and the merchant's recent charges from the port", async () => {
  const spending = port();
  const res: any = await executeReadSpending({}, { context: { spending } as any });

  expect(spending.overview).toHaveBeenCalledTimes(1);
  expect(res.ok).toBe(true);
  expect(res.balance).toBe(78.5);
  expect(res.window).toEqual({ taskLimit: 50, returned: 6, hasMore: false });
  expect(res.entries).toHaveLength(6);
});

it("adds the totals up in code so the model never has to", async () => {
  const res: any = await executeReadSpending({}, { context: { spending: port() } as any });

  // charged is POSITIVE and SETTLED-ONLY: 3.3 + 0.7 + 1 + 4.5 = 9.5 — the S6 session's real
  // total. The 12-credit video hold is NOT in it.
  expect(res.totals.charged).toBe(9.5);
  expect(res.totals.added).toBe(100);
  expect(res.totals.byCategory).toEqual({ chat: 7.8, review: 0.7, image: 1 });
});

// Round-2 review P1②: an unsettled hold is a reservation ceiling, not money spent. The
// instructions tell the model to quote totals verbatim, so folding a hold into `charged`
// made Otto tell a merchant they had spent credits they had not.
it("never counts an unsettled hold as money spent", async () => {
  const res: any = await executeReadSpending({}, { context: { spending: port() } as any });

  expect(res.totals.onHold).toBe(12);
  expect(res.totals.charged).toBe(9.5);
  expect(res.totals.byCategory.video).toBeUndefined();
});

it("carries the truncation flag through so an answer cannot claim to cover all time", async () => {
  const spending = port({ window: { taskLimit: 50, returned: 50, hasMore: true } });
  const res: any = await executeReadSpending({}, { context: { spending } as any });

  expect(res.window.hasMore).toBe(true);
});

it("passes a port error through instead of inventing numbers", async () => {
  const spending = { overview: vi.fn(async () => ({ error: "Not authorized." })) };
  const res: any = await executeReadSpending({}, { context: { spending } as any });

  expect(res).toEqual({ error: "Not authorized." });
  expect(res.balance).toBeUndefined();
});

it("degrades gracefully when the port is missing", async () => {
  const res: any = await executeReadSpending({}, { context: {} as any });
  expect(res.error).toBeTruthy();
  expect(res.balance).toBeUndefined();
});

it("tells the model the window is bounded and that Chat is a conversation turn", () => {
  expect(readSpendingSkill.description).toMatch(/window\.hasMore/);
  expect(readSpendingSkill.description).toMatch(/never 'everything you have ever spent'/);
  expect(readSpendingSkill.description).toMatch(/Chat = one conversation turn/);
});

it("tells the model that a hold is not money spent", () => {
  expect(readSpendingSkill.description).toMatch(/totals\.charged is money actually SPENT/);
  expect(readSpendingSkill.description).toMatch(/totals\.onHold is money merely HELD/);
  expect(readSpendingSkill.description).toMatch(/never add it to the spent figure/);
});

it("summariseSpending keeps displayed credits at one decimal (no float dust)", () => {
  const totals = summariseSpending([
    { category: "chat", label: "Chat", credits: -0.1, at: "", pending: false },
    { category: "chat", label: "Chat", credits: -0.2, at: "", pending: false },
  ]);
  expect(totals.charged).toBe(0.3);
  expect(totals.byCategory.chat).toBe(0.3);
});

it("summariseSpending never nets a top-up against a charge", () => {
  const totals = summariseSpending([
    { category: "chat", label: "Chat", credits: -5, at: "", pending: false },
    { category: "topup", label: "Top-up", credits: 100, at: "", pending: false },
  ]);
  expect(totals).toEqual({ charged: 5, onHold: 0, added: 100, byCategory: { chat: 5 } });
});

it("summariseSpending splits held from spent, and rounds each on its own", () => {
  const totals = summariseSpending([
    { category: "chat", label: "Chat", credits: -0.1, at: "", pending: false },
    { category: "chat", label: "Chat", credits: -0.2, at: "", pending: true },
    { category: "video", label: "Video", credits: -0.2, at: "", pending: true },
  ]);
  expect(totals).toEqual({ charged: 0.1, onHold: 0.4, added: 0, byCategory: { chat: 0.1 } });
});

it("a workspace whose only activity is an open hold has spent nothing", () => {
  const totals = summariseSpending([
    { category: "chat", label: "Chat", credits: -12, at: "", pending: true },
  ]);
  expect(totals.charged).toBe(0);
  expect(totals.onHold).toBe(12);
  expect(totals.byCategory).toEqual({});
});
