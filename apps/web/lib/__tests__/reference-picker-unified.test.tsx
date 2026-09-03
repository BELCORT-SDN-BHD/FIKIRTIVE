// @vitest-environment jsdom
/**
 * FRONT-A10 — the one `@` picker, mounted for real.
 *
 * These are DOM behaviour tests, not source-substring guards: the defect class they exist to catch
 * (a menu that opens but cannot be reached by keyboard, an insertion that eats the rest of the
 * line, a duplicate reference) is invisible to a `toContain` on the file.
 */
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchReferencesAction = vi.fn();
vi.mock("@/lib/reference-search-actions", () => ({ searchReferencesAction }));

const { ReferencePickerMenu } = await import("@/components/reference-picker/ReferencePickerMenu");
const { useReferencePicker } = await import("@/components/reference-picker/useReferencePicker");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback) => { callback(0); return 0; };

const ROWS = [
  { type: "product" as const, id: "p1", name: "Jasmine gift box", source: "Product · Otto IQ", thumbUrl: null },
  { type: "official-avatar" as const, id: "a1", name: "Alya", source: "Official avatar · Read only", thumbUrl: null },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness() {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useReferencePicker({ text, setText, getTextarea: () => ref.current });
  return (
    <ReferencePickerMenu {...picker.menuProps}>
      <textarea
        ref={ref}
        aria-label="Ask Otto"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          picker.handleTextChange(event.target.value, event.target.selectionStart ?? event.target.value.length);
        }}
        onKeyDown={(event) => { picker.handleKeyDown(event); }}
        {...picker.ariaProps}
      />
    </ReferencePickerMenu>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  searchReferencesAction.mockReset();
  searchReferencesAction.mockResolvedValue({ items: ROWS, nextCursor: null });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  return document.body;
}

function composer() {
  return document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Otto"]')!;
}

async function type(value: string, caret = value.length) {
  const el = composer();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, value);
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

async function press(key: string, options: { shiftKey?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...options });
  await act(async () => { composer().dispatchEvent(event); });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  return event;
}

function options() {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'));
}

describe("FRONT-A10 — 两套 @ 实现收口成一个选择器", () => {
  it("FRONT-A10 bare @ opens one menu with recent references and the category entries", async () => {
    await render();
    await type("@");
    const labels = options().map((option) => option.textContent ?? "");
    expect(labels.some((label) => label.includes("Jasmine gift box"))).toBe(true);
    expect(labels.some((label) => label.includes("Products"))).toBe(true);
    expect(labels.some((label) => label.includes("Official avatars"))).toBe(true);
    expect(composer().getAttribute("aria-expanded")).toBe("true");
  });

  it("FRONT-A10 the rows come from the server search, with the contract's source line", async () => {
    await render();
    await type("@ja");
    expect(searchReferencesAction).toHaveBeenCalled();
    expect(document.body.textContent).toContain("Official avatar · Read only");
  });

  it("FRONT-A10 selecting replaces only the @query and keeps the text after the caret", async () => {
    await render();
    // caret sits right after "ja" — index 10 in "Before @ja after"
    await type("Before @ja after", 10);
    const row = options().find((option) => option.textContent?.includes("Jasmine gift box"))!;
    await act(async () => row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    expect(composer().value).toBe("Before @Jasmine gift box  after");
  });

  it("FRONT-A10 arrow keys and Enter pick a row without the mouse", async () => {
    await render();
    await type("@a");
    await press("ArrowDown");
    await press("Enter");
    expect(composer().value).toContain("@Alya");
  });

  it("FRONT-A10 Escape closes the menu and leaves the draft alone", async () => {
    await render();
    await type("@ja");
    await press("Escape");
    expect(composer().getAttribute("aria-expanded")).toBe("false");
    expect(composer().value).toBe("@ja");
  });

  it("FRONT-A10 a category entry filters the search to that one type and offers the way back", async () => {
    await render();
    await type("@");
    const products = options().find((option) => option.textContent?.includes("Products"))!;
    await act(async () => products.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(searchReferencesAction).toHaveBeenLastCalledWith(expect.objectContaining({ types: ["product"] }));
    expect(document.body.textContent).toContain("All types");
  });

  it("FRONT-A10 no matches says so and Enter selects nothing", async () => {
    searchReferencesAction.mockResolvedValue({ items: [], nextCursor: null });
    await render();
    await type("@zzzz");
    expect(document.body.textContent).toContain("No references found");
    await press("Enter");
    expect(composer().value).toBe("@zzzz");
  });
});
