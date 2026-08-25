// @vitest-environment jsdom
/**
 * #840 底座包冒烟 —— 基础包与 R22 新采用的 shadcn 组合件都要真渲染一次。
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";

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

describe("#840 底座包与 R22 组合件都真的能渲染", () => {
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

  it("Checkbox:是 checkbox 角色,勾选状态出现在 data-state 上", () => {
    render(h(Checkbox, { checked: true, "aria-label": "Exclude opted-out contacts" }));
    const box = host.querySelector('[data-slot="checkbox"]')!;
    expect(box.getAttribute("role")).toBe("checkbox");
    expect(box.getAttribute("data-state")).toBe("checked");
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

  it("Tabs:tablist / tab 语义齐,选中的那一格 data-state=active", () => {
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
    expect(tabs[0].getAttribute("data-state")).toBe("active");
    expect(host.querySelector('[role="tabpanel"]')!.textContent).toBe("Chat panel");
  });

  it("ToggleGroup:单选筛选器发出 radiogroup / radio 与选中状态", () => {
    render(
      h(ToggleGroup, { type: "single", value: "all", "aria-label": "Filter approvals" },
        h(ToggleGroupItem, { value: "all" }, "All"),
        h(ToggleGroupItem, { value: "otto" }, "From Otto"),
      ),
    );
    expect(host.querySelector('[role="radiogroup"]')!.getAttribute("aria-label")).toBe("Filter approvals");
    const options = [...host.querySelectorAll('[role="radio"]')];
    expect(options.map((option) => option.textContent)).toEqual(["All", "From Otto"]);
    expect(options[0].getAttribute("aria-checked")).toBe("true");
  });

  it("RadioGroup:原因选择器保留 radio 角色与受控状态", () => {
    render(
      h(RadioGroup, { value: "facts", "aria-label": "Reason for sending back" },
        h(RadioGroupItem, { value: "voice", "aria-label": "Wrong voice" }),
        h(RadioGroupItem, { value: "facts", "aria-label": "Wrong facts" }),
      ),
    );
    expect(host.querySelector('[role="radiogroup"]')!.getAttribute("aria-label")).toBe("Reason for sending back");
    const options = [...host.querySelectorAll('[role="radio"]')];
    expect(options[1].getAttribute("aria-checked")).toBe("true");
  });

  it("Switch:自动发布开关保留 switch 角色、状态与 thumb", () => {
    render(h(Switch, { checked: true, "aria-label": "Auto-publish" }));
    const control = host.querySelector('[data-slot="switch"]')!;
    expect(control.getAttribute("role")).toBe("switch");
    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector('[data-slot="switch-thumb"]')).toBeTruthy();
  });

  it("Message / Bubble:Otto 消息使用明确的 shadcn composition slots", () => {
    render(
      h(Message, { align: "end" },
        h(MessageContent, null,
          h(Bubble, { align: "end" },
            h(BubbleContent, null, "Plan a Raya campaign"),
          ),
        ),
      ),
    );
    expect(host.querySelector('[data-slot="message"]')!.getAttribute("data-align")).toBe("end");
    expect(host.querySelector('[data-slot="bubble"]')!.getAttribute("data-align")).toBe("end");
    expect(host.querySelector('[data-slot="bubble-content"]')!.textContent).toBe("Plan a Raya campaign");
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
