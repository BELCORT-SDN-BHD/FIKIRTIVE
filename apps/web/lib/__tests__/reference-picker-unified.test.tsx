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
/** Every turn the composer would have sent — the billed action this menu must not trigger. */
let sent: string[] = [];
/**
 * What the composers put on the wire for the turn they just sent (FRONT-A10 slice ③):
 * `entityIds` is generation conditioning, `references` is "这条消息提到了谁". Two lists, never
 * merged — recorded here so a test can prove a media reference reaches the second and NOT the first.
 */
let lastPayload: { entityIds: string[]; references: string[] } | null = null;

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
        // byte-for-byte the composers' own handler (`OttoChatStream.tsx`, `OttoFrontDoor.tsx`):
        // the picker gets first refusal, and whatever it does not consume submits the turn.
        onKeyDown={(event) => {
          if (picker.handleKeyDown(event)) return;
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            sent.push(text);
            lastPayload = {
              entityIds: picker.entityIdsForSend(text),
              references: picker.referencesForSend(text),
            };
            setText("");
          }
        }}
        {...picker.ariaProps}
      />
    </ReferencePickerMenu>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  lastPayload = null;
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

/** One keystroke with NO time advanced — the state the composer is in WHILE a merchant types. */
async function keystroke(value: string, caret = value.length) {
  const el = composer();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, value);
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Let the debounce fire and the server answer land. */
async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

async function type(value: string, caret = value.length) {
  await keystroke(value, caret);
  await settle();
}

/** One key with NO time advanced — pressed while a search is still in flight. */
async function pressNow(key: string, options: { shiftKey?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...options });
  await act(async () => { composer().dispatchEvent(event); });
  return event;
}

async function press(key: string, options: { shiftKey?: boolean } = {}) {
  const event = await pressNow(key, options);
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

  /**
   * 判官 #1158 P2-J4 —— 键盘能选中,不等于读屏能读出选中了什么。`aria-activedescendant` 指的
   * 那个 id 必须是屏幕上**真实存在**的那一行:属性写着 `…-option-3` 而 DOM 里只有 2 行时,
   * 视觉高亮照样对、Enter 照样选对,只有读屏用户听不到任何东西 —— 而这道缺陷任何一条既有
   * 断言都看不见(它们读的是 `value` 与高亮类名)。所以这里断的是那个 id **解析得到元素**,
   * 且解析到的正是标着 `aria-selected="true"` 的那一行。
   */
  it("FRONT-A10 aria-activedescendant points at a row that is really on screen", async () => {
    await render();
    await type("@a");

    const rows = options();
    expect(rows.length).toBeGreaterThan(1);

    const activeId = composer().getAttribute("aria-activedescendant");
    expect(activeId, "菜单开着却没有 activedescendant —— 读屏听不到高亮在哪一行").toBeTruthy();
    const active = document.getElementById(activeId!);
    expect(active, `aria-activedescendant 指着 ${activeId},DOM 里没有这个元素`).not.toBeNull();
    expect(active!.getAttribute("role")).toBe("option");
    expect(active!.getAttribute("aria-selected")).toBe("true");
    expect(rows).toContain(active as HTMLButtonElement);

    // 往下挪一行,属性跟着挪到**另一个**真实存在的 option 上,不是停在原地也不是指向空气。
    await press("ArrowDown");
    const nextId = composer().getAttribute("aria-activedescendant");
    expect(nextId).not.toBe(activeId);
    const next = document.getElementById(nextId!);
    expect(next, `ArrowDown 之后 aria-activedescendant 指着 ${nextId},DOM 里没有这个元素`).not.toBeNull();
    expect(next!.getAttribute("aria-selected")).toBe("true");
    expect(options()).toContain(next as HTMLButtonElement);

    // 菜单关掉之后不许留下一个悬空指针。
    await press("Escape");
    expect(composer().getAttribute("aria-activedescendant")).toBeNull();
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

  it("FRONT-A10 a search still in flight never claims No references found", async () => {
    await render();
    // No time advanced: the debounce has not fired, so no answer for "@j" can exist yet.
    await keystroke("@j");
    expect(document.body.textContent).not.toContain("No references found");
    expect(document.body.textContent).toContain("Searching references");
    await settle();
    expect(document.body.textContent).toContain("Jasmine gift box");
    expect(document.body.textContent).not.toContain("Searching references");
  });

  it("FRONT-A10 the next keystroke after an answered search does not flash the empty state", async () => {
    await render();
    await type("@j");
    expect(document.body.textContent).toContain("Jasmine gift box");
    // One more character. The previous answer no longer describes what is on screen, but the new
    // one has not landed — the merchant must not be told their reference does not exist.
    await keystroke("@ja");
    expect(document.body.textContent).not.toContain("No references found");
    expect(document.body.textContent).toContain("Searching references");
  });

  it("FRONT-A10 no matches says so and Enter selects nothing", async () => {
    searchReferencesAction.mockResolvedValue({ items: [], nextCursor: null });
    await render();
    await type("@zzzz");
    expect(document.body.textContent).toContain("No references found");
    await press("Enter");
    // The answer for this query IS in and it is empty, so there is nothing to pick and Enter is
    // the composer's again — the turn goes out exactly as typed, with no reference invented.
    expect(sent).toEqual(["@zzzz"]);
  });

  it("FRONT-A10 Enter during an unsettled search never sends the turn", async () => {
    await render();
    // No time advanced: the debounce has not fired, so the menu is open with no rows YET.
    await keystroke("@j");
    expect(document.body.textContent).toContain("Searching references");

    const event = await pressNow("Enter");
    // The picker consumed it. Handing it back would clear the draft and start a billed Otto turn
    // on a message whose reference the merchant is still choosing — and nothing would attach.
    expect(event.defaultPrevented).toBe(true);
    expect(sent).toEqual([]);
    expect(composer().value).toBe("@j");

    // Once the answer lands the menu behaves exactly as before: Enter picks, still no turn sent.
    await settle();
    await press("Enter");
    expect(composer().value).toContain("@Jasmine gift box");
    expect(sent).toEqual([]);
  });

  it("FRONT-A10 Tab during an unsettled search does not leave the composer", async () => {
    await render();
    await keystroke("@j");
    const event = await pressNow("Tab");
    expect(event.defaultPrevented).toBe(true);
    expect(sent).toEqual([]);
  });
});

/**
 * 清单 C1 收口 —— 「商家实际能 `@` 到几类」。
 *
 * 这一组之前只到实体四格:generation／upload 服务端搜得到、菜单不给,理由是「聊天轮没有列
 * 可以带媒体引用」。第③刀给了那一列(`ChatMessage.referenceRefs`),所以两格按裁决九
 * 「有契约才出现」回到菜单里,并且要证明它们走的是**引用**那条路、不是生成条件那条路。
 */
describe("FRONT-A10 — 选择器按契约补齐类别", () => {
  it("FRONT-A10 bare @ offers every contract type production can answer", async () => {
    await render();
    await type("@");
    const labels = options().map((option) => option.textContent ?? "");
    for (const label of ["Products", "Characters", "Official avatars", "Locations", "Generations", "Uploads"]) {
      expect(labels.some((entry) => entry.includes(label)), `菜单里没有「${label}」这一格`).toBe(true);
    }
    // Clothes 是契约里唯一没有生产记录的一型 —— 裁决九:无契约的控件不出现。
    expect(labels.some((entry) => entry.includes("Clothes"))).toBe(false);
  });

  it("FRONT-A10 a picked category searches only that type on the server", async () => {
    await render();
    await type("@");
    const uploads = options().find((option) => option.textContent?.includes("Uploads"))!;
    await act(async () => uploads.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    await settle();
    const lastCall = searchReferencesAction.mock.calls.at(-1)?.[0] as { types?: string[] };
    expect(lastCall?.types).toEqual(["upload"]);
  });

  it("FRONT-A10 a media reference travels as a typed reference, never as generation conditioning", async () => {
    searchReferencesAction.mockResolvedValue({
      items: [
        { type: "upload", id: "ast_1", name: "cendol-shelf.png", source: "Upload · Library", thumbUrl: null },
        ...ROWS,
      ],
      nextCursor: null,
    });
    await render();
    await type("@cendol");
    const row = options().find((option) => option.textContent?.includes("cendol-shelf.png"))!;
    await act(async () => row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    await press("Enter");

    expect(sent).toEqual(["@cendol-shelf.png "]);
    // 引用那条路带上了它;生成条件那条路一个都没有 —— 一个 Asset id 混进 entityIds 会被
    // 查到另一张表上去,而且会读成「这张图参与了成图」,而它并没有。
    expect(lastPayload?.references).toEqual(["upload:ast_1"]);
    expect(lastPayload?.entityIds).toEqual([]);
  });

  it("FRONT-A10 an entity reference is on BOTH lists — it conditions the image and it is what was named", async () => {
    await render();
    await type("@ja");
    const row = options().find((option) => option.textContent?.includes("Jasmine gift box"))!;
    await act(async () => row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    await press("Enter");
    expect(lastPayload?.entityIds).toEqual(["p1"]);
    expect(lastPayload?.references).toEqual(["product:p1"]);
  });

  it("FRONT-A10 deleting the @name from the draft drops it from both lists", async () => {
    await render();
    await type("@ja");
    const row = options().find((option) => option.textContent?.includes("Jasmine gift box"))!;
    await act(async () => row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    await type("something else entirely");
    await press("Enter");
    expect(lastPayload?.entityIds).toEqual([]);
    expect(lastPayload?.references).toEqual([]);
  });
});
