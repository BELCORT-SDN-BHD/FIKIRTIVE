// @vitest-environment jsdom
/**
 * r22-structural-shadcn.test.ts —— P2 第二批「结构收编」的行为契约
 * (审计 A-6 / A-10 / A-11 / A-12 / A-13 / B-3 / B-4 / B-5)。
 *
 * 这一批换的都是**结构**,不是长相,所以每条都在真 DOM 上按下去看结果:
 *
 *   ① 两张假表变成真表 —— Otto IQ 与 Canvas projects 从「一叠按钮 / 一叠 `role="row"`
 *      的 `<a>`」换成 `<table>`,列头与格子终于有关系;整行照旧可点;
 *   ② 通知与 Help 两个手搓 `<aside>` 换成 `ui/sheet` —— scrim、Esc、焦点陷阱与焦点归还
 *      全部由 Radix 出,手写的 `closeXxx(restoreFocus)` 与外部点击探针整段退役;
 *   ③ 表单错误长在**出错的那一格**旁边,并用 `aria-describedby` 接进控件 —— 此前它统一
 *      挂在整块字段的末尾,与出错的输入框没有任何程序上的关联;
 *   ④ 计数与状态从「一句话」变成一枚芯片,数字随选中与筛选实时变;
 *   ⑤ Settings 七段常驻说明句收进按需层 —— 屏幕上不再常驻,展开后原话一字不差;
 *   ⑥ 属性住行不住散文 —— Library 详情层的「类型 · 时长 · 日期」变成有名字的 `<dl>`。
 *
 * 变异自检(2026-08-26 逐条**实做**,做完以 commit `4328f9b1` 为锚还原,红 → 绿):
 *   · `SheetContent` 上的 `onCloseAutoFocus`(Help)删掉 ⇒ ②-c 的焦点归还红;
 *   · 通知那颗铃从 `SheetTrigger asChild` 里抽出来(回到自己 setState 开合)⇒ ②-a 红;
 *   · `FlowField` 里 `aria-describedby` 那一项改成 `undefined` ⇒ ③-a 红;
 *   · `DialogField` 里把 `<FieldError>` 换回块末尾的 `<p role="alert">` ⇒ ③-b 红;
 *   · `SectionNote` 换回常驻 `<p className="r22-settings-contract">` ⇒ ⑤ 的「默认不在屏幕上」红;
 *   · Otto IQ 计数芯片写死成 `{rows.length} saved`(不随搜索变)⇒ ④-a 红;
 *   · Library 批量条的芯片写死成 `1 selected` ⇒ ④-b 红;
 *   · `TableRow` 上的 `onClick`(Projects)删掉 ⇒ ①-b 红;
 *   · `LibraryDetailLayer` 的 `<dl>` 换回那一句 `·` 串起来的 `<p>` ⇒ ⑥ 红。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/global-search-actions", () => ({
  loadGlobalSearchProjects: vi.fn().mockResolvedValue({ projects: [] }),
}));
vi.mock("@/lib/actions", () => ({ createProject: vi.fn() }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const { R22DashboardShell } = await import("@/components/r22/R22DashboardShell");
const { R22ProjectsView } = await import("@/components/projects/R22ProjectsView");
const { R22OttoIQView } = await import("@/components/otto-iq/R22OttoIQView");
const { R22SettingsShell } = await import("@/components/settings/R22SettingsShell");
const { LibraryWorkroom } = await import("@/components/library/LibraryWorkroom");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");
const source = (relative: string) => readFileSync(path.join(WEB_ROOT, relative), "utf8");

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  navigation.push.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  try { window.sessionStorage.clear(); } catch { /* 存档被锁住时这一面照样能用 */ }
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.replaceChildren();
});

async function mount(element: React.ReactElement): Promise<void> {
  await act(async () => { root.render(element); });
}

function all(selector: string): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>(selector)];
}

function need(selector: string): HTMLElement {
  const node = document.body.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`找不到 ${selector}`);
  return node;
}

function byText(selector: string, text: string): HTMLElement {
  const node = all(selector).find((item) => item.textContent?.trim() === text);
  if (!node) throw new Error(`找不到写着「${text}」的 ${selector}`);
  return node;
}

async function click(node: Element): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function pressEscape(): Promise<void> {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  // Radix 把焦点归还排在卸载之后的一拍上 —— 不等这一拍就去读 activeElement,读到的是半路。
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const SETTINGS_DATA = {
  workspaceName: "Batik House",
  displayName: "Nadia",
  email: "nadia@batikhouse.my",
  balance: 1240,
  recent: [],
  accountReadable: true,
  spendCapCredits: 40,
  channels: [],
  timezone: "Asia/Kuala_Lumpur",
};

const PROJECT_ROWS = [
  { id: "raya", name: "Raya launch", ownerLabel: "You", modifiedLabel: "2 hours ago", visibility: "Workspace", briefLabel: "Festive gift set" },
];

const MEMORY_ROWS = [
  { id: "voice-1", category: "voice", content: "Batik House voice: calm and specific", source: "user" as const, pinned: true, updatedAt: new Date("2026-08-25T08:42:00.000Z") },
  { id: "voice-2", category: "voice", content: "Raya voice: warm and festive", source: "user" as const, pinned: true, updatedAt: new Date("2026-08-25T08:42:00.000Z") },
];

/* ── ① 两张假表变成真表 ────────────────────────────────────────────────────── */

describe("① 假表归位 ui/table", () => {
  it("Otto IQ 的 context 列表是真 `<table>`:列头是 th,数据格是 td,不是一叠按钮", async () => {
    await mount(h(R22OttoIQView, { initialMemory: MEMORY_ROWS, initialPane: "voice" } as never));
    const table = need("table.r22-iq-rows");
    expect(table.querySelectorAll("thead th").length, "四个列头").toBe(4);
    const rows = all("table.r22-iq-rows tbody tr");
    expect(rows.length, "两条 context").toBe(2);
    expect(rows[0]!.querySelectorAll("td").length, "每行四格").toBe(4);
    // 换件之前这里是 `<div className="r22-iq-table"><div>…四个 <b>…</b></div>` 加一叠 Button。
    expect(document.body.querySelectorAll('[role="table"]').length, "不再有手搓的 role=table").toBe(0);
  });

  it("Otto IQ:整行可点,点下去开的是那一条的详情层", async () => {
    await mount(h(R22OttoIQView, { initialMemory: MEMORY_ROWS, initialPane: "voice" } as never));
    await click(need('table.r22-iq-rows tbody tr[data-r22-iq-row="voice-2"]'));
    const dialog = need('[data-slot="dialog-content"].r22-iq-detail');
    expect(dialog.textContent, "开的是被点的那一条").toContain("Raya voice");
  });

  it("Canvas projects:行是 `<tr>`,整行可点会走到那个项目的画布", async () => {
    await mount(h(R22ProjectsView, { projects: PROJECT_ROWS, fixture: true } as never));
    const table = need("table.r22-projects-grid");
    expect(table.querySelectorAll("thead th").length, "五个列头(最后一格是打开箭头)").toBe(5);
    const row = need('tr[data-r22-project-row="raya"]');
    expect(row.querySelectorAll("td").length).toBe(5);
    await click(row);
    expect(navigation.push, "整行点下去要进那个项目").toHaveBeenCalledWith(expect.stringContaining("project=raya"));
  });

  it("Canvas projects:名字那一格里仍有一条键盘走得到的链接", async () => {
    await mount(h(R22ProjectsView, { projects: PROJECT_ROWS, fixture: true } as never));
    const link = need('tr[data-r22-project-row="raya"] a');
    expect(link.getAttribute("href"), "键盘路径不能只剩一个不可聚焦的 tr").toContain("project=raya");
  });
});

/* ── ② 通知 / Help 两层归 ui/sheet ─────────────────────────────────────────── */

describe("② 抽屉归位 ui/sheet", () => {
  async function mountShell(): Promise<void> {
    await mount(h(R22DashboardShell, { location: "/?fixture=r22", account: null, signOutAction: async () => {}, children: null } as never));
  }

  it("a. 按铃开通知:抽屉住在 portal 里,scrim 也在 —— 手搓的 `<aside>` 退役了", async () => {
    await mountShell();
    expect(document.body.querySelector("[data-r22-notifications-region][data-slot='sheet-content']"), "开之前不该有").toBeNull();
    await click(need(".r22-dashboard-bell"));
    const panel = need("[data-r22-notifications-region][data-slot='sheet-content']");
    expect(panel.tagName, "portal 里的一层,不是页面里的 aside").toBe("DIV");
    expect(document.body.querySelector("[data-slot='sheet-overlay']"), "scrim 由正典件出,此前整个没有").not.toBeNull();
    expect(panel.getAttribute("role"), "Radix Dialog 的模态语义").toBe("dialog");
  });

  it("b. 一记 Esc 关掉通知抽屉,焦点回到那颗铃", async () => {
    await mountShell();
    const bell = need(".r22-dashboard-bell");
    bell.focus();
    await click(bell);
    expect(document.body.querySelector("[data-r22-notifications-region][data-slot='sheet-content']")).not.toBeNull();
    await pressEscape();
    expect(document.body.querySelector("[data-r22-notifications-region][data-slot='sheet-content']"), "Esc 要关掉").toBeNull();
    expect(document.activeElement, "焦点要还回按下的那一颗").toBe(bell);
  });

  it("c. Help 抽屉的触发点按下就消失了,所以焦点明确还给侧栏那颗工作区键", async () => {
    await mountShell();
    const workspaceTrigger = need(".r22-dashboard-workspace");
    await click(workspaceTrigger);
    await click(byText(".r22-dashboard-workspace-menu button", "Help"));
    expect(document.body.querySelector("[data-r22-help-region][data-slot='sheet-content']"), "Help 抽屉要开着").not.toBeNull();
    await pressEscape();
    expect(document.body.querySelector("[data-r22-help-region][data-slot='sheet-content']")).toBeNull();
    expect(document.activeElement, "焦点不许掉回 body").toBe(workspaceTrigger);
  });

  it("d. 关闭键也走 SheetClose,一样关得掉", async () => {
    await mountShell();
    await click(need(".r22-dashboard-bell"));
    await click(need('[aria-label="Close notifications"]'));
    expect(document.body.querySelector("[data-r22-notifications-region][data-slot='sheet-content']")).toBeNull();
  });

  it("e. 手写的关闭 / 外部点击探针整段退役,只剩工作区菜单那一处", () => {
    const shell = source("components/r22/R22DashboardShell.tsx");
    expect(shell, "closeNotifications 那个手写的焦点归还函数不该还在").not.toContain("const closeNotifications");
    expect(shell.match(/data-r22-notifications-region/g)?.length, "探针只剩抽屉自己身上那一处").toBe(1);
    expect(shell, "外部点击这一层只管工作区菜单了").not.toContain('target.closest("[data-r22-help-region]")');
  });
});

/* ── ③ 错误长在出错的那一格旁边 ────────────────────────────────────────────── */

describe("③ 表单行归位 ui/field:错误就近 + aria-describedby", () => {
  it("a. Otto IQ:Brand Voice 名字留空,错误长在名字那一格里,并接进那个输入框", async () => {
    await mount(h(R22OttoIQView, { initialMemory: [], initialPane: "voice", fixture: true } as never));
    await click(byText(".r22-iq header button", "Add Brand Voice"));
    await click(byText(".r22-brand-voice-flow [data-slot='dialog-footer'] button", "Next"));

    const field = need('[data-slot="field"][data-invalid]');
    const error = field.querySelector('[data-slot="field-error"]')!;
    expect(error.textContent).toBe("Give this Brand Voice a name.");
    expect(error.getAttribute("role"), "还是同一句 role=alert,只是搬了家").toBe("alert");

    const input = field.querySelector("input")!;
    expect(input.id, "错误要接得进控件").toBeTruthy();
    expect(input.getAttribute("aria-describedby"), "aria-describedby 要指向那条错误").toContain(error.id);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // 出错的是第一格,所以那条错误必须与它同在一个 field 里 —— 不是挂在整块的末尾。
    expect(field.querySelector('[data-slot="field-label"]')!.textContent).toBe("Name");
  });

  it("b. Settings:Add domain 填错,错误落在 Domain 那一格,不再挂在整块字段末尾", async () => {
    await mount(h(R22SettingsShell, { data: SETTINGS_DATA, initialSection: "domains", fixture: true } as never));
    await click(byText(".r22-settings-content button", "Add domain"));
    const input = need('#domain') as HTMLInputElement;
    await type(input, "nope");
    await click(byText(".r22-settings-dialog [data-slot='dialog-footer'] button", "Save changes"));

    const field = need('.r22-settings-dialog-fields [data-slot="field"][data-invalid]');
    const error = field.querySelector('[data-slot="field-error"]')!;
    expect(error.textContent).toBe("Enter a complete domain, such as example.com.");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    expect(document.body.querySelectorAll('.r22-settings-dialog-fields > p[role="alert"]').length, "块末尾那条不该再画一遍").toBe(0);
  });

  /**
   * `form-control-names-and-casing` 那道 sweep 把 `FlowField` / `DialogField` 当作「给里面
   * 的控件起名字的包装」放行了。放行的前提是**每一处调用都真的把 id 交给控件** —— 少一次
   * `{...control}`,那一格就悄悄变回没名字的框,而 sweep 看不出来。这条就是那个前提的钉子。
   */
  it("d. 每一处 FlowField / DialogField 都真的把 id 交给了控件", () => {
    for (const relative of ["components/otto-iq/R22OttoIQView.tsx", "components/settings/R22SettingsShell.tsx"]) {
      const text = source(relative);
      const calls = [...text.matchAll(/<(FlowField|DialogField)\b/g)];
      expect(calls.length, `${relative} 一处都没有 —— 这条在核对空气`).toBeGreaterThan(0);
      for (const call of calls) {
        // 从调用开头到它自己的收尾标签之间,必须出现一次 `{...control}`。
        const from = call.index!;
        const end = text.indexOf(`</${call[1]}>`, from);
        expect(end, `${relative} 的 <${call[1]}> 没有收尾`).toBeGreaterThan(from);
        expect(text.slice(from, end), `${relative}:${text.slice(0, from).split("\n").length} 的控件没接上 id`).toContain("{...control}");
      }
    }
  });

  it("c. 手写的 `<fieldset><legend>` 全部归 FieldSet / FieldLegend", () => {
    const iq = source("components/otto-iq/R22OttoIQView.tsx");
    expect(iq, "不许再手搓 fieldset").not.toMatch(/<fieldset>/);
    expect(iq, "不许再手搓 legend").not.toMatch(/<legend>/);
    expect(iq).toContain("<FieldSet>");
    expect(iq).toContain("<FieldLegend");
  });
});

/* ── ④ 计数与状态归芯片 ────────────────────────────────────────────────────── */

describe("④ 文字报状态换成芯片", () => {
  it("a. Otto IQ 的计数是一枚芯片,而且随搜索实时变", async () => {
    await mount(h(R22OttoIQView, { initialMemory: MEMORY_ROWS, initialPane: "voice" } as never));
    const count = need("[data-r22-iq-count]");
    expect(count.getAttribute("data-slot"), "是芯片,不是一句话").toBe("badge");
    expect(count.textContent).toBe("2 saved");
    await type(need('.r22-iq-search input') as HTMLInputElement, "Raya");
    expect(need("[data-r22-iq-count]").textContent, "数字要跟着筛选走").toBe("1 saved");
  });

  it("b. Library 批量条的选中数是一枚芯片,勾一张就变一次", async () => {
    await mount(h(LibraryWorkroom, { restore: false } as never));
    expect(document.body.querySelector("[data-r22-lib-selected]"), "没选中的时候整条不在").toBeNull();
    const boxes = all('[role="checkbox"]');
    await click(boxes[0]!);
    const chip = need("[data-r22-lib-selected]");
    expect(chip.getAttribute("data-slot")).toBe("badge");
    expect(chip.textContent).toBe("1 selected");
    await click(all('[role="checkbox"]')[1]!);
    expect(need("[data-r22-lib-selected]").textContent, "数字随选中变").toBe("2 selected");
  });

  it("c. Settings 的成员状态是芯片,不再是 `<i>` 装状态文字", async () => {
    await mount(h(R22SettingsShell, { data: SETTINGS_DATA, initialSection: "members", fixture: true } as never));
    const pill = need("[data-r22-member-status]");
    expect(pill.tagName, "`<i>` 是「强调」,不是「状态」").not.toBe("I");
    expect(pill.getAttribute("data-slot")).toBe("badge");
    expect(source("components/settings/R22SettingsShell.tsx"), "五处 `<i className=\"r22-settings-pill\">` 全部退役").not.toContain('<i className="r22-settings-pill"');
  });
});

/* ── ⑤ Settings 七段常驻说明句收进按需层 ───────────────────────────────────── */

describe("⑤ 常驻解释句收进按需层", () => {
  it("默认不在屏幕上,展开之后原话一字不差", async () => {
    await mount(h(R22SettingsShell, { data: SETTINGS_DATA, initialSection: "roles", fixture: true } as never));
    const ORIGINAL = "A role name is only a summary. Every action is still checked against what you are actually allowed to do.";
    expect(document.body.textContent, "收静了就不该常驻在屏幕上").not.toContain(ORIGINAL);

    const trigger = need('[data-r22-settings-note="roles"] [data-slot="collapsible-trigger"]');
    expect(trigger.textContent?.trim().startsWith("What changes here"), "触发字样是标签,不是句子").toBe(true);
    await click(trigger);
    expect(document.body.textContent, "商家真要看的时候,原话一个字都不能少").toContain(ORIGINAL);
  });

  it("七段 contract + 一段 note 全部收编,源码里那两个常驻类名归零", () => {
    const settings = source("components/settings/R22SettingsShell.tsx");
    expect(settings.match(/className="r22-settings-contract"/g), "常驻的 contract 段归零").toBeNull();
    expect(settings.match(/className="r22-settings-note"/g), "常驻的 note 段归零").toBeNull();
    expect(settings.match(/<SectionNote /g)?.length, "八段都进了按需层").toBe(8);
  });
});

/* ── ⑥ 属性住行,不住散文 ──────────────────────────────────────────────────── */

describe("⑥ 散文列属性改行", () => {
  it("Library 详情层的类型 / 时长 / 日期是有名字的 `<dl>`,不是一句 `·` 串起来的话", () => {
    const layer = source("components/library/LibraryDetailLayer.tsx");
    expect(layer, "那句串出来的散文退役了").not.toContain('`Video · ${asset.duration ?? ""}`');
    expect(layer).toContain("<dl className=\"r22-lib-layer-meta\">");
    for (const name of ["<dt>Type</dt>", "<dt>Made</dt>"]) expect(layer).toContain(name);
  });

  it("Library 列表行归位 ui/item,属性同样成行", async () => {
    await mount(h(LibraryWorkroom, { restore: false } as never));
    await click(need('[aria-label="List view"]'));
    const row = need('[data-slot="item"].r22-lib-row');
    expect(row.querySelector('[data-slot="item-media"]'), "缩略图是 ItemMedia").not.toBeNull();
    expect(row.querySelectorAll(".r22-lib-row-facts dt").length, "三条属性各有名字").toBe(3);
    expect([...row.querySelectorAll(".r22-lib-row-facts dt")].map((node) => node.textContent)).toEqual(["From", "Type", "Made"]);
    const card = source("components/library/LibraryCard.tsx");
    expect(card).toContain("<ItemMedia");
    expect(card).toContain("<ItemContent");
    expect(card).toContain('<dl className="r22-lib-row-facts">');
    // 并排的裸 span 退役了 —— 三条属性各自住在一个 `<dd>` 里,前面站着自己的 `<dt>`。
    expect(row.querySelectorAll(".r22-lib-row-facts dd").length).toBe(3);
    expect(row.querySelector(".r22-lib-row-facts dd")!.textContent, "第一条是来源").toBeTruthy();
  });
});

/* ── ⑦ 复扫对账 ────────────────────────────────────────────────────────────── */

describe("⑦ 复扫对账:换掉的形状不许在别处复活", () => {
  const SURFACES = [
    "components/r22/R22DashboardShell.tsx",
    "components/projects/R22ProjectsView.tsx",
    "components/library/R22LibraryView.tsx",
    "components/library/LibraryToolbar.tsx",
    "components/library/LibraryCard.tsx",
    "components/library/LibraryDetailLayer.tsx",
    "components/otto-iq/R22OttoIQView.tsx",
    "components/settings/R22SettingsShell.tsx",
  ];

  /** 注释里可以讲「此前这里是 role=\"table\"」—— 那是留给下一个人的话,不是渲染出去的东西。 */
  function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it("五门里 `role=\"table\"` / `role=\"row\"` 的 div 归零", () => {
    // 围栏没有空转:这条正则认得出被换掉的那种写法。
    expect(withoutComments('<div role="table">')).toMatch(/role=["'](?:table|row|cell|columnheader)["']/);
    for (const relative of SURFACES) {
      expect(withoutComments(source(relative)), `${relative} 还留着手搓的表格语义`).not.toMatch(/role=["'](?:table|row|cell|columnheader)["']/);
    }
  });

  it("手搓的「label 包着图标加输入框」搜索框归零 —— 五处全归 input-group", () => {
    for (const relative of SURFACES) {
      const text = source(relative);
      if (!text.includes("<Search ")) continue;
      expect(text, `${relative} 的搜索框还没归位`).toMatch(/<InputGroup|CommandInput/);
      expect(text, `${relative} 还留着 label 包图标那种手搓法`).not.toMatch(/<label[^>]*>\s*<Search /);
    }
    // 围栏没有空转:这几个面里真的有搜索框。
    expect(SURFACES.filter((relative) => source(relative).includes("<InputGroup")).length).toBeGreaterThanOrEqual(3);
  });

  it("装进来的五件正典件都真的被用上了,不是装了搁着", () => {
    const used = new Map<string, string[]>([
      ["table", ["components/otto-iq/R22OttoIQView.tsx", "components/projects/R22ProjectsView.tsx"]],
      ["field", ["components/otto-iq/R22OttoIQView.tsx", "components/settings/R22SettingsShell.tsx"]],
      ["input-group", ["components/projects/R22ProjectsView.tsx", "components/library/LibraryToolbar.tsx", "components/library/R22LibraryView.tsx"]],
      ["item", ["components/library/LibraryCard.tsx", "components/settings/R22SettingsShell.tsx"]],
      ["collapsible", ["components/settings/R22SettingsShell.tsx"]],
    ]);
    for (const [component, consumers] of used) {
      for (const relative of consumers) {
        expect(source(relative), `${relative} 没有用上 ui/${component}`).toContain(`from "@/components/ui/${component}"`);
      }
    }
  });

  it("正典件自己没有被手改成第二份实现", () => {
    const files = readdirSync(path.join(WEB_ROOT, "components/ui"));
    for (const name of ["table.tsx", "field.tsx", "input-group.tsx", "item.tsx", "collapsible.tsx"]) {
      expect(files, `components/ui/${name} 不在`).toContain(name);
    }
  });
});

/* ── ⑧ 常驻句预算:Settings 入栏 ────────────────────────────────────────────── */

/**
 * 这一项本该住在 `r22-design-foundation-fence.test.ts` 那张「表面注册表」里(Home 与
 * Library workroom 就在那儿)。它住在这里只有一个原因:Settings 用 `usePathname` /
 * `useSearchParams` / `useRouter`,静态渲染进不去 —— 而那份围栏是**只读**的,给它加一层
 * `next/navigation` 的 mock 会把同文件另外 68 条也一起拖进 mock 里。尺子是同一把
 * (照抄 `countResidentSentences`),上限规矩也是同一条:**只许下调,不许上调**。
 *
 * 实测:收静之前 roles 这一节是 3(页头一句 + intro 一句 + 那段 contract),收静之后是 2。
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function countResidentSentences(text: string): number {
  return decodeEntities(text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter((chunk) => chunk.split(/\s+/).filter(Boolean).length > 3).length;
}

describe("⑧ 常驻句预算 ratchet —— Settings 入栏(审计 B-3)", () => {
  const SETTINGS_LIMITS: Array<[string, number]> = [
    ["notifications", 2],
    ["members", 2],
    ["roles", 2],
    ["connections", 2],
    ["billing", 2],
    ["domains", 2],
    ["connected", 2],
    ["preferences", 2],
  ];

  it("尺子没有空转:认得出一整句说明,也认得出就是个按钮字样", () => {
    expect(countResidentSentences("Role names are summaries. Server authorization checks concrete permissions.")).toBe(2);
    expect(countResidentSentences("What changes here")).toBe(0);
  });

  it.each(SETTINGS_LIMITS)("%s 这一节的常驻说明句数 <= %d", async (section, limit) => {
    await mount(h(R22SettingsShell, { data: SETTINGS_DATA, initialSection: section, fixture: true } as never));
    const count = countResidentSentences(need(".r22-settings-content").textContent ?? "");
    expect(count, `常驻说明句数 = ${count},超过上限 ${limit} —— 新增常驻说明先报到,再改上限`).toBeLessThanOrEqual(limit);
  });
});
