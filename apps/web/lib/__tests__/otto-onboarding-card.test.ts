// @vitest-environment jsdom
/**
 * #679 — the card itself, rendered.
 *
 * Two things it used to get wrong, both visible without a database:
 *  1. it decided its own fate from `localStorage["otto:onboarded"]`, which is one browser, not
 *     one merchant — so the dismissal could never travel with the account;
 *  2. it never looked at whether either task was actually done, so a merchant who really did
 *     teach Otto their brand was still told they had two things left.
 *
 * RED on the pre-#679 component: it read localStorage on mount, wrote it on dismiss, and had
 * no notion of a finished task at all.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OttoOnboarding } from "@/components/otto/OttoOnboarding";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
  vi.restoreAllMocks();
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

function cardProps(over: Record<string, unknown> = {}) {
  return {
    hasStuff: false,
    hasBrandMemory: false,
    onGoToStuff: vi.fn(),
    onGoToMemory: vi.fn(),
    onDismiss: vi.fn(),
    ...over,
  };
}

describe("#679 — the card reports what the shop has actually done", () => {
  it("a brand-new shop is told both things are still to do", async () => {
    const dom = await render(createElement(OttoOnboarding, cardProps() as never));
    expect(dom.textContent).toContain("Two quick things before your first project");
    expect(dom.textContent).not.toContain("Done");
  });

  it("teaching Otto the brand ticks that row off, and the count comes down", async () => {
    const dom = await render(createElement(OttoOnboarding, cardProps({ hasBrandMemory: true }) as never));
    expect(dom.textContent).toContain("One quick thing before your first project");
    const done = dom.querySelector('[aria-label="Teach Otto your brand — done"]');
    expect(done, "the finished task must say so").toBeTruthy();
    // …and the unfinished one is still asking.
    expect(dom.querySelector('[aria-label="Add a character or product"]')).toBeTruthy();
  });

  it("saving a character ticks the other row off", async () => {
    const dom = await render(createElement(OttoOnboarding, cardProps({ hasStuff: true }) as never));
    expect(dom.querySelector('[aria-label="Add a character or product — done"]')).toBeTruthy();
    expect(dom.querySelector('[aria-label="Teach Otto your brand"]')).toBeTruthy();
  });
});

describe("#679 — dismissal leaves the browser and goes to the caller", () => {
  it("closing the card calls the persist handler instead of writing localStorage", async () => {
    const onDismiss = vi.fn();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const dom = await render(createElement(OttoOnboarding, cardProps({ onDismiss }) as never));

    const close = dom.querySelector('[aria-label="Dismiss getting started"]');
    expect(close).toBeTruthy();
    await click(close!);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("otto:onboarded")).toBeNull();
  });

  it("a leftover 'otto:onboarded' key from the old build cannot hide the card", async () => {
    window.localStorage.setItem("otto:onboarded", "1");
    const dom = await render(createElement(OttoOnboarding, cardProps() as never));
    // The caller decides visibility now; the component renders what it is asked to render.
    expect(dom.textContent).toContain("Get Otto ready");
  });

  it("the component reads no client storage at all", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    await render(createElement(OttoOnboarding, cardProps() as never));
    expect(getItem).not.toHaveBeenCalled();
  });
});
