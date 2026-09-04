// @vitest-environment jsdom
/**
 * FRONT-A10 — the one `@` reference menu: row anatomy, row cap and the empty-state exit.
 *
 * 前身是 `otto-mention-popover.test.tsx`(打在 `components/otto/OttoMentionPopover.tsx` 上)。
 * 那个组件被「两套 `@` 收口成一个选择器」这一刀替换成 `ReferencePickerMenu`,断言指着的组件
 * 因此换了一个;**口径一个字没改**:
 *   - 合约 §2「最多显示约 8 行,之后在菜单内部滚动」——「切到 8 行」从菜单渲染时搬到了
 *     服务端一页的上限 `REFERENCE_PAGE_LIMIT`(菜单只剩下「装不下就自己滚」这一半);
 *   - 合约 §3 行解剖:缩略图或类型图标 / 名字 / 一行来源 / 尾部类型图标;
 *   - 合约 §7 空态只留 `Browse Library` 一个出口,没有 `Upload media`;
 *   - 没有在跟踪的 `@query` 时菜单不开。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  ReferencePickerMenu,
  type ReferencePickerRow,
} from "@/components/reference-picker/ReferencePickerMenu";
import { REFERENCE_PAGE_LIMIT, referenceTypeLabel } from "@/lib/reference-search-model";

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
  rows: ReferencePickerRow[];
  open?: boolean;
  pending?: boolean;
  highlightedIndex?: number;
}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <ReferencePickerMenu
        open={props.open ?? true}
        rows={props.rows}
        pending={props.pending ?? false}
        highlightedIndex={props.highlightedIndex ?? 0}
        listId="reference-picker"
        title="References"
        onDismiss={() => {}}
        onHighlightChange={() => {}}
        onSelect={() => {}}
      >
        <textarea aria-label="Composer" />
      </ReferencePickerMenu>,
    ),
  );
  return container;
}

function referenceRow(index: number): ReferencePickerRow {
  return {
    key: `product:entity-${index}`,
    kind: "reference",
    name: `Reference ${index}`,
    source: `${referenceTypeLabel("product")} · Library`,
    thumbUrl: null,
    type: "product",
  };
}

describe("FRONT-A10 Otto reference picker menu", () => {
  it("FRONT-A10 caps the menu at eight rows and scrolls the rest inside the menu", async () => {
    // 上限的家从菜单搬到了搜索的一页:服务端不会一次给出第 9 行,所以菜单不必再切。
    expect(REFERENCE_PAGE_LIMIT).toBe(8);

    await render({ rows: Array.from({ length: REFERENCE_PAGE_LIMIT }, (_, i) => referenceRow(i)) });

    const options = document.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(8);
    expect(options[7]?.textContent).toContain("Reference 7");

    const scroller = document.querySelector('[role="option"]')!.parentElement!;
    expect(scroller.className).toContain("max-h-[352px]");
    expect(scroller.className).toContain("overflow-y-auto");
  });

  it("FRONT-A10 offers only the Browse Library exit when a live query finds nothing", async () => {
    await render({ rows: [], open: true });

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
    await render({ rows: [], open: false });

    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("FRONT-A10 draws each row as thumbnail or type icon, name and one source line", async () => {
    await render({
      rows: [
        {
          key: "product:product-1",
          kind: "reference",
          name: "Jasmine soap",
          source: `${referenceTypeLabel("product")} · Library`,
          thumbUrl: "/base.png",
          type: "product",
        },
        {
          key: "character:character-1",
          kind: "reference",
          name: "Aisyah",
          source: `${referenceTypeLabel("character")} · Library`,
          thumbUrl: null,
          type: "character",
        },
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
    expect(character.hasAttribute("data-highlighted")).toBe(true);
    // The highlight is the design system's own `aria-selected` recipe on the ghost Button,
    // not a second colour rule written at this call site.
    expect(character.className).toContain("aria-selected:bg-accent");
    expect(product.hasAttribute("data-highlighted")).toBe(false);
  });
});
