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

  it("starts every min-h-dvh page container at px-4 and widens with a breakpoint", () => {
    const offenders: string[] = [];

    for (const file of [...walk(path.join(WEB_ROOT, "app")), ...walk(path.join(WEB_ROOT, "components"))]) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(CONTAINER)) {
        const classes = match[1];
        const base = classes.match(/(?:^|\s)px-(\S+)/)?.[1];
        if (base !== "4") offenders.push(`${path.relative(WEB_ROOT, file)}: px-${base}`);
      }
    }

    expect(offenders).toEqual([]);
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
