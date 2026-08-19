import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card } from "@/components/ui/card";

/**
 * 375px 移动端布局族(#685 / #722 / #697 / #730)的机器围栏。
 *
 * 真实浏览器断言在 scripts/tools/mobile-viewport-check.mjs(要跑起 dev server)。
 * 这里只守 CI 能守的那一半:每一类的根因形状,不是逐个页面的像素。
 */

const WEB_ROOT = path.resolve(__dirname, "../..");

function source(relativeToWebRoot: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, relativeToWebRoot), "utf8");
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

// #722 — the workflows pages were the only CRM surfaces whose page container jumped
// straight to a desktop inset (px-8), with no mobile step. At 375px that alone pushed
// the page 152px wide of the viewport and put "New workflow" — the one way to create a
// workflow — entirely off screen. Every full-page container starts mobile-first; this
// enumerates them so the next one cannot quietly skip the step.
describe("full-page containers are mobile-first", () => {
  const CONTAINER = /className="([^"]*\bmin-h-dvh\b[^"]*\bbg-background\b[^"]*\bpx-[^"]*)"/g;

  /** Every full-page container the sweep finds, keyed by repo-relative file. */
  function sweepContainers(): { offenders: string[]; perFile: Map<string, number>; total: number } {
    const offenders: string[] = [];
    const perFile = new Map<string, number>();
    let total = 0;

    for (const file of [...walk(path.join(WEB_ROOT, "app")), ...walk(path.join(WEB_ROOT, "components"))]) {
      const relative = path.relative(WEB_ROOT, file);
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(CONTAINER)) {
        total += 1;
        perFile.set(relative, (perFile.get(relative) ?? 0) + 1);
        const base = match[1].match(/(?:^|\s)px-(\S+)/)?.[1];
        if (base !== "4") offenders.push(`${relative}: px-${base}`);
      }
    }

    return { offenders, perFile, total };
  }

  it("starts every min-h-dvh page container at px-4 and widens with a breakpoint", () => {
    expect(sweepContainers().offenders).toEqual([]);
  });

  // The sweep above only proves something if it actually swept something. An empty
  // `offenders` list is equally the answer for "every container is mobile-first" and
  // for "the regex stopped matching anything" — delete the containers, rename the
  // classes, or switch them to cn()/template literals and the green above means
  // nothing. These two guard the sweep itself.
  it("still finds the whole population it is supposed to police", () => {
    // 53 containers across 36 files when this was written (#722); 46 after W2-13 (#993)
    // deleted the seven CRM `loading.tsx` skeletons, one container each. The floor keeps
    // the same 3 of headroom it always had — it exists to catch the population COLLAPSING,
    // not to pin an exact number.
    expect(sweepContainers().total).toBeGreaterThanOrEqual(43);
  });

  it("still covers the surfaces the walkthrough actually caught", () => {
    const { perFile } = sweepContainers();
    // Named on purpose: the workflows pair that #722 was filed against (plus their
    // route-level twins), the campaign five that #685 covered, and the two CRM lists
    // from #730. A rewrite that drops any of these out of the sweep goes red here
    // rather than passing quietly on an empty offenders list.
    const required: [string, number][] = [
      ["components/crm/workflows/workflow-list-page.tsx", 2],
      ["components/crm/workflows/workflow-detail-page.tsx", 2],
      // app/crm/workflows/loading.tsx 不在这份名单里了:W2-13(#993)把七个 CRM 骨架页
      // 一起删了(路由只剩 `redirect("/")`,没有内容可等)。error.tsx 还在,照扫。
      ["app/crm/workflows/error.tsx", 1],
      ["components/campaign/campaign-list-page.tsx", 1],
      ["components/campaign/campaign-detail-page.tsx", 2],
      // campaign-calendar-page.tsx 不在这份名单里了:#801「两个日历择一为准」把它整页
      // 收敛成重定向(计划日期在战役自己那一页改,真日历只有 Workspace › Schedule 一本)。
      ["components/campaign/campaign-trends-page.tsx", 1],
      ["components/campaign/campaign-workbench-page.tsx", 1],
      ["components/crm/inbox/inbox-list-page.tsx", 2],
      ["components/crm/broadcasts/broadcast-list-page.tsx", 2],
    ];

    const missing = required
      .filter(([file, count]) => (perFile.get(file) ?? 0) < count)
      .map(([file, count]) => `${file}: expected >=${count}, swept ${perFile.get(file) ?? 0}`);

    expect(missing).toEqual([]);
  });

  it("gives the workflows list header a column stack before the desktop row", () => {
    const listPage = source("components/crm/workflows/workflow-list-page.tsx");

    expect(listPage).toContain("flex flex-col gap-5 border-b border-border pb-7 sm:flex-row");
    // The three-column row card only exists once there is room for three columns.
    expect(listPage).toContain("grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px_auto]");
    expect(listPage).not.toContain('className="grid grid-cols-[minmax(0,1fr)_220px_auto]');
  });

  it("lets the Routine card's action pair wrap instead of forcing a second column", () => {
    const panel = source("components/crm/workflows/routine-authorization-panel.tsx");

    expect(panel).toContain("grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]");
    expect(panel).toContain('<div className="flex flex-wrap items-start gap-2">');
  });
});

// #697 — a one-row flex whose button says `whitespace-nowrap` takes the width it wants
// and leaves the copy a two-words-per-line ribbon (the Analytics sentence rendered as
// ~11 lines at 375px). Both sites now wrap the button under the copy instead.
describe("nowrap buttons yield to the copy on a phone", () => {
  it.each([
    ["Analytics suggestion banner", "components/otto/OttoAnalytics.tsx", "Make more like it"],
    ["Schedule empty state", "components/otto/OttoSchedule.tsx", "New post"],
  ])("%s wraps its button below the copy", (_name, file, buttonLabel) => {
    const text = source(file);
    // Read backwards from the button to the row that holds it, so an unrelated
    // flex row elsewhere in the file cannot stand in for the one under test.
    const buttonAt = text.indexOf(buttonLabel);
    expect(buttonAt).toBeGreaterThan(-1);
    const row = text.slice(Math.max(0, buttonAt - 1400), buttonAt);

    expect(row).toContain("flex flex-wrap items-center gap-");
    expect(row).toContain("min-w-[220px]");
  });
});

// #730 — a card is nearly always a grid/flex item, and such an item defaults to
// `min-width: auto`: its content sets a floor it may not shrink below. A single
// `truncate` line (truncate = `white-space: nowrap`, whose min-content width is the
// whole line) then pushed the row card through its grid track and the whole page
// scrolled sideways. The floor is given up on the card itself, not per text node.
describe("list row cards stay inside their grid track", () => {
  it("gives the shared Card its own min-width floor of zero", () => {
    const markup = renderToStaticMarkup(createElement(Card, null, "row"));

    expect(markup).toContain("min-w-0");
  });

  it("also frees the Inbox row's link, which is the grid item there — not the Card", () => {
    const inbox = source("components/crm/inbox/inbox-list-page.tsx");

    expect(inbox).toContain('className="block min-w-0"');
    // A truncating name inside a flex row needs the same floor to truncate at all.
    expect(inbox).toContain('className="min-w-0 truncate text-base font-semibold"');
  });
});
