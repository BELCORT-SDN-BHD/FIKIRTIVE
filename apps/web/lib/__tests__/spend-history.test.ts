/**
 * spend-history.test.ts — #555: conversation charges must be visible.
 *
 * The ledger already held every charge; the product showed none of it. These tests pin
 * the PURE read-side shaping (categorise → merge a task's RESERVE + SETTLE/REFUND into
 * one honest net row → format) and the Billing spend-history section that renders it.
 * Nothing here writes credits or touches the reserve/settle path.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SPEND_CATEGORY_LABEL,
  buildSpendHistory,
  spendCategoryOf,
  type SpendLedgerRow,
} from "@/lib/spend-history";
import { SpendHistory, windowSummary } from "@/components/billing/SpendHistory";
import { CHAT_SPEND_NOTE } from "@/lib/credit-format";

const TZ = "UTC";

function row(over: Partial<SpendLedgerRow> & { id: string }): SpendLedgerRow {
  return {
    kind: "RESERVE",
    source: "SYSTEM",
    refId: null,
    balanceDelta: 0,
    reservedDelta: 0,
    createdAt: new Date("2026-07-30T13:15:07.000Z"),
    ...over,
  };
}

describe("spendCategoryOf", () => {
  const jobKinds = new Map<string, "IMAGE" | "VIDEO">([
    ["01KYSJTB9AD9GS61VJY0M04VXP", "IMAGE"],
    ["01KYSJTB9AD9GS61VJY0M04VXQ", "VIDEO"],
  ]);

  it("reads the refId prefix: otto-stream/turn/approve is a chat turn", () => {
    for (const refId of ["otto-stream:m1", "otto-turn:m1", "otto-approve:t1:c1"]) {
      expect(spendCategoryOf({ refId, kind: "RESERVE", source: "SYSTEM" }, jobKinds)).toBe("chat");
    }
  });

  it("separates the automatic post-generation verdict from the merchant's own turns", () => {
    expect(spendCategoryOf({ refId: "otto-verdict:j1", kind: "RESERVE", source: "SYSTEM" }, jobKinds)).toBe("review");
  });

  it("labels a bare job refId by what the job made", () => {
    expect(spendCategoryOf({ refId: "01KYSJTB9AD9GS61VJY0M04VXP", kind: "RESERVE", source: "SYSTEM" }, jobKinds)).toBe("image");
    expect(spendCategoryOf({ refId: "01KYSJTB9AD9GS61VJY0M04VXQ", kind: "RESERVE", source: "SYSTEM" }, jobKinds)).toBe("video");
  });

  it("labels a Stripe purchase as a top-up and other grants/adjustments honestly", () => {
    expect(spendCategoryOf({ refId: null, kind: "GRANT", source: "PURCHASE" }, jobKinds)).toBe("topup");
    expect(spendCategoryOf({ refId: null, kind: "GRANT", source: "BETA" }, jobKinds)).toBe("grant");
    expect(spendCategoryOf({ refId: null, kind: "ADJUST", source: "ADMIN" }, jobKinds)).toBe("adjustment");
  });

  it("never guesses: an unknown refId falls back instead of claiming a category", () => {
    expect(spendCategoryOf({ refId: "unknown-ref", kind: "RESERVE", source: "SYSTEM" }, jobKinds)).toBe("other");
  });

  it("gives every category a plain-language English label", () => {
    expect(SPEND_CATEGORY_LABEL.chat).toBe("Chat");
    expect(SPEND_CATEGORY_LABEL.review).toBe("Review");
    expect(SPEND_CATEGORY_LABEL.image).toBe("Image");
    expect(SPEND_CATEGORY_LABEL.video).toBe("Video");
    expect(SPEND_CATEGORY_LABEL.topup).toBe("Top-up");
  });
});

describe("buildSpendHistory", () => {
  it("merges an Otto turn's hold and settle into ONE row at the NET settled amount", () => {
    // The S6 walkthrough's first turn: reserve 120 internal, settle back 87 → 33 internal
    // = 3.3 displayed credits actually charged.
    const rows: SpendLedgerRow[] = [
      row({ id: "s1", kind: "SETTLE", refId: "otto-stream:m1", balanceDelta: 87, reservedDelta: -120, createdAt: new Date("2026-07-30T13:15:20.000Z") }),
      row({ id: "r1", kind: "RESERVE", refId: "otto-stream:m1", balanceDelta: -120, reservedDelta: 120, createdAt: new Date("2026-07-30T13:15:07.000Z") }),
    ];

    const entries = buildSpendHistory(rows, new Map(), TZ);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      category: "chat",
      label: "Chat",
      delta: -3.3,
      pending: false,
    });
    expect(entries[0].at).toBe("2026-07-30T13:15:20.000Z");
  });

  it("keeps a zero-delta SETTLE from reading as an unsettled hold", () => {
    // A generation settles at exactly the reserved amount → balanceDelta 0. The row still
    // proves the hold closed; dropping it would mislabel a finished job as in-flight.
    const rows: SpendLedgerRow[] = [
      row({ id: "s1", kind: "SETTLE", refId: "job1", balanceDelta: 0, reservedDelta: -10, createdAt: new Date("2026-07-30T13:18:40.000Z") }),
      row({ id: "r1", kind: "RESERVE", refId: "job1", balanceDelta: -10, reservedDelta: 10, createdAt: new Date("2026-07-30T13:18:30.000Z") }),
    ];

    const entries = buildSpendHistory(rows, new Map([["job1", "IMAGE"]]), TZ);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ category: "image", label: "Image", delta: -1, pending: false });
    expect(entries[0].detail).toBeUndefined();
  });

  it("says so plainly when a hold has not settled yet", () => {
    const rows: SpendLedgerRow[] = [
      row({ id: "r1", kind: "RESERVE", refId: "otto-stream:m2", balanceDelta: -120, reservedDelta: 120 }),
    ];

    const entries = buildSpendHistory(rows, new Map(), TZ);

    expect(entries[0]).toMatchObject({ category: "chat", delta: -12, pending: true });
    expect(entries[0].detail).toMatch(/hold/i);
  });

  it("spells out a partial refund so the held and charged amounts both stay visible", () => {
    const rows: SpendLedgerRow[] = [
      row({ id: "s1", kind: "SETTLE", refId: "otto-verdict:j1", balanceDelta: 5, reservedDelta: -12, createdAt: new Date("2026-07-30T13:19:20.000Z") }),
      row({ id: "r1", kind: "RESERVE", refId: "otto-verdict:j1", balanceDelta: -12, reservedDelta: 12, createdAt: new Date("2026-07-30T13:19:13.000Z") }),
    ];

    const entries = buildSpendHistory(rows, new Map(), TZ);

    expect(entries[0]).toMatchObject({ category: "review", label: "Review", delta: -0.7 });
    expect(entries[0].detail).toBe("0.7 credits used · 0.5 refunded");
  });

  it("shows a full refund as a task that cost nothing", () => {
    const rows: SpendLedgerRow[] = [
      row({ id: "f1", kind: "REFUND", refId: "job2", balanceDelta: 80, reservedDelta: -80, createdAt: new Date("2026-07-30T14:00:00.000Z") }),
      row({ id: "r1", kind: "RESERVE", refId: "job2", balanceDelta: -80, reservedDelta: 80, createdAt: new Date("2026-07-30T13:50:00.000Z") }),
    ];

    const entries = buildSpendHistory(rows, new Map([["job2", "VIDEO"]]), TZ);

    expect(entries[0]).toMatchObject({ category: "video", delta: 0, pending: false });
    expect(entries[0].detail).toBe("Held, then refunded in full");
  });

  it("keeps top-ups positive and never merges rows that have no refId", () => {
    const rows: SpendLedgerRow[] = [
      row({ id: "g2", kind: "GRANT", source: "PURCHASE", balanceDelta: 1000, createdAt: new Date("2026-07-30T12:00:00.000Z") }),
      row({ id: "g1", kind: "GRANT", source: "PURCHASE", balanceDelta: 500, createdAt: new Date("2026-07-30T11:00:00.000Z") }),
    ];

    const entries = buildSpendHistory(rows, new Map(), TZ);

    expect(entries.map((e) => e.id)).toEqual(["g2", "g1"]);
    expect(entries[0]).toMatchObject({ category: "topup", label: "Top-up", delta: 100 });
    expect(entries[1].delta).toBe(50);
  });

  it("preserves newest-first order across tasks", () => {
    const rows: SpendLedgerRow[] = [
      row({ id: "b", kind: "RESERVE", refId: "otto-stream:m3", balanceDelta: -120, reservedDelta: 120, createdAt: new Date("2026-07-30T13:25:00.000Z") }),
      row({ id: "a", kind: "RESERVE", refId: "job1", balanceDelta: -10, reservedDelta: 10, createdAt: new Date("2026-07-30T13:18:30.000Z") }),
    ];

    const entries = buildSpendHistory(rows, new Map([["job1", "IMAGE"]]), TZ);

    expect(entries.map((e) => e.category)).toEqual(["chat", "image"]);
  });

  it("renders the merchant's own timezone, locale-fixed (hydration-safe)", () => {
    const rows: SpendLedgerRow[] = [
      row({ id: "r1", kind: "RESERVE", refId: "otto-stream:m1", balanceDelta: -120, reservedDelta: 120, createdAt: new Date("2026-07-30T21:05:00.000Z") }),
    ];

    expect(buildSpendHistory(rows, new Map(), "Asia/Kuala_Lumpur")[0].atLabel).toBe("Jul 31, 5:05 AM");
    expect(buildSpendHistory(rows, new Map(), "UTC")[0].atLabel).toBe("Jul 30, 9:05 PM");
  });
});

describe("Billing spend history section", () => {
  const entries = buildSpendHistory(
    [
      row({ id: "s1", kind: "SETTLE", refId: "otto-stream:m1", balanceDelta: 87, reservedDelta: -120, createdAt: new Date("2026-07-30T13:15:20.000Z") }),
      row({ id: "r1", kind: "RESERVE", refId: "otto-stream:m1", balanceDelta: -120, reservedDelta: 120, createdAt: new Date("2026-07-30T13:15:07.000Z") }),
      row({ id: "g1", kind: "GRANT", source: "PURCHASE", balanceDelta: 1000, createdAt: new Date("2026-07-30T12:00:00.000Z") }),
    ],
    new Map(),
    TZ,
  );
  const fullWindow = { taskLimit: 50, returned: entries.length, hasMore: false };

  it("lists each charge with its category, amount, and time", () => {
    const markup = renderToStaticMarkup(createElement(SpendHistory, { entries, window: fullWindow }));

    expect(markup).toContain("Spend history");
    expect(markup).toContain("Chat");
    expect(markup).toContain("Top-up");
    expect(markup).toContain("-3.3");
    expect(markup).toContain("+100");
    expect(markup).toContain("Jul 30");
  });

  it("says the history is empty instead of rendering a blank panel", () => {
    const markup = renderToStaticMarkup(createElement(SpendHistory, {
      entries: [],
      window: { taskLimit: 50, returned: 0, hasMore: false },
    }));

    expect(markup).toContain("Spend history");
    expect(markup).toMatch(/No credit activity yet/i);
    // An empty workspace must not be told "All 0 credit charges".
    expect(markup).not.toMatch(/All 0/);
  });
});

// Round-1 review P1①: this PR exists because the product said one thing and did another.
// The list is a 50-task window, so the page has to name its own cut.
describe("the spend-history window is described honestly", () => {
  // One settled charge and one top-up: the count called "charges" must be 1, not 2 (#684).
  const mixed = buildSpendHistory(
    [
      row({ id: "s1", kind: "SETTLE", refId: "otto-stream:m1", balanceDelta: 87, reservedDelta: -120, createdAt: new Date("2026-07-30T13:15:20.000Z") }),
      row({ id: "r1", kind: "RESERVE", refId: "otto-stream:m1", balanceDelta: -120, reservedDelta: 120, createdAt: new Date("2026-07-30T13:15:07.000Z") }),
      row({ id: "g1", kind: "GRANT", source: "PURCHASE", balanceDelta: 1000, createdAt: new Date("2026-07-30T12:00:00.000Z") }),
    ],
    new Map(),
    TZ,
  );

  it("admits the truncation when older activity exists", () => {
    const summary = windowSummary({ taskLimit: 50, returned: 50, hasMore: true }, mixed);

    expect(summary).toContain("Showing your last 50 credit entries");
    expect(summary).toMatch(/older activity isn’t listed here yet/i);
    expect(summary).not.toMatch(/\ball\b/i);
  });

  it("claims completeness only when the window really holds everything", () => {
    expect(windowSummary({ taskLimit: 50, returned: 12, hasMore: false }, mixed)).toBe(
      "All 12 credit entries on this workspace, newest first. 1 of them is a charge.",
    );
    expect(windowSummary({ taskLimit: 50, returned: 1, hasMore: false }, [mixed[1]])).toBe(
      "Your 1 credit entry so far. No charges yet.",
    );
  });

  it("renders the truncation notice on the page, not just in the helper", () => {
    const markup = renderToStaticMarkup(createElement(SpendHistory, {
      entries: buildSpendHistory(
        [row({ id: "r1", kind: "RESERVE", refId: "otto-stream:m1", balanceDelta: -120, reservedDelta: 120 })],
        new Map(),
        TZ,
      ),
      window: { taskLimit: 50, returned: 50, hasMore: true },
    }));

    expect(markup).toContain("Showing your last 50 credit entries");
  });
});

describe("honest conversation-spend copy", () => {
  // Founder 的第二次裁决(2026-08-18)把对话放回按用量收费。这句话经过三个版本:
  // 「a little credit」(假的)→「is free」(只真了半天)→ 现在这句(按用量,成本 +5%)。
  it("no longer calls a chat turn 'a little credit', names the usage basis, and points at Billing", () => {
    expect(CHAT_SPEND_NOTE).not.toMatch(/a little/i);
    expect(CHAT_SPEND_NOTE).toMatch(/what it uses/i);
    expect(CHAT_SPEND_NOTE).toMatch(/credits/i);
    expect(CHAT_SPEND_NOTE).toMatch(/Billing/);
    // 免费那半天的说法不许留下 —— 它现在是假的。
    expect(CHAT_SPEND_NOTE).not.toMatch(/\bis free\b/i);
  });

  it("does not promise a complete record the window cannot deliver (round-1 P1①)", () => {
    expect(CHAT_SPEND_NOTE).not.toMatch(/every charge/i);
  });

  // The read side is untouched on purpose: turns charged BEFORE the ruling are real history and
  // must keep rendering as the charges they were.
  it("still reads historical Chat charges out of the ledger honestly", () => {
    const entries = buildSpendHistory(
      [
        row({ id: "s1", kind: "SETTLE", refId: "otto-stream:m1", balanceDelta: 87, reservedDelta: -120, createdAt: new Date("2026-07-30T13:15:20.000Z") }),
        row({ id: "r1", kind: "RESERVE", refId: "otto-stream:m1", balanceDelta: -120, reservedDelta: 120 }),
      ],
      new Map(),
      TZ,
    );
    expect(entries[0]).toMatchObject({ category: "chat", label: "Chat", delta: -3.3 });
  });
});
