// @vitest-environment jsdom
/**
 * 前端基线①(#1139 判官 P2-4):`TabsTrigger asChild` 套一条真链接时,基座必须说实话。
 *
 * Base UI 的按钮族有一个 `nativeButton` 开关,默认为 true——意思是「我渲染出来的是一颗真
 * `<button>`」。`asChild` 的整个用途就是**不**渲染 button:战役导航与排程分段都是用
 * `TabsTrigger asChild` 套一个 `<Link>`,渲染出来的是 `<a>`(导航靠 href 本身,不靠 JS)。
 * 开关没跟着改,于是基座按「原生按钮」的口径往那个 `<a>` 上挂 `type="button"`——锚点上
 * 的无效属性——并在开发期打出 "expected a native <button>" 警告(判官实测 4 次)。
 *
 * `design-system/primitives/button.tsx` 早就把这件事做对了(`nativeButton={asChild ? false
 * : nativeButton}`),tabs 漏了。同一个基座上的同一件事只能有一种做法,所以这条围栏钉的是
 * **两边一致**,不是「tabs 恰好不报警」。
 *
 * 判据分两层,一层是给人看的(警告),一层是机器改不掉的(DOM):
 *   ① 渲染整棵树的过程里,基座一句 "expected a native <button>" 都没有;
 *   ② 渲染出来的 `<a>` 上没有 `type="button"`,而 `role="tab"` 还在——修法不能靠退掉
 *      tab 语义换安静。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  consoleError.mockRestore();
});

/** 基座对「说了是原生按钮,渲染出来却不是」这件事发出的那句抱怨。 */
const NATIVE_BUTTON_COMPLAINT = /expected a native <button>/i;

function complaints(): string[] {
  return consoleError.mock.calls
    .map((args) => args.map((a) => String(a)).join(" "))
    .filter((line) => NATIVE_BUTTON_COMPLAINT.test(line));
}

async function render(node: React.ReactElement): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

/** 战役导航与排程分段的形状:受控 value + `asChild` 套一条真链接。 */
function LinkTabs() {
  return createElement(
    Tabs,
    { value: "list" },
    createElement(
      TabsList,
      { "aria-label": "Campaign sections" },
      createElement(
        TabsTrigger,
        { value: "list", asChild: true },
        createElement("a", { href: "/campaign" }, "Campaigns"),
      ),
      createElement(
        TabsTrigger,
        { value: "new", asChild: true },
        createElement("a", { href: "/campaign/new" }, "New"),
      ),
    ),
  );
}

describe("TabsTrigger asChild 套链接:语义与 button.tsx 一致(#1139 P2-4)", () => {
  it("基座一句 “expected a native <button>” 都没有", async () => {
    await render(createElement(LinkTabs));
    expect(complaints(), "Base UI 还在抱怨 tab 不是原生按钮").toEqual([]);
  });

  it("锚点上没有 type=\"button\",而 role=\"tab\" 还在", async () => {
    const dom = await render(createElement(LinkTabs));

    const tabs = Array.from(dom.querySelectorAll("a"));
    expect(tabs.length).toBe(2);
    for (const tab of tabs) {
      // `type="button"` 是「我以为你是 <button>」在 DOM 上留下的那道印子——锚点上它没有意义。
      expect(tab.getAttribute("type"), "锚点上挂了 type=\"button\"").toBeNull();
      // 安静下来的方式只有一种:告诉基座这不是原生按钮。退掉 tab 语义换安静不算修好。
      expect(tab.getAttribute("role")).toBe("tab");
      expect(tab.getAttribute("href")).toMatch(/^\/campaign/);
    }
    expect(dom.querySelector('[role="tablist"]')).toBeTruthy();
  });

  it("Button 与 TabsTrigger 对同一件事的做法一样(不是各修各的)", async () => {
    const dom = await render(
      createElement(
        "div",
        null,
        createElement(Button, { asChild: true }, createElement("a", { href: "/x" }, "Go")),
        createElement(LinkTabs),
      ),
    );

    expect(complaints()).toEqual([]);
    for (const anchor of Array.from(dom.querySelectorAll("a"))) {
      expect(anchor.getAttribute("type")).toBeNull();
    }
  });

  it("不用 asChild 时仍然是一颗真按钮(修法没有把默认值一起改掉)", async () => {
    const dom = await render(
      createElement(
        Tabs,
        { value: "one" },
        createElement(
          TabsList,
          null,
          createElement(TabsTrigger, { value: "one" }, "One"),
        ),
      ),
    );

    const tab = dom.querySelector("button");
    expect(tab, "没有 asChild 就该渲染一颗 <button>").toBeTruthy();
    expect(tab!.getAttribute("role")).toBe("tab");
    expect(complaints()).toEqual([]);
  });
});
