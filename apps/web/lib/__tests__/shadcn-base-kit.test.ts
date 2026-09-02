// @vitest-environment jsdom
/**
 * #840 底座包冒烟 —— 新补的 9 件 shadcn 组件今天一个调用点都没有。
 *
 * 没有调用点意味着:类型过了、`next build` 过了,它们仍然可能在第一次被用到的时候
 * 才炸(Radix 统一包的运行时导出名与类型对不上、Portal 没挂上、Indicator 少一层)。
 * 而它们的第一批调用点是 #840 那 12-15 张并行 PR —— 12 个 worker 各自撞一次同一个坑,
 * 是最贵的一种发现方式。这份冒烟就是替他们先撞一遍:每一件都真渲染一次,
 * 断言它渲染出正确的语义角色和状态。
 *
 * 这不是视觉测试,不管样式;样式的权威是 globals.css 与 design-tokens 那道围栏。
 */
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(node: ReactNode) {
  act(() => root.render(node));
}

/** Radix 的浮层挂在 body 的 portal 里,不在 host 下面。 */
function inDocument(selector: string): Element | null {
  return document.body.querySelector(selector);
}

describe("#840 底座包 — 9 件新组件都真的能渲染", () => {
  it("Alert:默认档与状态档都渲染,标题与描述带得上", () => {
    render(
      h(Alert, { variant: "destructive" },
        h(AlertTitle, null, "Payment did not go through"),
        h(AlertDescription, null, "Your card was declined. No credits were taken."),
      ),
    );
    const alert = host.querySelector('[data-slot="alert"]')!;
    expect(alert).toBeTruthy();
    expect(alert.className).toContain("bg-error-soft");
    expect(host.querySelector('[data-slot="alert-title"]')!.textContent).toBe("Payment did not go through");
    expect(host.querySelector('[data-slot="alert-description"]')!.textContent).toContain("No credits were taken.");
  });

  it("Checkbox:是 checkbox 角色,勾选状态读得出来", () => {
    render(h(Checkbox, { checked: true, "aria-label": "Exclude opted-out contacts" }));
    const box = host.querySelector('[data-slot="checkbox"]')!;
    expect(box.getAttribute("role")).toBe("checkbox");
    // Base UI 换基座:勾选态不再是 Radix 的 `data-state="checked"`,而是布尔存在型的
    // `data-checked` / `data-unchecked`(见 `@base-ui/react/checkbox` 的
    // CheckboxRootDataAttributes)。钉的东西没变 —— 而且这里改成先钉**读屏听到的**
    // `aria-checked`,样式钩子只作补充,基座再换一次也不会把这条冒烟钉死。
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.hasAttribute("data-checked")).toBe(true);
    expect(box.hasAttribute("data-unchecked")).toBe(false);
    expect(box.getAttribute("aria-label")).toBe("Exclude opted-out contacts");
  });

  it("Label:渲染成真的 <label>,htmlFor 关联得上", () => {
    render(h(Label, { htmlFor: "workspace-name" }, "Workspace name"));
    const label = host.querySelector('[data-slot="label"]') as HTMLLabelElement;
    expect(label.tagName).toBe("LABEL");
    expect(label.htmlFor).toBe("workspace-name");
  });

  it("Separator:默认装饰性,不被读屏当成内容宣告", () => {
    render(h(Separator, null));
    const line = host.querySelector('[data-slot="separator"]')!;
    expect(line.getAttribute("data-orientation")).toBe("horizontal");
    expect(line.getAttribute("role")).toBe("none");
  });

  it("Skeleton:就是一个占位方块", () => {
    render(h(Skeleton, { className: "h-4 w-32" }));
    const block = host.querySelector('[data-slot="skeleton"]')!;
    expect(block.className).toContain("animate-pulse");
    expect(block.className).toContain("w-32");
  });

  it("Tabs:tablist / tab 语义齐,选中的那一格宣告自己被选中", () => {
    render(
      h(Tabs, { defaultValue: "chat" },
        h(TabsList, null,
          h(TabsTrigger, { value: "chat" }, "Chat"),
          h(TabsTrigger, { value: "projects" }, "Projects"),
        ),
        h(TabsContent, { value: "chat" }, "Chat panel"),
      ),
    );
    expect(host.querySelector('[role="tablist"]')).toBeTruthy();
    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Chat", "Projects"]);
    // 同上:Radix 的 `data-state="active"` 在 Base UI 是存在型的 `data-active`
    // (TabsTabDataAttributes)。选中态先钉 `aria-selected` —— 那是读屏与键盘真正读的位。
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].hasAttribute("data-active")).toBe(true);
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    expect(host.querySelector('[role="tabpanel"]')!.textContent).toBe("Chat panel");
  });

  it("Popover:开着的时候内容出现在 portal 里", () => {
    render(
      h(Popover, { open: true },
        h(PopoverTrigger, null, "Filters"),
        h(PopoverContent, null, "Lifecycle: customer"),
      ),
    );
    expect(inDocument('[data-slot="popover-content"]')!.textContent).toBe("Lifecycle: customer");
  });

  it("DropdownMenu:开着的时候是 menu / menuitem,不是一堆 div", () => {
    render(
      h(DropdownMenu, { open: true },
        h(DropdownMenuTrigger, null, "More"),
        h(DropdownMenuContent, null,
          h(DropdownMenuItem, null, "Duplicate"),
          h(DropdownMenuItem, { variant: "destructive" }, "Delete"),
        ),
      ),
    );
    expect(inDocument('[role="menu"]')).toBeTruthy();
    const items = [...document.body.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(["Duplicate", "Delete"]);
    expect(items[1].getAttribute("data-variant")).toBe("destructive");
  });

  it("Sheet:开着的时候是模态对话框,标题与描述接得上无障碍名字", () => {
    render(
      h(Sheet, { open: true },
        h(SheetTrigger, null, "Menu"),
        h(SheetContent, { side: "left" },
          h(SheetTitle, null, "Navigation"),
          h(SheetDescription, null, "Jump to any part of the workspace."),
        ),
      ),
    );
    const panel = inDocument('[data-slot="sheet-content"]')!;
    expect(panel.getAttribute("role")).toBe("dialog");
    // Radix 1.6 不发 aria-modal —— 它靠 FocusScope 把焦点关进面板(面板自己 tabindex=-1
    // 才收得住第一次聚焦),再把外面的兄弟节点 aria-hidden 掉。断言这个,不断言旧写法。
    expect(panel.getAttribute("tabindex")).toBe("-1");
    expect(inDocument('[data-slot="sheet-title"]')!.textContent).toBe("Navigation");
    // 名字与描述必须由 Radix 接到面板上,否则读屏用户听到的是一个没有名字的对话框。
    expect(panel.getAttribute("aria-labelledby")).toBe(inDocument('[data-slot="sheet-title"]')!.id);
    expect(panel.getAttribute("aria-describedby")).toBe(inDocument('[data-slot="sheet-description"]')!.id);
  });
});
