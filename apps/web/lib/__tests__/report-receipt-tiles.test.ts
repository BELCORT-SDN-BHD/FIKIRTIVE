/**
 * #731 — 广播报告的收据格子必须装得下「Unknown」这个词。
 *
 * 这三个格子恰恰是模拟工作台最诚实的地方:页面顶上明说 provider 收据没接通、结果保持
 * Unknown。而格子是按数字排版的(固定三列 + 整行 `tabular-nums`),1280px 下 Delivered
 * 格子 clientWidth 85 / scrollWidth 104,词溢出自己的边框 19px、压到右边格子上,读起来
 * 成了 `Unknow` `n Unknow` `n Unknown`。今天每个工作区都是模拟状态,所以每一个点进报告
 * 的商家都会撞上。
 *
 * jsdom 不做排版,所以像素在这里证明不了。真实浏览器量测(Chromium 1280×720,同一份
 * markup + 同一份编译出的 Tailwind CSS)记在 PR 正文里。这个文件守的是根因的形状:
 * 轨道按内容宽度定(auto-fit + minmax),不按列数;`tabular-nums` 只贴在数字上;值那一行
 * 会换行、图标不收缩 —— 任何宽度都挤不出边框。
 *
 * Red on main(修复前):三处 grid 是写死的列数,`tabular-nums` 在整行 <dd> 上,
 * 值那一行既不 wrap 图标也不 shrink-0。
 */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import ReportAxisGroups, { type BroadcastReportResource } from "@/components/crm/reports/report-axis-groups";

const WEB_ROOT = path.resolve(__dirname, "../..");
const SOURCE = fs.readFileSync(
  path.join(WEB_ROOT, "components/crm/reports/report-axis-groups.tsx"),
  "utf8",
);

/** The shape every workspace is in today: sending is known, provider receipts are not. */
function simulatedReport(): BroadcastReportResource {
  const known = (value: number) => ({ status: "known" as const, value });
  return {
    broadcastRunId: "run-731",
    contactId: null,
    simulatedEra: true,
    sending: {
      authority: "C5_BROADCAST_AUDIENCE_MEMBER",
      freshness: { lastDataLoadedAt: "2026-08-08T00:00:00.000Z" },
      attempted: known(1240),
      pending: known(0),
      skipped: { ...known(3), byReason: { do_not_disturb: 3 } },
      unavailable: known(0),
    },
    delivery: {
      authority: "C6_MESSAGE_DELIVERY_STATE",
      freshness: { lastProviderEventAt: null, lastDataLoadedAt: "2026-08-08T00:00:00.000Z" },
      delivered: { status: "unknown", value: null },
      read: { status: "unknown", value: null },
      failed: { status: "unknown", value: null },
    },
    reconciliation: {
      authority: "C6_RECONCILIATION",
      freshness: { lastReconciledAt: null, lastDataLoadedAt: "2026-08-08T00:00:00.000Z" },
      pending: known(0),
      conflict: known(0),
      timeoutUnknown: known(0),
    },
    replyRate: { status: "deferred", value: null },
  };
}

function render(): Document {
  const markup = renderToStaticMarkup(
    createElement(ReportAxisGroups, { report: simulatedReport(), showSkipReasons: true }),
  );
  return new JSDOM(`<!doctype html><body>${markup}</body>`).window.document;
}

/** The three receipt tiles, in the order the merchant reads them. */
function providerReceiptTiles(document: Document): Element[] {
  const section = document.querySelector('[aria-labelledby="delivery-run-731"]');
  expect(section, "provider receipts section").not.toBeNull();
  return [...section!.querySelectorAll("dl > div")];
}

describe("#731 — the provider receipt tiles hold the whole word", () => {
  it("says Unknown in full in all three tiles", () => {
    const tiles = providerReceiptTiles(render());
    expect(tiles).toHaveLength(3);
    expect(tiles.map((tile) => tile.querySelector("dt")?.textContent)).toEqual([
      "Delivered",
      "Read",
      "Failed",
    ]);
    for (const tile of tiles) {
      // No truncation, no ellipsis, no clipped remainder — the whole word or nothing.
      expect(tile.querySelector("dd")?.textContent).toBe("Unknown");
      expect(tile.querySelector("dd")?.className ?? "").not.toMatch(/\b(truncate|overflow-hidden)\b/);
    }
  });

  it("keeps the digit-alignment feature on digits only", () => {
    const document = render();
    // Sending attempts is the axis that really does show numbers.
    const sending = document.querySelector('[aria-labelledby="sending-run-731"]');
    expect(sending!.querySelector("dd > span.tabular-nums")?.textContent).toBe("1,240");
    // The word never gets sized by a numeric font feature.
    for (const tile of providerReceiptTiles(document)) {
      expect(tile.querySelector("dd")?.className ?? "").not.toContain("tabular-nums");
      expect(tile.querySelector("dd > span.tabular-nums")).toBeNull();
    }
  });

  it("lets the value wrap instead of running out of the tile", () => {
    for (const tile of providerReceiptTiles(render())) {
      const value = tile.querySelector("dd")!;
      expect(value.className).toContain("flex-wrap");
      expect(value.className).toContain("min-w-0");
      // The icon must not be the thing that gives way when the row is tight.
      expect(value.querySelector("svg")?.getAttribute("class") ?? "").toContain("shrink-0");
    }
  });

  it("sizes the tracks by content, not by a column count", () => {
    // One shared grid for all three axes: tracks are `auto-fit` + a minimum wide enough for
    // the widest value, so a narrow card drops a column instead of overflowing one.
    expect(SOURCE).toContain("grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]");

    const grids = [...render().querySelectorAll("dl")];
    expect(grids).toHaveLength(3);
    for (const grid of grids) {
      expect(grid.className).toContain("grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]");
      // The fixed counts that produced the 85px tile are gone. (The three axis CARDS still
      // sit in a `lg:grid-cols-3` row — that one is not a metric grid and is left alone.)
      expect(grid.className).not.toMatch(/(^|\s|:)grid-cols-\d/);
    }
  });
});
