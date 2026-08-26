// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { Toaster } = await import("@/components/ui/sonner");
const { toast } = await import("sonner");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(Toaster)); });
}

afterEach(async () => {
  toast.dismiss();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = null;
});

function texts() {
  return [...document.body.querySelectorAll("[data-sonner-toast] [data-title]")].map((n) => n.textContent ?? "");
}

describe("sonner 行为探针", () => {
  it("A:多条 toast 的 DOM 顺序", async () => {
    await mount();
    await act(async () => { toast("first"); });
    await act(async () => { toast("second"); });
    await act(async () => { toast("third"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    console.log("ORDER", JSON.stringify(texts()));
    console.log("RAW", document.body.innerHTML.slice(0, 900));
    expect(texts().length).toBe(3);
  });

  it("B:假时钟下推进 1ms 够不够", async () => {
    vi.useFakeTimers();
    await mount();
    console.log("LEAK", JSON.stringify(texts()));
    await act(async () => { toast("fresh"); });
    await act(async () => { vi.advanceTimersByTime(1); });
    console.log("FAKE-1ms", JSON.stringify(texts()));
    await act(async () => { vi.advanceTimersByTime(50); });
    console.log("FAKE-51ms", JSON.stringify(texts()));
    console.log("isFake", vi.isFakeTimers());
    vi.useRealTimers();
    expect(true).toBe(true);
  });
});
