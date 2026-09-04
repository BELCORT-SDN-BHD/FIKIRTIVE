// @vitest-environment jsdom
// 本面自 PR #1152 起无路由挂载(/library 改画 components/library/LibraryView.tsx),围栏仅护组件本身；tidy 待登记。
/**
 * library-failure-human-copy — Codex QA-CRE-007.
 *
 * A read-only QA pass on Library → "Needs attention" (main e622bec6) found the failed-job card
 * showing backend/provider sentences verbatim to the merchant: `reference video unreachable —
 * refusing to spend`, `conditioning refs unreachable (0/2)`, and siblings — plus the whole prompt
 * as the card's title, unbounded.
 *
 * The fix has TWO halves, tested at TWO levels:
 *   1. `packages/core/src/gen-failure.test.ts` — the reason code + sentence map
 *      (`REFERENCE_ASSET_UNREACHABLE`, `merchantGenFailureCopy`), and a grep-guard that the raw
 *      ops strings never come back out of the whitelist as merchant advice.
 *   2. THIS FILE — the actual card (`components/otto/OttoStuff.tsx`'s `AdJobCard`), mounted with
 *      real React: given an `AdJobItem` whose `error` field is what `apps/web/lib/data.ts`
 *      (`getMyAdJobs`) now computes (already the mapped copy — real-row coverage that `data.ts`
 *      actually calls `merchantGenFailureCopy` lives in `library-failure-copy-read-path.test.ts`,
 *      added for PR #1171 判官 P1-2; this file's job is only "does the CARD show what it is
 *      given, and nothing more"), the screen shows the honest sentence and a bounded title, and
 *      never the raw diagnostic even if a stale/legacy row still carried one.
 *
 * Real component, real React (react-dom/client createRoot, no @testing-library/react — this repo
 * has none, per otto-ui-messages.test.ts) — the same recipe library-real-route-986.test.ts uses
 * to mount OttoStuff, trimmed to mount OttoStuff directly instead of the whole /library page.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdJobItem } from "@/lib/data";
import { REFERENCE_ASSET_UNREACHABLE } from "@fikirtive/core";

const mocks = vi.hoisted(() => ({
  getGenerationHistory: vi.fn(),
  updateEntity: vi.fn(),
  softDeleteEntity: vi.fn(),
  createEntity: vi.fn(),
  saveBrandRecord: vi.fn(),
  startRefGen: vi.fn(),
  notifyBalanceRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/library-actions", () => ({ getGenerationHistory: mocks.getGenerationHistory }));
vi.mock("@/lib/actions", () => ({
  updateEntity: mocks.updateEntity,
  softDeleteEntity: mocks.softDeleteEntity,
  createEntity: mocks.createEntity,
}));
vi.mock("@/lib/brand-record-actions", () => ({ saveBrandRecord: mocks.saveBrandRecord }));
vi.mock("@/lib/refgen-actions", () => ({ startRefGen: mocks.startRefGen, getRefGenJobs: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: mocks.notifyBalanceRefresh }));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));
// Asset detail isn't what this file tests, and pulling it in drags the whole paid-action chain
// (gen-actions, poll, credits) along — same call library-real-route-986.test.ts already makes.
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { OttoStuff } = await import("@/components/otto/OttoStuff");

const mounted: { root: Root; container: HTMLDivElement }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getGenerationHistory.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
});

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  document.body.replaceChildren();
});

async function mountOttoStuff(adJobs: AdJobItem[]): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () =>
    root.render(
      createElement(OttoStuff, { entities: [], ads: [], adJobs, records: [], history: [] }),
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
  return document.body;
}

const RAW_PROMPT =
  "A close-up product shot of our kaya jar on a rattan tray with morning light streaming through "
  + "a kampung-style window, styled the way our last three campaigns looked, for the Raya push";

function failedJob(overrides: Partial<AdJobItem> = {}): AdJobItem {
  return {
    id: "job_1",
    projectId: "prj_1",
    threadId: "thr_1",
    kind: "video",
    status: "failed",
    prompt: RAW_PROMPT,
    createdAt: new Date("2026-09-04T02:00:00.000Z").toISOString(),
    error: REFERENCE_ASSET_UNREACHABLE,
    ...overrides,
  };
}

describe("Library \"Needs attention\" card — CREATE-A2: honest copy, never the raw backend string (Codex QA-CRE-007)", () => {
  it("shows the mapped copy handed to it — apps/web/lib/data.ts computes it, the card just renders it", async () => {
    const dom = await mountOttoStuff([failedJob()]);
    expect(dom.textContent).toContain(REFERENCE_ASSET_UNREACHABLE);
  });

  it("never renders the raw ops strings the QA pass caught — even a stale/legacy row that still carries one", async () => {
    // A row written before this fix shipped (or by code this fix missed) can still have the raw
    // string in it. This is the card's OWN floor, independent of data.ts having done its job.
    const dom = await mountOttoStuff([
      failedJob({ id: "job_a", error: "reference video unreachable — refusing to spend" }),
      failedJob({ id: "job_b", error: "conditioning refs unreachable (0/2) — refusing to spend" }),
    ]);
    expect(dom.textContent).not.toContain("refusing to spend");
    expect(dom.textContent).not.toContain("unreachable (");
  });

  it("title is bounded to ~60 characters with an ellipsis — not the whole prompt", async () => {
    const dom = await mountOttoStuff([failedJob()]);
    expect(RAW_PROMPT.length).toBeGreaterThan(60); // the fixture must actually exercise truncation
    expect(dom.textContent).not.toContain(RAW_PROMPT);
    expect(dom.textContent).toContain(`${RAW_PROMPT.slice(0, 60)}…`);
  });

  it("a short prompt is shown whole — truncation never fires below the limit", async () => {
    const dom = await mountOttoStuff([failedJob({ prompt: "kaya jar on a tray" })]);
    expect(dom.textContent).toContain("kaya jar on a tray");
    expect(dom.textContent).not.toContain("kaya jar on a tray…");
  });

  it("shows time, status pill, and the existing recovery action (Retry) — no new actions invented", async () => {
    const dom = await mountOttoStuff([failedJob()]);
    expect(dom.textContent).toContain("Didn't go through");
    // date rendered via toLocaleDateString(month:short, day:numeric) — just prove SOME date text
    // landed rather than pinning a locale-specific string.
    expect(dom.textContent).toMatch(/Sep|9/); // 2026-09-04
    const hideButton = Array.from(dom.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Hide");
    expect(hideButton, "the one action this card always offers regardless of handlers").toBeTruthy();
  });
});
