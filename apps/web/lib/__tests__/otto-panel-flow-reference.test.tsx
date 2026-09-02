// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OttoPanelFlowReference,
  useOttoPanelReference,
} from "@/components/otto/panel/OttoPanelFlowReference";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECOMMENDED_PROMPT = "Should I increase the Sales Aug 2026 campaign budget?";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function SeedPrompt() {
  const otto = useOttoPanelReference();
  return <button type="button" onClick={() => otto?.askOtto(RECOMMENDED_PROMPT)}>Seed Otto</button>;
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.getAttribute("aria-label") === label || item.textContent?.trim() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

async function click(target: HTMLElement) {
  await act(async () => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

async function fill(target: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  Object.defineProperty(window, "innerWidth", { value: 1440, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 900, writable: true, configurable: true });
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <OttoPanelFlowReference founderName="Aisyah" recommendedPrompt={RECOMMENDED_PROMPT}>
        <SeedPrompt />
      </OttoPanelFlowReference>,
    );
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Cloudflare-style Otto reference flow", () => {
  it("keeps one thread through seed, thinking, follow-up, fullscreen, and reopen", async () => {
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWrite },
      configurable: true,
    });

    expect(document.querySelector("[data-otto-reference-empty]")?.textContent).toContain("Good evening, Aisyah.");

    await click(button("Seed Otto"));
    const composer = document.querySelector<HTMLTextAreaElement>('[aria-label="Message Otto"]')!;
    expect(composer.value).toBe(RECOMMENDED_PROMPT);

    await click(button("Send message"));
    expect(document.querySelector("[data-otto-reference-thinking]")).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1400));
    expect(document.body.textContent).toContain("Increase the budget gradually");
    expect(document.body.textContent).toContain("Review required");

    await click(button("Copy answer"));
    expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining("Increase the budget gradually"));
    expect(button("Copied")).toBeTruthy();

    await click(button("Helpful"));
    await fill(composer, "What should I fix first?");
    await click(button("Send message"));
    await act(async () => vi.advanceTimersByTime(1400));
    expect(document.body.textContent).toContain("Start with the change that is easiest to measure");
    const helpful = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Helpful"]')];
    expect(helpful).toHaveLength(2);
    expect(helpful[0].getAttribute("aria-pressed")).toBe("true");
    expect(helpful[1].getAttribute("aria-pressed")).toBe("false");

    await fill(composer, "Keep this draft");
    await click(button("Open fullscreen"));
    expect(document.querySelector("[data-otto-panel]")?.getAttribute("data-otto-panel-mode")).toBe("fullscreen");
    expect(document.querySelector("[data-otto-panel-main]")?.hasAttribute("inert")).toBe(true);
    expect(document.querySelector("[data-otto-reference-conversation]")?.getAttribute("data-otto-reference-layout")).toBe("fullscreen");
    expect(document.querySelector("[data-otto-reference-prompt]")?.className).toContain("max-w-[min(42rem,72%)]");
    expect(document.querySelector("[data-otto-reference-answer-column]")?.className).toContain("max-w-[760px]");
    expect(composer.value).toBe("Keep this draft");

    await click(button("Close Otto"));
    expect(document.querySelector("[data-otto-panel]")).toBeNull();
    await click(document.querySelector<HTMLElement>("[data-otto-launcher]")!);
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Message Otto"]')?.value).toBe("Keep this draft");
  });
});
