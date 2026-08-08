// @vitest-environment jsdom
/**
 * project-campaign-vocabulary.test.ts — #546 (E2E-S0 F-04/F-06): the Otto rail's primary
 * creation entry used to say "New campaign" while what it built was a **Project** row —
 * so /campaign (which lists real Campaign rows only, see lib/campaign-view-data.ts
 * listCampaigns → prisma.campaign.findMany) truthfully said "No campaigns yet" and the
 * merchant's just-done work looked like it never happened.
 *
 * Vocabulary authority: docs/BLUEPRINT.md:191 (Campaign is an independent object, a
 * Project is never a campaign) and CONTEXT.md (Project _Avoid:_ Campaign; Project Brief
 * is the per-project brief — brand-constant facts live in Brand memory).
 *
 * These tests render the REAL OttoNav and REAL QuickBrief (jsdom, the harness shape
 * established by otto-new-conversation-routing.test.ts) and pin the cured vocabulary:
 *  - the rail's creation entry is "New project" and calls the onNewProject contract;
 *  - the per-project brief entry is "Project brief" and points store-level facts to
 *    Brand memory.
 * RED on the pre-#546 code (button said "New campaign", brief said "Set up brand brief").
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { setCoworkBriefMock, getCoworkBriefMock } = vi.hoisted(() => ({
  setCoworkBriefMock: vi.fn(),
  // #791-1: QuickBrief reads the stored brief when it opens (so a save can't silently
  // replace it). This file asserts vocabulary, so the read just resolves empty.
  getCoworkBriefMock: vi.fn(async () => ({ brief: "" })),
}));
vi.mock("@/lib/cowork-actions", () => ({
  setCoworkBrief: setCoworkBriefMock,
  getCoworkBrief: getCoworkBriefMock,
}));

import { OttoNav } from "@/components/otto/OttoNav";
import { OttoOnboarding } from "@/components/otto/OttoOnboarding";
import { QuickBrief } from "@/components/otto/QuickBrief";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function navProps(over: Record<string, unknown> = {}) {
  return {
    view: "otto" as const,
    onViewChange: vi.fn(),
    projects: [{ id: "p1", name: "Raya push", pinnedAt: null }],
    activeProjectId: "p1",
    sidebarThreads: [],
    activeThreadId: null,
    onSelectThread: vi.fn(),
    onSwitchProject: vi.fn(),
    onNewChat: vi.fn(),
    onRenameProject: vi.fn(),
    onSetProjectPinned: vi.fn(),
    onDeleteProject: vi.fn(),
    onNewProject: vi.fn(async () => true),
    onRenameThread: vi.fn(),
    onSetThreadPinned: vi.fn(),
    onDeleteThread: vi.fn(),
    ...over,
  };
}

describe("#546 F-04 — the rail's creation entry says what it builds (a Project)", () => {
  it("labels the primary creation action 'New project', never 'New campaign'", async () => {
    const dom = await render(createElement(OttoNav, navProps() as never));

    const buttons = Array.from(dom.querySelectorAll("button"));
    const creation = buttons.find((b) => /^New /.test(b.textContent?.trim() ?? ""));
    expect(creation, "the rail must keep a primary creation action").toBeTruthy();
    // The entry creates a Project row (OttoApp → createProject). Claiming "campaign"
    // here is the exact lie #546 documents: /campaign lists Campaign rows only, so the
    // merchant's new work could never show up there.
    expect(creation!.textContent!.trim()).toBe("New project");
    expect(dom.textContent).not.toContain("New campaign");
  });

  it("wires that entry to the onNewProject contract", async () => {
    const onNewProject = vi.fn(async () => true);
    const dom = await render(createElement(OttoNav, navProps({ onNewProject }) as never));

    const creation = Array.from(dom.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "New project",
    );
    expect(creation).toBeTruthy();
    await click(creation!);
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });
});

describe("#546 F-06 — the per-project brief is a Project brief, not a brand brief", () => {
  it("labels the intake toggle 'Project brief' and points store-level facts to Brand memory", async () => {
    const dom = await render(createElement(QuickBrief, { projectId: "p1" }));

    const toggle = Array.from(dom.querySelectorAll("button")).find((b) =>
      /brief/i.test(b.textContent ?? ""),
    );
    expect(toggle, "the brief toggle must exist").toBeTruthy();
    // "Set up brand brief" was the 2026-07 UI drift: it stored Project.coworkBrief
    // (per-project, gone when you switch projects) while sounding like the org-level
    // Brand memory. The vocabulary name is "Project brief".
    expect(toggle!.textContent).toContain("Project brief");
    expect(toggle!.textContent).not.toMatch(/brand brief/i);

    // Open it: the form must carry the one-line pointer that brand-constant facts
    // live in Brand memory (so merchants stop typing their shop identity in here).
    await click(toggle!);
    expect(dom.textContent).toContain("Brand memory");
  });

  it("keeps the original four-field brief capability while scoping every prompt to this Project", async () => {
    setCoworkBriefMock.mockResolvedValue({ ok: true });
    const dom = await render(createElement(QuickBrief, { projectId: "p1" }));
    const toggle = Array.from(dom.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Project brief"),
    );
    await click(toggle!);

    const offer = dom.querySelector<HTMLInputElement>("#qb-offer");
    const audience = dom.querySelector<HTMLInputElement>("#qb-audience");
    const platform = dom.querySelector<HTMLInputElement>("#qb-platform");
    const budget = dom.querySelector<HTMLInputElement>("#qb-budget");
    expect(offer).toBeTruthy();
    expect(audience).toBeTruthy();
    expect(platform).toBeTruthy();
    expect(budget).toBeTruthy();
    expect(dom.textContent).toContain("Offer for this project");
    expect(dom.textContent).toContain("Audience for this project");
    expect(dom.textContent).toContain("Where this project will run");
    expect(dom.textContent).toContain("Budget for this project");
    expect(dom.textContent).not.toContain("What you sell / offer");

    await typeInto(offer!, "The summer collection");
    await typeInto(audience!, "First-time home buyers");
    await typeInto(platform!, "TikTok");
    await typeInto(budget!, "$500/month");
    await submit(dom.querySelector("form")!);

    expect(setCoworkBriefMock).toHaveBeenCalledWith({
      projectId: "p1",
      brief:
        "We offer: The summer collection. Audience: First-time home buyers. " +
        "Posts on: TikTok. Budget vibe: $500/month",
    });
  });
});

describe("#546 — the rest of the Otto surface stops calling a Project a campaign", () => {
  it("the getting-started card counts down to the merchant's first project", async () => {
    // Same drift, same surface: a brand-new merchant reads this card next to a button
    // that now says "New project". Promising a "first campaign" here would send them
    // hunting on /campaign for work Otto filed as a Project.
    const dom = await render(
      createElement(OttoOnboarding, {
        hasStuff: false,
        hasBrandMemory: false,
        onGoToStuff: vi.fn(),
        onGoToMemory: vi.fn(),
        onDismiss: vi.fn(),
      }),
    );

    expect(dom.textContent).toContain("Two quick things before your first project");
    expect(dom.textContent).toMatch(/consistent across every project/);
    expect(dom.textContent).not.toMatch(/campaign/i);
  });
});
