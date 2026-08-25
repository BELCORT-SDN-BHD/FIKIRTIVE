import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/owner-settings-actions", () => ({ setOwnerSetting: vi.fn() }));
vi.mock("@/lib/meta-actions", () => ({ disconnectMeta: vi.fn() }));
vi.mock("@/lib/canvas-actions", () => ({ listCanvasNodes: vi.fn() }));
vi.mock("@/components/canvas/useCanvasGen", () => ({
  freshCanvasActionId: vi.fn(() => "test-action"),
  useCanvasGen: () => ({
    generateImage: vi.fn(),
    quoteCosts: vi.fn(),
    imageShapes: vi.fn(),
  }),
}));

import { R22CanvasSurface } from "@/components/canvas/R22CanvasSurface";
import { R22OttoIQView } from "@/components/otto-iq/R22OttoIQView";
import { R22RoutinesView, type R22RoutineRow } from "@/components/routines/R22RoutinesView";
import { R22SettingsShell } from "@/components/settings/R22SettingsShell";

describe("R22 truthful-state UI contracts", () => {
  it("does not present a live Canvas as saved or ready before reads finish", () => {
    const html = renderToStaticMarkup(createElement(R22CanvasSurface, {
      runtimeContext: {
        projects: [{ id: "project-1", name: "Launch" }],
        threads: [],
        activeProjectId: "project-1",
        activeThreadId: null,
        initialBalance: null,
        initialPrompt: "",
        visualFixture: null,
      },
      entities: [],
    }));

    expect(html).toContain("Loading project…");
    expect(html).toContain("checking");
    expect(html).toContain("Loading canvas…");
    expect(html).not.toContain("Saved just now");
    expect(html).not.toContain("Prototype · sample data");
    expect(html).not.toContain(">ready<");
  });

  it("does not render an unreadable Settings ledger as an empty ledger or zero balance", () => {
    const html = renderToStaticMarkup(createElement(R22SettingsShell, {
      initialSection: "billing",
      data: {
        workspaceName: "Workspace name unavailable",
        displayName: "",
        email: "owner@example.test",
        balance: null,
        recent: [],
        accountReadable: false,
        spendCapCredits: null,
        channels: [],
        timezone: "Timezone could not be read",
        dataError: "account",
      },
    }));

    expect(html).toContain("Could not load");
    expect(html).toContain("Credit activity could not be loaded. Nothing is guessed in its place.");
    expect(html).not.toContain("No credit activity is available.");
    expect(html).not.toContain("0 cr available");
    expect(html).not.toContain(">Top up<");
  });

  it("does not turn a Routines read error into an empty-success state", () => {
    const html = renderToStaticMarkup(createElement(R22RoutinesView, {
      routines: [],
      readError: "workflow service unavailable",
    }));

    expect(html).toContain("Routines could not be loaded: workflow service unavailable. Nothing is guessed in its place.");
    expect(html).not.toContain("No routine yet");
  });

  it("labels unknown Routine money and publish state without inventing zero or weekly usage", () => {
    const row: R22RoutineRow = {
      id: "routine-1",
      name: "weekday-mornings",
      cadence: null,
      postsPerWeek: null,
      topic: "Market posts",
      channel: "1 authorised channel",
      creditsUsed: null,
      creditsCap: 120,
      creditPeriod: "monthly",
      status: "draft",
      autoPublish: null,
      warning: null,
      policy: null,
      slots: [],
    };
    const html = renderToStaticMarkup(createElement(R22RoutinesView, { routines: [row] }));

    expect(html).toContain("Monthly credits");
    expect(html).toContain("Usage unavailable · 120 cr cap");
    expect(html).toContain("Nothing is guessed here");
    expect(html).toContain("Auto-publish unknown");
    expect(html).not.toContain("0 of 120 cr");
    expect(html).not.toContain("Weekly credits");
    expect(html).not.toContain("Auto-publish off");
  });

  it("does not expose Settings values when the fixture read outcome is unknown", () => {
    const html = renderToStaticMarkup(createElement(R22SettingsShell, {
      fixture: true,
      fixtureState: "unknown",
      initialSection: "workspace",
      data: {
        workspaceName: "Protected Workspace",
        displayName: "Protected Founder",
        email: "protected@example.test",
        balance: 1240,
        recent: [],
        accountReadable: true,
        spendCapCredits: 40,
        channels: [],
        timezone: "Asia/Kuala_Lumpur",
      },
    }));

    expect(html).toContain("This settings read outcome is unknown");
    expect(html).not.toContain("Manage the identity and defaults for Protected Workspace");
    expect(html).not.toContain("1,240");
  });

  it("does not turn unknown Routines and Otto IQ reads into empty hubs", () => {
    const routines = renderToStaticMarkup(createElement(R22RoutinesView, { routines: [], fixture: true, fixtureState: "unknown" }));
    expect(routines).toContain("Routine read outcome is unknown");
    expect(routines).not.toContain("No routine yet");
    expect(routines).not.toContain("Weekday market stories");

    const iq = renderToStaticMarkup(createElement(R22OttoIQView, {
      fixture: true,
      fixtureState: "unknown",
      initialMemory: [{ id: "protected", category: "brand_voice", content: "Protected voice", source: "user", pinned: true, updatedAt: new Date("2026-08-25T08:42:00.000Z") }],
    }));
    expect(iq).toContain("Otto IQ read outcome is unknown");
    expect(iq).not.toContain("Protected voice");
    expect(iq).not.toContain("Start here");
  });

  it("does not infer an empty Canvas board from an unknown project read", () => {
    const html = renderToStaticMarkup(createElement(R22CanvasSurface, {
      runtimeContext: {
        projects: [{ id: "fixture-raya", name: "Raya launch" }],
        threads: [],
        activeProjectId: "fixture-raya",
        activeThreadId: null,
        initialBalance: 250,
        initialPrompt: "",
        visualFixture: "r22",
        fixtureRouteState: "unknown",
      },
      entities: [],
    }));

    // 「读不出」仍然说成读不出,只是不再用「read outcome」「empty state was inferred」这种
    // UI 工程师词汇说 —— 商家读不懂(判官 2026-08-25 [P2-2])。
    expect(html).toContain("Otto could not confirm whether this project opened");
    expect(html).toContain("this is not an empty project");
    expect(html).toContain("unavailable");
    expect(html).not.toContain("Fixture board ready");
  });

  // 判官 2026-08-25 [P2-2] 续篇:「No X was inferred」词族全仓归人,这条测试原本钉的旧句
  // 已经全部换成人话寄存器("Nothing is guessed in its place." / "Nothing is guessed while
  // this loads." / "Nothing is guessed here.")。负向断言防这个词悄悄回流到这几面的商家文案。
  it("never lets the literal word 'inferred' back into these surfaces' merchant-visible copy", () => {
    const settings = renderToStaticMarkup(createElement(R22SettingsShell, {
      initialSection: "billing",
      data: {
        workspaceName: "Workspace name unavailable",
        displayName: "",
        email: "owner@example.test",
        balance: null,
        recent: [],
        accountReadable: false,
        spendCapCredits: null,
        channels: [],
        timezone: "Timezone could not be read",
        dataError: "account",
      },
    }));

    const routinesError = renderToStaticMarkup(createElement(R22RoutinesView, {
      routines: [],
      readError: "workflow service unavailable",
    }));

    const routinesUsage = renderToStaticMarkup(createElement(R22RoutinesView, {
      routines: [{
        id: "routine-1",
        name: "weekday-mornings",
        cadence: null,
        postsPerWeek: null,
        topic: "Market posts",
        channel: "1 authorised channel",
        creditsUsed: null,
        creditsCap: 120,
        creditPeriod: "monthly",
        status: "draft",
        autoPublish: null,
        warning: null,
        policy: null,
        slots: [],
      }],
    }));

    const canvasUnknown = renderToStaticMarkup(createElement(R22CanvasSurface, {
      runtimeContext: {
        projects: [{ id: "fixture-raya", name: "Raya launch" }],
        threads: [],
        activeProjectId: "fixture-raya",
        activeThreadId: null,
        initialBalance: 250,
        initialPrompt: "",
        visualFixture: "r22",
        fixtureRouteState: "unknown",
      },
      entities: [],
    }));

    const iq = renderToStaticMarkup(createElement(R22OttoIQView, {
      fixture: true,
      fixtureState: "unknown",
      initialMemory: [],
    }));

    for (const html of [settings, routinesError, routinesUsage, canvasUnknown, iq]) {
      expect(html.toLowerCase()).not.toContain("inferred");
    }
  });
});
