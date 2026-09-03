// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { OttoMentionPopover } from "@/components/otto/OttoMentionPopover";
import type { MentionSuggestion } from "@/lib/mention-presentation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback) => {
  callback(0);
  return 0;
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function render(props: {
  suggestions: MentionSuggestion[];
  queryActive?: boolean;
  highlightedIndex?: number;
}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <OttoMentionPopover
        suggestions={props.suggestions}
        queryActive={props.queryActive}
        highlightedIndex={props.highlightedIndex ?? 0}
        listId="mention-suggestions"
        onDismiss={() => {}}
        onHighlightChange={() => {}}
        onSelect={() => {}}
      >
        <textarea aria-label="Composer" />
      </OttoMentionPopover>,
    ),
  );
  return container;
}

function entity(index: number): MentionSuggestion {
  return { id: `entity-${index}`, name: `Reference ${index}`, type: "PRODUCT" };
}

describe("FRONT-A10 Otto reference picker menu", () => {
  it("FRONT-A10 caps the menu at eight rows and scrolls the rest inside the menu", async () => {
    await render({ suggestions: Array.from({ length: 12 }, (_, index) => entity(index)) });

    const options = document.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(8);
    expect(options[7]?.textContent).toContain("Reference 7");
    expect(document.body.textContent).not.toContain("Reference 8");

    const scroller = document.querySelector('[role="listbox"] > div')!;
    expect(scroller.className).toContain("max-h-[352px]");
    expect(scroller.className).toContain("overflow-y-auto");
  });

  it("FRONT-A10 offers only the Browse Library exit when a live query finds nothing", async () => {
    await render({ suggestions: [], queryActive: true });

    const listbox = document.querySelector('[role="listbox"]')!;
    expect(listbox.textContent).toContain("No references found");
    expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(0);

    const exits = Array.from(listbox.querySelectorAll("a, button")).map((node) =>
      node.textContent?.trim(),
    );
    expect(exits).toEqual(["Browse Library"]);
    expect(listbox.querySelector("a")?.getAttribute("href")).toBe("/library");
    expect(listbox.textContent).not.toContain("Upload media");
  });

  it("FRONT-A10 keeps the menu closed when no query is being tracked and nothing matches", async () => {
    await render({ suggestions: [] });

    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("FRONT-A10 draws each row as thumbnail or type icon, name and one source line", async () => {
    await render({
      suggestions: [
        {
          id: "product-1",
          name: "Jasmine soap",
          type: "PRODUCT",
          baseAssetId: "asset-2",
          refs: [
            { assetId: "asset-1", url: "/first.png", kind: "image" },
            { assetId: "asset-2", url: "/base.png", kind: "image" },
          ],
        },
        { id: "character-1", name: "Aisyah", type: "CHARACTER" },
      ],
      highlightedIndex: 1,
    });

    const [product, character] = Array.from(document.querySelectorAll('[role="option"]'));
    expect(product.querySelector("img")?.getAttribute("src")).toBe("/base.png");
    expect(product.textContent).toContain("Jasmine soap");
    expect(product.textContent).toContain("Product · Library");
    expect(product.getAttribute("aria-selected")).toBe("false");

    expect(character.querySelector("img")).toBeNull();
    expect(character.querySelector("svg")).not.toBeNull();
    expect(character.textContent).toContain("Character · Library");
    expect(character.getAttribute("aria-selected")).toBe("true");
    expect(character.className).toContain("bg-accent");
  });
});
